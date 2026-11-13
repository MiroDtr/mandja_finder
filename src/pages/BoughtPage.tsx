import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { TabId } from "../App";

export function BoughtPage({ goTo }: { goTo: (tab: TabId) => void }) {
  const items = useLiveQuery(() => db.bought.orderBy("id").reverse().toArray(), []);

  return (
    <>
      <div className="row">
        <h1 className="grow">Купени</h1>
        {items && items.length > 0 && (
          <button className="ghost" onClick={() => confirm("Да изчистя ли целия списък?") && db.bought.clear()}>
            Изчисти всичко
          </button>
        )}
      </div>
      {items && items.length === 0 && (
        <p className="muted">
          Тук се появяват продуктите, след като натиснеш „Приключих пазаруването“ в количката.
        </p>
      )}
      {items && items.length > 0 && (
        <>
          <div className="card list">
            {items.map((item) => (
              <div key={item.id} className="row list-row">
                <div className="grow">
                  {item.name}
                  {item.amount && <span className="muted small"> · {item.amount}</span>}
                </div>
                <button className="icon" title="Премахни" onClick={() => db.bought.delete(item.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button className="primary" onClick={() => goTo("recipes")}>
            🍳 Предложи рецепти
          </button>
        </>
      )}
    </>
  );
}
