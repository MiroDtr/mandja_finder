import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { authListeners, callAI, errorText, getPassword, setPassword } from "./api";
import { db } from "./db";
import { DealsPage } from "./pages/DealsPage";
import { LeafletsPage } from "./pages/LeafletsPage";
import { CartPage } from "./pages/CartPage";
import { BoughtPage } from "./pages/BoughtPage";
import { RecipesPage } from "./pages/RecipesPage";
import { HistoryPage } from "./pages/HistoryPage";
import { PreferencesPage } from "./pages/PreferencesPage";

const TABS = [
  { id: "deals", icon: "🔎", label: "Оферти" },
  { id: "leaflets", icon: "📰", label: "Брошури" },
  { id: "cart", icon: "🛒", label: "Количка" },
  { id: "bought", icon: "🧺", label: "Налични продукти" },
  { id: "recipes", icon: "🍳", label: "Рецепти" },
  { id: "history", icon: "🕘", label: "История" },
  { id: "prefs", icon: "❤️", label: "Предпочитания" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await callAI("ping", {}, value);
      setPassword(value);
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  return (
    <form className="login" onSubmit={submit}>
      <div className="login-logo">🍲</div>
      <h1>Манджа Finder</h1>
      <p className="muted">Въведи паролата, за да продължиш.</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Парола"
        autoFocus
        autoComplete="current-password"
      />
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !value}>
        {busy ? "Проверявам…" : "Вход"}
      </button>
    </form>
  );
}

export function App() {
  const [authed, setAuthed] = useState(() => !!getPassword());
  const [tab, setTab] = useState<TabId>("deals");
  const [menuOpen, setMenuOpen] = useState(false);
  const cartCount = useLiveQuery(() => db.cart.count(), []) ?? 0;

  useEffect(() => {
    const onReject = () => setAuthed(false);
    authListeners.add(onReject);
    return () => void authListeners.delete(onReject);
  }, []);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  // Every page stays mounted so a running leaflet upload or an open chat survives a tab switch.
  const page = (id: TabId, node: React.ReactNode) => (
    <section className="page" hidden={tab !== id}>
      {node}
    </section>
  );

  const go = (id: TabId) => {
    setTab(id);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">🍲 Манджа Finder</div>
        <button
          className="burger"
          aria-label={menuOpen ? "Затвори менюто" : "Отвори менюто"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "✕" : "☰"}
          {!menuOpen && cartCount > 0 && <span className="badge dot">{cartCount}</span>}
        </button>
      </header>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <nav className={menuOpen ? "nav open" : "nav"}>
        <div className="brand">🍲 Манджа Finder</div>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "nav-item active" : "nav-item"} onClick={() => go(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
            {t.id === "cart" && cartCount > 0 && <span className="badge">{cartCount}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {page("deals", <DealsPage goTo={go} />)}
        {page("leaflets", <LeafletsPage />)}
        {page("cart", <CartPage goTo={go} />)}
        {page("bought", <BoughtPage goTo={go} />)}
        {page("recipes", <RecipesPage goTo={go} />)}
        {page("history", <HistoryPage />)}
        {page("prefs", <PreferencesPage />)}
      </main>
    </div>
  );
}
