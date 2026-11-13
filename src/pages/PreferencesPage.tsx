import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getPreferences, updatePreferences, type PrefKind, type Preferences } from "../db";

const FIELDS: { kind: PrefKind; title: string; hint: string; placeholder: string; suggestions: string[] }[] = [
  {
    kind: "likes",
    title: "Харесвам",
    hint: "Ще бъдат предпочитани в офертите и рецептите.",
    placeholder: "напр. пилешко",
    suggestions: ["Пилешко", "Свинско", "Риба", "Сирене", "Паста", "Ориз", "Зеленчуци", "Люто"],
  },
  {
    kind: "dislikes",
    title: "Не харесвам",
    hint: "Ще бъдат избягвани.",
    placeholder: "напр. гъби",
    suggestions: ["Гъби", "Риба", "Карфиол", "Маслини", "Лук", "Чесън", "Карантия"],
  },
  {
    kind: "allergies",
    title: "Алергии",
    hint: "Никога няма да бъдат предлагани.",
    placeholder: "напр. ядки",
    suggestions: ["Ядки", "Фъстъци", "Глутен", "Лактоза", "Яйца", "Соя", "Морски дарове", "Риба", "Сусам"],
  },
];

function PrefField({ field, prefs }: { field: (typeof FIELDS)[number]; prefs: Preferences }) {
  const [value, setValue] = useState("");
  const items = prefs[field.kind];
  const has = (name: string) => items.some((i) => i.toLowerCase() === name.toLowerCase());

  function add(name: string) {
    const clean = name.trim();
    if (!clean) return;
    void updatePreferences(field.kind, (list) =>
      list.some((i) => i.toLowerCase() === clean.toLowerCase()) ? list : [...list, clean],
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    add(value);
    setValue("");
  }

  const remove = (name: string) => updatePreferences(field.kind, (list) => list.filter((i) => i !== name));
  const suggestions = field.suggestions.filter((s) => !has(s));

  return (
    <div className={`card pref pref-${field.kind}`}>
      <h2>{field.title}</h2>
      <p className="muted small">{field.hint}</p>
      <form className="row" onSubmit={submit}>
        <input
          className="grow"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.placeholder}
          aria-label={field.title}
        />
        <button className="primary" disabled={!value.trim()}>
          Добави
        </button>
      </form>
      {items.length > 0 && (
        <div className="tags">
          {items.map((item) => (
            <span key={item} className="tag">
              {item}
              <button aria-label={`Премахни ${item}`} onClick={() => remove(item)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="suggestions">
          <span className="muted small">Предложения:</span>
          {suggestions.map((s) => (
            <button key={s} className="suggestion" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PreferencesPage() {
  const prefs = useLiveQuery(getPreferences, []);

  return (
    <>
      <h1>Предпочитания</h1>
      <p className="muted">Асистентът взима това предвид при офертите и рецептите. Пази се само на това устройство.</p>
      {prefs && FIELDS.map((field) => <PrefField key={field.kind} field={field} prefs={prefs} />)}
    </>
  );
}
