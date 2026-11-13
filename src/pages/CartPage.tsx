import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { callAI, errorText } from "../api";
import { cartLineTotal, db, euro, type CartItem } from "../db";
import { preparePhoto } from "../images";
import type { TabId } from "../App";

interface LabelResult {
  readable: boolean;
  name: string;
  size: string | null;
  price: number;
  is_weighed: boolean;
  price_per_kg: number | null;
  unclear: boolean;
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();

/** Number input that keeps what the user typed (comma or dot) and commits on blur. */
function NumberField(props: {
  value: number | null;
  onCommit: (value: number | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={props.className}
      inputMode="decimal"
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      value={draft ?? (props.value == null ? "" : String(props.value).replace(".", ","))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft == null) return;
        const n = parseFloat(draft.replace(",", "."));
        props.onCommit(Number.isFinite(n) && n >= 0 ? n : null);
        setDraft(null);
      }}
    />
  );
}

export function CartPage({ goTo }: { goTo: (tab: TabId) => void }) {
  const items = useLiveQuery(() => db.cart.orderBy("id").reverse().toArray(), []);
  const [scanning, setScanning] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);

  async function scan(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setNotice("");
    const list = Array.from(files);
    setScanning(list.length);
    for (const file of list) {
      try {
        const { image, thumb } = await preparePhoto(file);
        const label = await callAI<LabelResult>("label", { image });
        if (!label.readable || !label.name) {
          setError("Не успях да разчета етикета. Снимай го отблизо и опитай пак.");
        } else {
          const weighed = label.is_weighed && label.price_per_kg != null;
          const same =
            !weighed &&
            (await db.cart
              .filter(
                (i) =>
                  !i.weighed &&
                  norm(i.name) === norm(label.name) &&
                  norm(i.size) === norm(label.size) &&
                  Math.abs(i.price - label.price) < 0.005,
              )
              .first());
          if (same) {
            await db.cart.update(same.id, { qty: same.qty + 1 });
            setNotice(`+1 „${same.name}“`);
          } else {
            await db.cart.add({
              name: label.name,
              size: label.size,
              price: weighed ? 0 : label.price,
              qty: 1,
              weighed,
              pricePerKg: label.price_per_kg,
              weightKg: null,
              unclear: label.unclear || (!weighed && !(label.price > 0)),
              thumb,
              createdAt: Date.now(),
            });
          }
        }
      } catch (err) {
        setError(errorText(err));
      }
      setScanning((n) => n - 1);
    }
  }

  async function finish() {
    if (!items?.length) return;
    if (!confirm("Приключваш пазаруването? Продуктите ще се преместят в „Купени“.")) return;
    await db.transaction("rw", db.cart, db.bought, async () => {
      await db.bought.bulkAdd(
        items
          .slice()
          .reverse()
          .map((i) => ({
            name: i.name,
            amount: i.weighed
              ? i.weightKg
                ? `${String(i.weightKg).replace(".", ",")} кг`
                : ""
              : [i.qty > 1 ? `${i.qty} бр.` : "", i.size ?? ""].filter(Boolean).join(" × "),
            addedAt: Date.now(),
          })),
      );
      await db.cart.clear(); // also discards the label thumbnails
    });
    goTo("bought");
  }

  const update = (id: number, changes: Partial<CartItem>) => db.cart.update(id, changes);
  const total = items?.reduce((sum, i) => sum + cartLineTotal(i), 0) ?? 0;
  const missingWeight = items?.some((i) => i.weighed && !i.weightKg);

  return (
    <>
      <h1>Количка</h1>
      <div className="row wrap">
        <button className="primary" disabled={scanning > 0} onClick={() => camera.current?.click()}>
          📷 Снимай етикет
        </button>
        <button className="ghost" disabled={scanning > 0} onClick={() => upload.current?.click()}>
          Качи снимки
        </button>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void scan(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={upload}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void scan(e.target.files);
            e.target.value = "";
          }}
        />
        {scanning > 0 && <span className="muted">Разчитам етикета…</span>}
        {notice && scanning === 0 && <span className="notice">{notice}</span>}
      </div>
      {error && <p className="error">{error}</p>}

      {items && items.length === 0 && scanning === 0 && (
        <p className="muted">Количката е празна. Снимай етикета с цената на продукта, за да го добавиш.</p>
      )}

      <div className="cart-list">
        {items?.map((item) => (
          <div key={item.id} className={item.unclear ? "card cart-item unclear" : "card cart-item"}>
            {item.thumb && <img className="thumb" src={item.thumb} alt="" />}
            <div className="grow cart-fields">
              <input
                className="cart-name"
                aria-label="Име"
                defaultValue={item.name}
                onBlur={(e) => update(item.id, { name: e.target.value.trim() || item.name })}
              />
              <input
                className="cart-size"
                aria-label="Разфасовка"
                placeholder="разфасовка"
                defaultValue={item.size ?? ""}
                onBlur={(e) => update(item.id, { size: e.target.value.trim() || null })}
              />
              {item.unclear && (
                <button className="link small" onClick={() => update(item.id, { unclear: false })}>
                  ⚠ провери данните · наред е
                </button>
              )}
              <div className="row wrap cart-numbers">
                {item.weighed ? (
                  <>
                    <NumberField
                      className={item.weightKg ? "num" : "num needs"}
                      ariaLabel="Тегло в кг"
                      placeholder="кг"
                      value={item.weightKg}
                      onCommit={(v) => update(item.id, { weightKg: v })}
                    />
                    <span className="muted">кг ×</span>
                    <NumberField
                      className="num"
                      ariaLabel="Цена за кг"
                      value={item.pricePerKg}
                      onCommit={(v) => update(item.id, { pricePerKg: v ?? 0 })}
                    />
                    <span className="muted">€/кг</span>
                  </>
                ) : (
                  <>
                    <div className="stepper">
                      <button
                        aria-label="Намали"
                        onClick={() => (item.qty > 1 ? update(item.id, { qty: item.qty - 1 }) : db.cart.delete(item.id))}
                      >
                        −
                      </button>
                      <span>{item.qty}</span>
                      <button aria-label="Увеличи" onClick={() => update(item.id, { qty: item.qty + 1 })}>
                        +
                      </button>
                    </div>
                    <span className="muted">×</span>
                    <NumberField
                      className="num"
                      ariaLabel="Цена"
                      value={item.price}
                      onCommit={(v) => update(item.id, { price: v ?? 0 })}
                    />
                    <span className="muted">€</span>
                  </>
                )}
              </div>
            </div>
            <div className="cart-right">
              <button className="icon" title="Премахни" onClick={() => db.cart.delete(item.id)}>
                ✕
              </button>
              <strong>{euro(cartLineTotal(item))}</strong>
            </div>
          </div>
        ))}
      </div>

      {items && items.length > 0 && (
        <div className="total-bar">
          <div className="grow">
            <div className="muted small">Общо{missingWeight ? " (без продуктите без въведено тегло)" : ""}</div>
            <div className="total">{euro(total)}</div>
          </div>
          <button className="primary" onClick={finish}>
            Приключих пазаруването
          </button>
        </div>
      )}
    </>
  );
}
