import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { callAI, errorText } from "../api";
import { db, getSetting, preferencesText, setSetting } from "../db";
import type { TabId } from "../App";

const MEALS = ["Закуска", "Обяд", "Вечеря", "Десерт"];

interface Recipe {
  meal: string;
  title: string;
  minutes: number;
  ingredients: { text: string; missing: boolean }[];
  steps: string[];
  used_item_ids: number[];
  cooked?: boolean;
}

export function RecipesPage({ goTo }: { goTo: (tab: TabId) => void }) {
  const items = useLiveQuery(() => db.bought.orderBy("id").reverse().toArray(), []);
  const [skipped, setSkipped] = useState<Set<number>>(new Set()); // unticked items; new ones start ticked
  const [meals, setMeals] = useState<string[]>(["Обяд", "Вечеря"]);
  const [servings, setServings] = useState(2);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSetting("recipeForm", { meals: ["Обяд", "Вечеря"], servings: 2 }).then((saved) => {
      setMeals(saved.meals);
      setServings(saved.servings);
    });
  }, []);

  const chosen = items?.filter((i) => !skipped.has(i.id)) ?? [];

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  }

  async function generate(more: boolean) {
    setBusy(true);
    setError("");
    void setSetting("recipeForm", { meals, servings });
    try {
      const result = await callAI<{ recipes: Recipe[] }>("recipes", {
        items: chosen.map((i) => `${i.id} | ${i.name} | ${i.amount || "-"}`).join("\n"),
        meals: MEALS.filter((m) => meals.includes(m)),
        servings,
        preferences: await preferencesText(),
        exclude: more ? recipes.map((r) => r.title) : [],
      });
      setRecipes(more ? [...recipes, ...result.recipes] : result.recipes);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  async function cook(index: number) {
    const recipe = recipes[index];
    const ids = recipe.used_item_ids.filter((id) => items?.some((i) => i.id === id));
    await db.bought.bulkDelete(ids);
    setRecipes(recipes.map((r, i) => (i === index ? { ...r, cooked: true } : r)));
  }

  if (items && items.length === 0 && recipes.length === 0) {
    return (
      <>
        <h1>Рецепти</h1>
        <div className="empty">
          <p>Списъкът с налични продукти е празен. Рецептите се предлагат според продуктите, които имаш.</p>
          <button className="primary" onClick={() => goTo("cart")}>
            Към количката
          </button>
        </div>
      </>
    );
  }

  const nameOf = (id: number) => items?.find((i) => i.id === id)?.name;

  return (
    <>
      <h1>Рецепти</h1>
      <div className="card">
        <h3>Какво да сготвя?</h3>
        <div className="chips">
          {MEALS.map((m) => (
            <button
              key={m}
              className={meals.includes(m) ? "chip on" : "chip"}
              onClick={() => setMeals(meals.includes(m) ? meals.filter((x) => x !== m) : [...meals, m])}
            >
              {m}
            </button>
          ))}
        </div>
        <label className="row servings">
          Порции
          <div className="stepper">
            <button aria-label="По-малко порции" onClick={() => setServings(Math.max(1, servings - 1))}>
              −
            </button>
            <span>{servings}</span>
            <button aria-label="Повече порции" onClick={() => setServings(Math.min(12, servings + 1))}>
              +
            </button>
          </div>
        </label>

        <h3>С кои продукти?</h3>
        <div className="checks">
          {items?.map((item) => (
            <label key={item.id} className="check">
              <input
                type="checkbox"
                checked={!skipped.has(item.id)}
                onChange={() => setSkipped(toggle(skipped, item.id))}
              />
              {item.name}
              {item.amount && <span className="muted small"> · {item.amount}</span>}
            </label>
          ))}
        </div>
        <p className="muted small">Подправки, сол и олио се приемат за налични.</p>
        <button className="primary" disabled={busy || !meals.length || !chosen.length} onClick={() => generate(false)}>
          {busy ? "Измислям рецепти…" : "Предложи рецепти"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      {recipes.map((recipe, index) => (
        <div key={index} className={recipe.cooked ? "card recipe cooked" : "card recipe"}>
          <div className="muted small">
            {recipe.meal} · {recipe.minutes} мин
          </div>
          <h2>{recipe.title}</h2>
          <ul>
            {recipe.ingredients.map((ing, i) => (
              <li key={i}>
                {ing.text}
                {ing.missing && <span className="missing"> липсва</span>}
              </li>
            ))}
          </ul>
          <ol>
            {recipe.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {recipe.cooked ? (
            <p className="notice">✓ Избрана. Използваните продукти са премахнати от „Налични продукти“.</p>
          ) : (
            <>
              <button className="primary" onClick={() => cook(index)}>
                Ще сготвя това
              </button>
              <p className="muted small">
                Ще премахне от „Налични продукти“:{" "}
                {recipe.used_item_ids.map(nameOf).filter(Boolean).join(", ") || "нищо"}
              </p>
            </>
          )}
        </div>
      ))}
      {recipes.length > 0 && (
        <button className="ghost" disabled={busy || !chosen.length || !meals.length} onClick={() => generate(true)}>
          {busy ? "Измислям…" : "Още рецепти"}
        </button>
      )}
    </>
  );
}
