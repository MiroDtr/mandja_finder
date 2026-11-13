import Dexie, { type EntityTable } from "dexie";

export const STORES = ["Kaufland", "Lidl", "Billa", "Fantastico"] as const;
export type Store = (typeof STORES)[number];

export interface Leaflet {
  id: number;
  store: Store;
  fileName: string;
  validFrom: string; // YYYY-MM-DD
  validTo: string;
  productCount: number;
  createdAt: number;
}

export interface Product {
  id: number;
  leafletId: number;
  store: Store;
  name: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  size: string | null;
  unitPrice: number | null;
  unit: "кг" | "л" | null;
  category: string;
  page: number;
}

export interface CartItem {
  id: number;
  name: string;
  size: string | null;
  price: number; // per piece; unused for weighed items
  qty: number;
  weighed: boolean;
  pricePerKg: number | null;
  weightKg: number | null;
  unclear: boolean;
  thumb: string;
  createdAt: number;
}

export interface BoughtItem {
  id: number;
  name: string;
  amount: string;
  addedAt: number;
}

export interface ChatTurn {
  q: string;
  a: string;
  products: Product[];
}

export interface Chat {
  id: number;
  createdAt: number;
  turns: ChatTurn[];
}

export interface Setting {
  key: string;
  value: unknown;
}

export const db = new Dexie("mandja-finder") as Dexie & {
  leaflets: EntityTable<Leaflet, "id">;
  products: EntityTable<Product, "id">;
  cart: EntityTable<CartItem, "id">;
  bought: EntityTable<BoughtItem, "id">;
  chats: EntityTable<Chat, "id">;
  settings: EntityTable<Setting, "key">;
};

db.version(1).stores({
  leaflets: "++id, validTo",
  products: "++id, leafletId",
  cart: "++id",
  bought: "++id",
  chats: "++id, createdAt",
  settings: "key",
});

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export function setSetting(key: string, value: unknown) {
  return db.settings.put({ key, value });
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Products from leaflets that have not expired yet. */
export async function activeProducts(): Promise<Product[]> {
  const ids = (await db.leaflets.where("validTo").aboveOrEqual(today()).toArray()).map((l) => l.id);
  return db.products.where("leafletId").anyOf(ids).toArray();
}

export async function deleteLeaflet(id: number) {
  await db.transaction("rw", db.leaflets, db.products, async () => {
    await db.products.where("leafletId").equals(id).delete();
    await db.leaflets.delete(id);
  });
}

export function cartLineTotal(item: CartItem): number {
  if (item.weighed) return (item.pricePerKg ?? 0) * (item.weightKg ?? 0);
  return item.price * item.qty;
}

export function euro(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
