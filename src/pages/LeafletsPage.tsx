import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { callAI, errorText, AuthError } from "../api";
import { db, deleteLeaflet, formatDate, STORES, today, type Product, type Store } from "../db";
import { openPdf } from "../images";
import { useOffers } from "../offers";

interface PageResult {
  valid_from: string | null;
  valid_to: string | null;
  products: {
    name: string;
    price: number;
    old_price: number | null;
    discount_percent: number | null;
    size: string | null;
    unit_price: number | null;
    unit: "кг" | "л" | null;
    category: string;
  }[];
}

/** Extraction finished and waiting to be saved (dates may still be missing). */
interface Draft {
  store: Store;
  fileName: string;
  validFrom: string;
  validTo: string;
  products: Omit<Product, "id" | "leafletId">[];
  failedPages: number[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PARALLEL_PAGES = 3;

/** Manual upload, read by Claude Haiku through the API — a fallback for leaflets the weekly update misses. */
function ManualUpload() {
  const [store, setStore] = useState<Store>("Fantastico");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const now = today();

  async function process(file: File) {
    setError("");
    setDraft(null);
    let pdf: Awaited<ReturnType<typeof openPdf>>;
    try {
      pdf = await openPdf(file);
    } catch {
      setError("Не мога да отворя този файл. Качи PDF брошура.");
      return;
    }
    const total = pdf.pageCount;
    setProgress({ done: 0, total });

    const results: (PageResult | null | "skipped")[] = new Array(total).fill(null);
    let nextPage = 1;
    let done = 0;
    let fatal: unknown = null;

    async function worker() {
      while (nextPage <= total && !fatal) {
        const pageNumber = nextPage++;
        try {
          const page = await pdf.readPage(pageNumber);
          if (!page) results[pageNumber - 1] = "skipped";
          else {
            const payload = { ...page, store, today: now };
            try {
              results[pageNumber - 1] = await callAI<PageResult>("leaflet-page", payload);
            } catch (err) {
              if (err instanceof AuthError) throw err;
              results[pageNumber - 1] = await callAI<PageResult>("leaflet-page", payload); // one retry
            }
          }
        } catch (err) {
          if (err instanceof AuthError) fatal = err;
          else if (done === 0 && pageNumber <= PARALLEL_PAGES) fatal = err; // nothing works: stop early
        }
        setProgress({ done: ++done, total });
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PAGES, total) }, worker));
    pdf.close();
    setProgress(null);

    if (fatal) {
      setError(errorText(fatal));
      return;
    }

    const products: Draft["products"] = [];
    const failedPages: number[] = [];
    results.forEach((result, i) => {
      if (result === "skipped") return;
      if (!result) return void failedPages.push(i + 1);
      for (const p of result.products) {
        if (!p.name || !(p.price > 0)) continue;
        products.push({
          store,
          name: p.name,
          price: p.price,
          oldPrice: p.old_price,
          discount:
            p.discount_percent ?? (p.old_price && p.old_price > p.price ? (1 - p.price / p.old_price) * 100 : null),
          size: p.size,
          unitPrice: p.unit_price,
          unit: p.unit,
          category: p.category,
          page: i + 1,
        });
      }
    });
    if (!products.length) {
      setError("Не открих продукти в тази брошура.");
      return;
    }
    const pick = (key: "valid_from" | "valid_to") =>
      results
        .map((r) => (r && r !== "skipped" ? r[key] : null))
        .find((d): d is string => !!d && ISO_DATE.test(d)) ?? "";
    const next: Draft = {
      store,
      fileName: file.name,
      validFrom: pick("valid_from"),
      validTo: pick("valid_to"),
      products,
      failedPages,
    };
    if (next.validFrom && next.validTo && !failedPages.length) await save(next);
    else setDraft(next);
  }

  async function save(d: Draft) {
    await db.transaction("rw", db.leaflets, db.products, async () => {
      const leafletId = await db.leaflets.add({
        store: d.store,
        fileName: d.fileName,
        validFrom: d.validFrom,
        validTo: d.validTo,
        productCount: d.products.length,
        createdAt: Date.now(),
      });
      await db.products.bulkAdd(d.products.map((p) => ({ ...p, leafletId })));
    });
    setDraft(null);
  }

  const busy = !!progress;

  return (
    <details className="card manual">
      <summary>Качи PDF брошура ръчно</summary>
      <p className="muted small">
        За брошури, които седмичното обновяване не покрива (напр. Fantastico). Разчита се от Claude Haiku през API —
        около 0,10 € за брошура и изисква кредит в API акаунта. Офертите остават само на това устройство.
      </p>
      <div className="row wrap">
        <label>
          Магазин{" "}
          <select value={store} onChange={(e) => setStore(e.target.value as Store)} disabled={busy}>
            {STORES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
          Избери PDF
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void process(file);
          }}
        />
      </div>
      {progress && (
        <div className="progress-wrap">
          <progress value={progress.done} max={progress.total} />
          <span className="muted small">
            Разчитам страница {Math.min(progress.done + 1, progress.total)} от {progress.total}… Не затваряй страницата.
          </span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {draft && (
        <div className="draft">
          <p>
            Открих <strong>{draft.products.length}</strong> продукта в „{draft.fileName}“.
            {draft.failedPages.length > 0 && (
              <span className="error"> Не успях да разчета страници: {draft.failedPages.join(", ")}.</span>
            )}
          </p>
          <p className="muted small">Провери периода на валидност на офертите:</p>
          <div className="row wrap">
            <label>
              От{" "}
              <input type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} />
            </label>
            <label>
              До{" "}
              <input type="date" value={draft.validTo} onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} />
            </label>
            <button className="primary" disabled={!draft.validFrom || !draft.validTo} onClick={() => save(draft)}>
              Запази
            </button>
            <button className="ghost" onClick={() => setDraft(null)}>
              Откажи
            </button>
          </div>
        </div>
      )}
    </details>
  );
}

export function LeafletsPage() {
  const { shared } = useOffers();
  const local = useLiveQuery(() => db.leaflets.orderBy("validTo").reverse().toArray(), []);
  const now = today();
  const localActive = local?.filter((l) => l.validTo >= now) ?? [];
  const expired = local?.filter((l) => l.validTo < now) ?? [];

  return (
    <>
      <h1>Брошури</h1>
      <p className="muted">
        Брошурите на Kaufland, Lidl и Billa се обновяват всяка седмица и са общи за всички.
        {shared?.updatedAt &&
          ` Последно обновяване: ${new Date(shared.updatedAt).toLocaleDateString("bg-BG", { day: "numeric", month: "long" })}.`}
      </p>
      {shared?.error && <p className="error">{shared.error}</p>}
      {shared && shared.leaflets.length === 0 && localActive.length === 0 && (
        <p className="muted">Няма активни брошури.</p>
      )}

      {shared?.leaflets.map((l) => (
        <div key={l.id} className="card row">
          <div className="grow">
            <span className={`store store-${l.store.toLowerCase()}`}>{l.store}</span>
            <div>
              {formatDate(l.validFrom)} – {formatDate(l.validTo)}
              {l.validFrom > now && <span className="muted"> (предстояща)</span>}
            </div>
            <div className="muted small">{l.productCount} продукта</div>
          </div>
          {l.sourceUrl && (
            <a className="button ghost" href={l.sourceUrl} target="_blank" rel="noreferrer">
              Разгледай
            </a>
          )}
        </div>
      ))}

      {localActive.map((l) => (
        <div key={l.id} className="card row">
          <div className="grow">
            <span className={`store store-${l.store.toLowerCase()}`}>{l.store}</span>
            <div>
              {formatDate(l.validFrom)} – {formatDate(l.validTo)}
              {l.validFrom > now && <span className="muted"> (предстояща)</span>}
            </div>
            <div className="muted small">
              {l.productCount} продукта · качена на това устройство · {l.fileName}
            </div>
          </div>
          <button
            className="icon"
            title="Изтрий брошурата"
            onClick={() => confirm(`Да изтрия ли брошурата на ${l.store}?`) && deleteLeaflet(l.id)}
          >
            🗑
          </button>
        </div>
      ))}

      {expired.length > 0 && (
        <p className="muted small">
          {expired.length} изтекли {expired.length === 1 ? "брошура е скрита" : "брошури са скрити"}.{" "}
          <button className="link" onClick={() => expired.forEach((l) => deleteLeaflet(l.id))}>
            Изтрий ги
          </button>
        </p>
      )}

      <ManualUpload />
    </>
  );
}
