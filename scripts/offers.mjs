// Weekly offers pipeline, run from Claude Code (see .claude/skills/update-offers/SKILL.md).
//
//   node scripts/offers.mjs discover            list current leaflets of Kaufland, Lidl, Billa
//   node scripts/offers.mjs prepare <key...>    download leaflets, write page text + images
//   node scripts/offers.mjs status              show which pages still need extracting
//   node scripts/offers.mjs build               merge extracted pages into public/offers.json
//
// Keys come from `discover` (e.g. "lidl:16-11-22-11"). A Fantastico (or any) PDF placed in
// offers-inbox/ is prepared with: prepare "file:Fantastico:2026-11-20:2026-11-26:offers-inbox/x.pdf"

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.join(ROOT, "offers-work");
const OUT = path.join(ROOT, "public", "offers.json");
const CANDIDATES = path.join(WORK, "candidates.json");
const UA = "Pazarko/2.0 (personal offers list)";

const CATEGORIES = [
  "Месо и колбаси", "Риба", "Млечни продукти", "Плодове и зеленчуци", "Хляб и тестени", "Напитки",
  "Алкохол", "Сладко и снаксове", "Замразени", "Готови храни", "Пакетирани и консерви", "Нехранителни", "Друго",
];

const get = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};
const uniq = (a) => [...new Set(a)];
const today = () => new Date().toISOString().slice(0, 10);
const slugify = (s) => s.replace(/[^a-zA-Z0-9-]+/g, "_");

// ---------------------------------------------------------------- discover

async function schwarzFlyer(store, id) {
  const url = `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${encodeURIComponent(id)}&region_id=0`;
  const f = (await (await get(url)).json()).flyer;
  return {
    key: `${store.toLowerCase()}:${id}`,
    store,
    title: `${f.title} · ${f.name}`.trim(),
    validFrom: f.offerStartDate ?? f.startDate,
    validTo: f.offerEndDate ?? f.endDate,
    pages: f.pages?.length ?? null,
    pdfUrl: f.pdfUrl,
    sourceUrl: f.flyerUrlAbsolute ?? null,
  };
}

async function discoverKaufland() {
  const html = await (await get("https://www.kaufland.bg/broshuri.html")).text();
  const ids = uniq([...html.matchAll(/leaflets\.kaufland\.com\/bg-BG\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  return Promise.all(ids.map((id) => schwarzFlyer("Kaufland", id)));
}

async function discoverLidl() {
  const html = await (await get("https://www.lidl.bg/c/broshura/s10020060")).text();
  const ids = uniq([...html.matchAll(/\/l\/bg\/broshura\/([A-Za-z0-9-]+)\//g)].map((m) => m[1]));
  return Promise.all(ids.map((id) => schwarzFlyer("Lidl", id)));
}

async function discoverBilla() {
  const html = await (await get("https://www.billa.bg/promocii/sedmichna-broshura")).text();
  const slugs = uniq([...html.matchAll(/view\.publitas\.com\/billa-bulgaria\/(bg_weekly[A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const out = [];
  for (const slug of slugs) {
    const viewer = `https://view.publitas.com/billa-bulgaria/${slug}/`;
    const page = await (await get(viewer)).text();
    const pdf = page.match(/"downloadPdfUrl":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&");
    const d = slug.match(/(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{4})/); // 19-11-25-11-2026
    out.push({
      key: `billa:${slug}`,
      store: "Billa",
      title: "Седмична брошура",
      validFrom: d ? `${d[5]}-${d[2]}-${d[1]}` : null,
      validTo: d ? `${d[5]}-${d[4]}-${d[3]}` : null,
      pages: null,
      pdfUrl: pdf ?? null,
      sourceUrl: viewer,
    });
  }
  return out;
}

async function discover() {
  const results = [];
  for (const [name, fn] of [["Kaufland", discoverKaufland], ["Lidl", discoverLidl], ["Billa", discoverBilla]]) {
    try {
      results.push(...(await fn()));
    } catch (e) {
      console.log(`! ${name}: ${e.message}`);
    }
  }
  const live = results.filter((r) => !r.validTo || r.validTo >= today());
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(CANDIDATES, JSON.stringify(live, null, 2));
  for (const r of live) {
    console.log(`${r.key}\n    ${r.store} | ${r.title} | ${r.validFrom} → ${r.validTo} | pages: ${r.pages ?? "?"}${r.pdfUrl ? "" : " | NO PDF"}`);
  }
  console.log(`\n${live.length} current leaflets saved to offers-work/candidates.json`);
}

// ---------------------------------------------------------------- prepare

const PRICE = /\d+[.,]\d{2}/;

/** Page text laid out as lines (top to bottom), each item tagged with its x position in % of page width. */
function layoutText(items, viewport) {
  const rows = [];
  for (const it of items) {
    const s = it.str.trim();
    if (!s) continue;
    const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
    const px = Math.round((x / viewport.width) * 100);
    const py = (y / viewport.height) * 100;
    let row = rows.find((r) => Math.abs(r.y - py) < 0.8);
    if (!row) rows.push((row = { y: py, parts: [] }));
    row.parts.push({ x: px, s });
  }
  rows.sort((a, b) => a.y - b.y);
  return rows
    .map((r) => `y${Math.round(r.y).toString().padStart(2, "0")}: ` + r.parts.sort((a, b) => a.x - b.x).map((p) => `[x${p.x}] ${p.s}`).join("  "))
    .join("\n");
}

async function prepareOne(c) {
  const dir = path.join(WORK, slugify(c.key));
  fs.mkdirSync(dir, { recursive: true });
  const pdfPath = path.join(dir, "leaflet.pdf");
  if (!fs.existsSync(pdfPath)) {
    if (c.localPath) fs.copyFileSync(path.resolve(ROOT, c.localPath), pdfPath);
    else {
      console.log(`  downloading ${c.pdfUrl.slice(0, 90)}…`);
      fs.writeFileSync(pdfPath, Buffer.from(await (await get(c.pdfUrl)).arrayBuffer()));
    }
  }
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const text = layoutText((await page.getTextContent()).items, base);
    const hasText = text.length > 40;
    // Pages whose text layer has no price are covers, ads or info pages: skip them.
    if (hasText && !PRICE.test(text)) continue;
    const id = `p${String(n).padStart(3, "0")}`;
    const vp = page.getViewport({ scale: 1600 / Math.max(base.width, base.height) });
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    fs.writeFileSync(path.join(dir, `${id}.jpg`), await canvas.encode("jpeg", 80));
    fs.writeFileSync(path.join(dir, `${id}.txt`), hasText ? text : "(no text layer — read the image)");
    pages.push({ id, page: n });
    page.cleanup();
  }
  const meta = { ...c, dir: path.relative(ROOT, dir).replace(/\\/g, "/"), totalPages: pdf.numPages, pages };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  await task.destroy();
  console.log(`✓ ${c.key}: ${pages.length} of ${pdf.numPages} pages have prices → ${meta.dir}`);
}

async function prepare(keys) {
  const candidates = fs.existsSync(CANDIDATES) ? JSON.parse(fs.readFileSync(CANDIDATES, "utf8")) : [];
  for (const key of keys) {
    let c = candidates.find((x) => x.key === key);
    if (key.startsWith("file:")) {
      const [, store, validFrom, validTo, file] = key.split(":");
      c = { key: `${store.toLowerCase()}:${path.basename(file, ".pdf")}`, store, title: path.basename(file), validFrom, validTo, localPath: file };
    }
    if (!c) {
      console.log(`! unknown key ${key} — run discover first`);
      continue;
    }
    if (!c.pdfUrl && !c.localPath) {
      console.log(`! ${key} has no PDF`);
      continue;
    }
    await prepareOne(c);
  }
}

// ---------------------------------------------------------------- status / build

function prepared() {
  if (!fs.existsSync(WORK)) return [];
  return fs
    .readdirSync(WORK)
    .map((d) => path.join(WORK, d, "meta.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
}

function status() {
  for (const m of prepared()) {
    const missing = m.pages.filter((p) => !fs.existsSync(path.join(ROOT, m.dir, `${p.id}.json`))).map((p) => p.id);
    console.log(`${m.key} (${m.store}, ${m.validFrom} → ${m.validTo}): ${m.pages.length - missing.length}/${m.pages.length} pages extracted`);
    if (missing.length) console.log(`    missing: ${missing.join(" ")}`);
  }
}

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function build() {
  const leaflets = [];
  const products = [];
  const problems = [];
  for (const m of prepared()) {
    if (m.validTo && m.validTo < today()) continue; // expired
    const before = products.length;
    for (const p of m.pages) {
      const file = path.join(ROOT, m.dir, `${p.id}.json`);
      if (!fs.existsSync(file)) {
        problems.push(`${m.key} ${p.id}: not extracted`);
        continue;
      }
      let items;
      try {
        items = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (e) {
        problems.push(`${m.key} ${p.id}: invalid JSON (${e.message})`);
        continue;
      }
      for (const it of Array.isArray(items) ? items : items.products ?? []) {
        const price = num(it.price);
        if (!it.name || !price) {
          problems.push(`${m.key} ${p.id}: skipped item without name/price: ${JSON.stringify(it).slice(0, 80)}`);
          continue;
        }
        const oldPrice = num(it.old_price);
        products.push({
          id: products.length + 1,
          leafletId: m.key,
          store: m.store,
          name: String(it.name).trim(),
          price,
          oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
          discount: num(it.discount_percent) ?? (oldPrice && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : null),
          size: it.size ? String(it.size).trim() : null,
          unitPrice: num(it.unit_price),
          unit: it.unit === "кг" || it.unit === "л" ? it.unit : null,
          category: CATEGORIES.includes(it.category) ? it.category : "Друго",
          page: p.page,
        });
      }
    }
    leaflets.push({
      id: m.key,
      store: m.store,
      title: m.title,
      validFrom: m.validFrom,
      validTo: m.validTo,
      sourceUrl: m.sourceUrl ?? null,
      productCount: products.length - before,
    });
  }
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), leaflets, products }));
  for (const l of leaflets) console.log(`${l.store.padEnd(10)} ${l.validFrom} → ${l.validTo}  ${l.productCount} products  (${l.id})`);
  console.log(`\nWrote public/offers.json: ${leaflets.length} leaflets, ${products.length} products.`);
  if (problems.length) console.log(`\n${problems.length} problems:\n  ` + problems.slice(0, 30).join("\n  "));
}

// ---------------------------------------------------------------- main

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "discover") await discover();
else if (cmd === "prepare") await prepare(args);
else if (cmd === "status") status();
else if (cmd === "build") build();
else console.log("usage: node scripts/offers.mjs discover | prepare <key...> | status | build");
