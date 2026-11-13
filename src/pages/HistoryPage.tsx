import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { ProductGrid } from "../ProductCard";

export function HistoryPage() {
  const chats = useLiveQuery(() => db.chats.orderBy("createdAt").reverse().toArray(), []);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <h1>История</h1>
      {chats && chats.length === 0 && <p className="muted">Все още няма запазени разговори за оферти.</p>}
      {chats?.map((chat) => (
        <div key={chat.id} className="card">
          <div className="row">
            <button className="link grow left" onClick={() => setOpen(open === chat.id ? null : chat.id)}>
              <strong>{chat.turns[0]?.q}</strong>
              <div className="muted small">
                {new Date(chat.createdAt).toLocaleString("bg-BG", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                {chat.turns.length} {chat.turns.length === 1 ? "въпрос" : "въпроса"}
              </div>
            </button>
            <button
              className="icon"
              title="Изтрий разговора"
              onClick={() => confirm("Да изтрия ли този разговор?") && db.chats.delete(chat.id)}
            >
              🗑
            </button>
          </div>
          {open === chat.id &&
            chat.turns.map((turn, i) => (
              <div key={i} className="turn">
                <div className="bubble user">{turn.q}</div>
                <div className="bubble">{turn.a}</div>
                <ProductGrid products={turn.products} />
              </div>
            ))}
        </div>
      ))}
    </>
  );
}
