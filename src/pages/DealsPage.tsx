import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { callAI, errorText } from "../api";
import { CATEGORIES, db, preferencesText, STORES, type ChatTurn, type Product, type Store } from "../db";
import { matches, mentionsAny, useOffers, usePreferences } from "../offers";
import { ProductGrid } from "../ProductCard";
import type { TabId } from "../App";

type Sort = "price" | "discount" | "unit";
const PAGE = 60;

function productLine(p: Product): string {
  return [
    p.id,
    p.store,
    p.name,
    p.size ?? "-",
    p.price.toFixed(2),
    p.oldPrice?.toFixed(2) ?? "-",
    p.unitPrice != null && p.unit ? `${p.unitPrice.toFixed(2)}/${p.unit}` : "-",
    p.category,
  ].join(" | ");
}

/** Free-form question answered by Haiku — the only part of this page that costs money. */
function AskAI({ products }: { products: Product[] }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length || pending) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || pending || !products.length) return;
    setQuestion("");
    setPending(q);
    setError("");
    try {
      const result = await callAI<{ answer: string; product_ids: number[] }>("deals", {
        question: q,
        history: turns.map((t) => ({ q: t.q, a: t.a })),
        products: products.map(productLine).join("\n"),
        preferences: await preferencesText(),
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      const picked = result.product_ids
        .map((id) => byId.get(id))
        .filter((p): p is Product => !!p)
        .sort((a, b) => a.price - b.price);
      const next = [...turns, { q, a: result.answer, products: picked }];
      setTurns(next);
      if (chatId == null) setChatId(await db.chats.add({ createdAt: Date.now(), turns: next }));
      else await db.chats.update(chatId, { turns: next });
    } catch (err) {
      setError(errorText(err));
      setQuestion(q);
    }
    setPending(null);
  }

  return (
    <div className="card ask-ai">
      <div className="row">
        <h2 className="grow">Попитай AI</h2>
        {turns.length > 0 && (
          <button className="ghost" onClick={() => (setTurns([]), setChatId(null))}>
            Нов разговор
          </button>
        )}
      </div>
      <p className="muted small">
        За въпроси, които търсенето не разбира — напр. „какво да взема за скара за 4 души?“. Използва Claude API.
      </p>
      {turns.map((turn, i) => (
        <div key={i} className="turn">
          <div className="bubble user">{turn.q}</div>
          <div className="bubble">{turn.a}</div>
          <ProductGrid products={turn.products} />
        </div>
      ))}
      {pending && (
        <div className="turn">
          <div className="bubble user">{pending}</div>
          <div className="bubble muted">Мисля…</div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div ref={bottom} />
      <form className="row" onSubmit={ask}>
        <input
          className="grow"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Твоят въпрос"
          disabled={!!pending}
        />
        <button className="primary" disabled={!!pending || !question.trim() || !products.length}>
          Питай
        </button>
      </form>
    </div>
  );
}

export function DealsPage({ goTo }: { goTo: (tab: TabId) => void }) {
  const { shared, products } = useOffers();
  const prefs = usePreferences();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [stores, setStores] = useState<Set<Store>>(new Set());
  const [sort, setSort] = useState<Sort>("price");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => setLimit(PAGE), [query, category, stores, sort]);

  const { results, hiddenByAllergy } = useMemo(() => {
    if (!products) return { results: [], hiddenByAllergy: 0 };
    const allergies = prefs?.allergies ?? [];
    let hidden = 0;
    const list = products.filter((p) => {
      if (category && p.category !== category) return false;
      if (stores.size && !stores.has(p.store)) return false;
      if (query.trim() && !matches(`${p.name} ${p.size ?? ""} ${p.category}`, query)) return false;
      if (allergies.length && mentionsAny(p, allergies)) {
        hidden++;
        return false;
      }
      return true;
    });
    const unit = (p: Product) => p.unitPrice ?? Infinity;
    list.sort((a, b) =>
      sort === "discount"
        ? (b.discount ?? 0) - (a.discount ?? 0) || a.price - b.price
        : sort === "unit"
          ? unit(a) - unit(b) || a.price - b.price
          : a.price - b.price,
    );
    return { results: list, hiddenByAllergy: hidden };
  }, [products, prefs, query, category, stores, sort]);

  const liked = useMemo(
    () => new Set(prefs?.likes.length ? results.filter((p) => mentionsAny(p, prefs.likes)).map((p) => p.id) : []),
    [results, prefs],
  );
  const disliked = useMemo(
    () => new Set(prefs?.dislikes.length ? results.filter((p) => mentionsAny(p, prefs.dislikes)).map((p) => p.id) : []),
    [results, prefs],
  );
  // Dislikes sink to the bottom, everything else keeps the chosen order.
  const ordered = useMemo(
    () => [...results.filter((p) => !disliked.has(p.id)), ...results.filter((p) => disliked.has(p.id))],
    [results, disliked],
  );

  if (products && products.length === 0) {
    return (
      <>
        <h1>Оферти</h1>
        <div className="empty">
          <p>{shared?.error ?? "Още няма оферти за тази седмица."}</p>
          <button className="primary" onClick={() => goTo("leaflets")}>
            Към брошурите
          </button>
        </div>
      </>
    );
  }

  const filtering = !!(query.trim() || category || stores.size);
  const toggleStore = (s: Store) => {
    const next = new Set(stores);
    if (!next.delete(s)) next.add(s);
    setStores(next);
  };

  return (
    <>
      <h1>Оферти</h1>
      <input
        className="search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Търси: кисело мляко, сирене, кафе…"
        aria-label="Търсене"
      />
      <div className="chips scroll">
        {CATEGORIES.map((c) => (
          <button key={c} className={category === c ? "chip on" : "chip"} onClick={() => setCategory(category === c ? null : c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="row wrap filters">
        {STORES.map((s) => (
          <button key={s} className={stores.has(s) ? "chip on" : "chip"} onClick={() => toggleStore(s)}>
            {s}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Подреди">
          <option value="price">Най-евтини</option>
          <option value="discount">Най-голяма отстъпка</option>
          <option value="unit">Цена за кг/л</option>
        </select>
      </div>

      {!products ? (
        <p className="muted">Зареждам офертите…</p>
      ) : (
        <>
          <p className="muted small">
            {filtering ? `${results.length} от ${products.length} оферти` : `${products.length} оферти`}
            {hiddenByAllergy > 0 && ` · ${hiddenByAllergy} скрити заради алергии`}
          </p>
          <ProductGrid products={ordered.slice(0, limit)} liked={liked} disliked={disliked} />
          {ordered.length > limit && (
            <button className="ghost wide" onClick={() => setLimit(limit + PAGE)}>
              Покажи още ({ordered.length - limit})
            </button>
          )}
          <AskAI products={products} />
        </>
      )}
    </>
  );
}
