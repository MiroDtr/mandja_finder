# Pazarko

Deal finder for Bulgarian supermarkets (Kaufland, Lidl, Billa, Fantastico).

- **Оферти** – search this week's offers: free text search, category and store filters,
  sort by price, discount or price per kg. Allergies are hidden, likes get a ⭐.
  "Попитай AI" answers free-form questions (Claude Haiku, API).
- **Брошури** – the leaflets currently loaded. A PDF can also be uploaded by hand (Claude Haiku, API).
- **Количка** – photograph shelf price labels (Claude Haiku, API) or add items by hand.
- **Налични продукти / Рецепти** – finished shops feed recipe suggestions (Claude Haiku, API).
- **История** – past "Попитай AI" conversations, read-only.
- **Предпочитания** – likes, dislikes and allergies.

## Where the offers come from

`public/offers.json`, rebuilt weekly **in Claude Code** with the `update-offers` skill
(`.claude/skills/update-offers/SKILL.md`): just ask Claude Code to "update offers".
It downloads the Kaufland, Lidl and Billa leaflets, reads them with subagents (your
Claude subscription, no API cost), writes `public/offers.json` and pushes it; Netlify publishes it.

For a Fantastico (or any other) leaflet, put the PDF in `offers-inbox/` and mention it.

Script steps, if you want to run them yourself:

```bash
node scripts/offers.mjs discover
node scripts/offers.mjs prepare <key...>
node scripts/offers.mjs status
node scripts/offers.mjs build
```

## Costs

Everything in the app that uses AI runs on Claude Haiku (the cheapest model) with thinking off:
about $0.0003 per label photo, $0.002 per recipe request, $0.005 per "Попитай AI" question.
These need credit in the Anthropic API account; without it they show a "no credit" message and
the rest of the app (offers, search, manual cart, lists) keeps working.

## Run locally

1. `npm install`
2. Fill in `.env` (see `.env.example`): `ANTHROPIC_API_KEY` and `APP_PASSWORD`.
3. `npm run dev` and open http://localhost:5173

## Deploy

Netlify builds from GitHub using `netlify.toml`. Set `ANTHROPIC_API_KEY` and `APP_PASSWORD`
under Site configuration → Environment variables.

User data (cart, lists, preferences, history) is stored in each browser only.
