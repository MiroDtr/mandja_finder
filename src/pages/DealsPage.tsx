import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { callAI, errorText } from "../api";
import { activeProducts, db, preferencesText, type ChatTurn, type Product } from "../db";
import { ProductGrid } from "../ProductCard";
import type { TabId } from "../App";

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

export function DealsPage({ goTo }: { goTo: (tab: TabId) => void }) {
  const products = useLiveQuery(activeProducts, []);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || pending || !products?.length) return;
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
      // Each conversation is saved as one read-only entry in the History tab.
      if (chatId == null) setChatId(await db.chats.add({ createdAt: Date.now(), turns: next }));
      else await db.chats.update(chatId, { turns: next });
    } catch (err) {
      setError(errorText(err));
      setQuestion(q);
    }
    setPending(null);
  }

  function newChat() {
    setTurns([]);
    setChatId(null);
    setError("");
  }

  const empty = products && products.length === 0;

  return (
    <div className="chat">
      <div className="row">
        <h1 className="grow">Оферти</h1>
        {turns.length > 0 && (
          <button className="ghost" onClick={newChat}>
            Нов разговор
          </button>
        )}
      </div>

      {empty ? (
        <div className="empty">
          <p>Няма активни брошури. Качи брошура, за да питаш за оферти.</p>
          <button className="primary" onClick={() => goTo("leaflets")}>
            Към брошурите
          </button>
        </div>
      ) : (
        <>
          {turns.length === 0 && !pending && (
            <p className="muted">
              Питай за офертите в активните брошури{products ? ` (${products.length} продукта)` : ""}. Например: „Какви
              са офертите за месо?“ или „Покажи ми намалените кисели млека“.
            </p>
          )}
          <div className="turns">
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
                <div className="bubble muted">Търся…</div>
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <div ref={bottom} />
          </div>
          <form className="ask" onSubmit={ask}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Какво търсиш?"
              disabled={!!pending}
            />
            <button className="primary" disabled={!!pending || !question.trim() || !products?.length}>
              Питай
            </button>
          </form>
        </>
      )}
    </div>
  );
}
