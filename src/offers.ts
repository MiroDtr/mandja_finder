import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { activeProducts, getPreferences, today, type Preferences, type Product, type Store } from "./db";

/** A leaflet processed by the weekly update and published in /offers.json (shared by everyone). */
export interface SharedLeaflet {
  id: string;
  store: Store;
  title: string;
  validFrom: string;
  validTo: string;
  sourceUrl: string | null;
  productCount: number;
}

interface OffersFile {
  updatedAt: string;
  leaflets: SharedLeaflet[];
  products: (Omit<Product, "id" | "leafletId"> & { id: number; leafletId: string })[];
}

export interface SharedOffers {
  updatedAt: string | null;
  leaflets: SharedLeaflet[];
  products: Product[];
  error: string | null;
}

let cache: Promise<SharedOffers> | null = null;

function loadShared(): Promise<SharedOffers> {
  cache ??= fetch("/offers.json", { cache: "no-cache" })
    .then(async (res) => {
      if (res.status === 404) return { updatedAt: null, leaflets: [], products: [], error: null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OffersFile;
      const now = today();
      const live = new Set(data.leaflets.filter((l) => l.validTo >= now).map((l) => l.id));
      return {
        updatedAt: data.updatedAt,
        leaflets: data.leaflets.filter((l) => live.has(l.id)),
        // Negative ids keep shared products apart from leaflets uploaded on this device.
        products: data.products
          .filter((p) => live.has(p.leafletId))
          .map((p) => ({ ...p, id: -p.id, leafletId: -1 })),
        error: null,
      };
    })
    .catch(() => {
      cache = null;
      return { updatedAt: null, leaflets: [], products: [], error: "Офертите не можаха да се заредят." };
    });
  return cache;
}

/** Shared weekly offers plus any leaflets uploaded on this device. */
export function useOffers() {
  const [shared, setShared] = useState<SharedOffers | null>(null);
  const local = useLiveQuery(activeProducts, []);
  useEffect(() => {
    void loadShared().then(setShared);
  }, []);
  const products = shared && local ? [...shared.products, ...local] : undefined;
  return { shared, products };
}

// ---------------------------------------------------------------- search

/** Lowercase, and fold letters that change between Bulgarian word forms (мляко / млека). */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/я/g, "е").replace(/ю/g, "у").replace(/й/g, "и").replace(/ъ/g, "а");
}

function stem(word: string): string {
  return word.length <= 3 ? word : word.slice(0, Math.max(3, word.length - 2));
}

const words = (s: string) => normalize(s).split(/[^a-zа-я0-9%]+/i).filter(Boolean);

/** True when every word of the query matches the start of some word in the text. */
export function matches(text: string, query: string): boolean {
  const hay = words(text);
  return words(query).every((q) => {
    const s = stem(q);
    return hay.some((w) => w.startsWith(s));
  });
}

export function usePreferences(): Preferences | undefined {
  return useLiveQuery(getPreferences, []);
}

/** Does a product mention any of the items (e.g. an allergy list)? */
export function mentionsAny(p: Product, items: string[]): boolean {
  return items.some((item) => matches(`${p.name} ${p.category}`, item));
}
