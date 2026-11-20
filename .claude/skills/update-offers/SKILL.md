---
name: update-offers
description: Refresh Pazarko's weekly supermarket offers. Downloads the current Kaufland, Lidl and Billa leaflets (plus any PDF in offers-inbox/), extracts every offer into public/offers.json and pushes it so Netlify publishes it. Use when the user says "update offers", "new leaflets", "обнови офертите" or similar.
---

# Update offers

The app reads offers from `public/offers.json`. This skill rebuilds that file. All AI work happens
here in Claude Code (the user's subscription) — never through the Anthropic API.

## 1. Discover

```bash
node scripts/offers.mjs discover
```

Lists current leaflets with their keys and validity dates. Pick the **food leaflets** to process:

- Kaufland: the main weekly leaflet (`KDZ`, ~60+ pages). The small `leaflet4/5/6` ones are usually
  short themed leaflets — include them if they are food (check one page if unsure). Skip `Magazine`
  and `Hyper` catalogs (non-food) unless the user asks.
- Lidl: "Седмични предложения". Skip long-running themed brochures ("Заслужава си", "Кошница").
- Billa: the weekly digital leaflet.
- If both this week's and next week's leaflets are listed, process both when this week ends within
  2 days; otherwise only this week's.

Tell the user in one line which leaflets you picked before preparing them.

**Fantastico** blocks automated access — never try to scrape it. If the user put a PDF in
`offers-inbox/`, ask for its validity dates if they are not obvious, then prepare it with
`file:Fantastico:<YYYY-MM-DD from>:<YYYY-MM-DD to>:offers-inbox/<name>.pdf`.

## 2. Prepare

```bash
node scripts/offers.mjs prepare <key> [<key> ...]
```

Downloads each PDF into `offers-work/<key>/` and writes, for every page that has prices,
`pNNN.jpg` (page image) and `pNNN.txt` (the PDF's text layer laid out by position:
`y45: [x24] 2.55  [x37] Къдрава ...`, x/y in % of the page). Pages without prices are skipped.
Run it in the background for several leaflets — big PDFs take a minute or two each.

## 3. Extract (subagents)

Split the pages of each leaflet into batches of about 10 and give each batch to a subagent
(`general-purpose`, model `sonnet`), running batches in parallel. Give each subagent the folder,
the page ids and the instructions below verbatim. Check `node scripts/offers.mjs status` afterwards
and re-run any missing pages.

> For each page id, read `<folder>/<id>.txt` and `<folder>/<id>.jpg` and write `<folder>/<id>.json`:
> a JSON array of every product offer on the page (`[]` if none). The text file has the exact
> words and numbers; the image shows which name belongs to which price. Use the text for spelling
> and numbers, the image for pairing. Each item:
>
> ```json
> {"name": "Спанак листа", "size": "500 г", "price": 1.79, "old_price": 2.55,
>  "discount_percent": 29, "unit_price": null, "unit": null, "category": "Плодове и зеленчуци"}
> ```
>
> - `name`: product name as printed (brand + product + variant), Bulgarian, no marketing words
>   ("ТОП ЦЕНА", "Супер оферта", "Само с Kaufland Card").
> - `price`: the price the customer pays now, in EUR. If both € and лв are printed use €; if only
>   лв, divide by 1.95583 and round to 2 decimals. If an offer needs a loyalty card or app
>   (Kaufland Card, Lidl Plus, BILLA app), use that price and append " (с карта)" to the name.
> - `old_price`: the crossed-out / previous price in EUR, else null.
> - `discount_percent`: the printed percentage as a positive number, else null.
> - `size`: package size as printed ("400 г", "6 x 1,5 л", "кг", "бр."), else null.
> - `unit_price` + `unit`: price per kg or litre if printed (unit "кг" or "л"). For products sold
>   by weight (size "кг") set unit_price = price and unit = "кг".
> - `category`: one of Месо и колбаси, Риба, Млечни продукти, Плодове и зеленчуци,
>   Хляб и тестени, Напитки, Алкохол, Сладко и снаксове, Замразени, Готови храни, Пакетирани и консерви,
>   Нехранителни, Друго.
> - One item per distinct product; "различни видове" offers are one item. Skip prices that are
>   not products (delivery fees, vouchers, "от X €" ranges with no product).
>
> Write only valid JSON. Reply with one line per page: id and number of items.

## 4. Build and check

```bash
node scripts/offers.mjs build
```

Writes `public/offers.json` (expired leaflets are dropped automatically) and lists problems.
Open 2–3 random page JSONs next to their images and check names and prices. Fix any
systematic error and re-run the affected batch.

## 5. Publish

```bash
git add public/offers.json && git commit -m "Update offers <dates>" && git push
```

Netlify rebuilds in a minute or two; the app picks the new offers up on next open.
Tell the user: leaflets, date ranges, product counts per store, and anything skipped.
`offers-work/` is not committed; delete it once the user is happy.
