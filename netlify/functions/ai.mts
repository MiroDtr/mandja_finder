import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const config = { path: "/api/ai" };

const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

const CATEGORIES = [
  "Месо и колбаси",
  "Риба",
  "Млечни продукти",
  "Плодове и зеленчуци",
  "Хляб и тестени",
  "Напитки",
  "Алкохол",
  "Сладко и снаксове",
  "Замразени",
  "Пакетирани и консерви",
  "Нехранителни",
  "Друго",
] as const;

const PRICE_RULES = `Prices: Bulgaria uses the euro. Always return prices in EUR as plain numbers (e.g. 2.49).
If both € and лв are printed, use the € value. If only лв is printed, divide by 1.95583 and round to 2 decimals.
Keep product names exactly as printed, in Bulgarian.`;

// ---------- schemas ----------

const LeafletPage = z.object({
  valid_from: z.string().nullable().describe("Offer validity start as YYYY-MM-DD, if printed on this page"),
  valid_to: z.string().nullable().describe("Offer validity end as YYYY-MM-DD, if printed on this page"),
  products: z.array(
    z.object({
      name: z.string(),
      price: z.number().describe("Current promo price in EUR"),
      old_price: z.number().nullable().describe("Previous / crossed-out price in EUR"),
      discount_percent: z.number().nullable(),
      size: z.string().nullable().describe("Package size as printed, e.g. '400 г', '1 кг', '6 x 1,5 л'"),
      unit_price: z.number().nullable().describe("Price per kg or per litre in EUR"),
      unit: z.enum(["кг", "л"]).nullable().describe("Which unit unit_price refers to"),
      category: z.enum(CATEGORIES),
    }),
  ),
});

const Label = z.object({
  readable: z.boolean().describe("false if the photo is not a shelf price label or cannot be read"),
  name: z.string(),
  size: z.string().nullable(),
  price: z.number().describe("Price to pay in EUR for one piece/package; 0 for items sold by weight"),
  is_weighed: z.boolean().describe("true when the item is sold by weight and the label shows only a price per kg"),
  price_per_kg: z.number().nullable(),
  unclear: z.boolean().describe("true if any field was hard to read and should be checked by the user"),
});

const Deals = z.object({
  answer: z.string().describe("One or two short sentences in Bulgarian"),
  product_ids: z.array(z.number()).describe("ids of matching products"),
});

const Recipes = z.object({
  recipes: z.array(
    z.object({
      meal: z.string().describe("Закуска, Обяд, Вечеря or Десерт"),
      title: z.string(),
      minutes: z.number(),
      ingredients: z.array(
        z.object({
          text: z.string().describe("Ingredient with amount"),
          missing: z.boolean().describe("true if the user has to buy it (not in their list, not a basic spice)"),
        }),
      ),
      steps: z.array(z.string()),
      used_item_ids: z.array(z.number()).describe("ids of the user's bought items this recipe uses"),
    }),
  ),
});

// ---------- request building ----------

type Built = {
  model: string;
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: z.ZodType;
  maxTokens: number;
};

function image(data: string): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
}

function prefs(p: unknown): string {
  const text = typeof p === "string" ? p.trim() : "";
  return text
    ? `The user's food preferences, dislikes and allergies (free text, respect it strictly — never suggest anything they are allergic to):\n"""${text}"""`
    : "The user has not entered any food preferences.";
}

function build(body: any): Built | null {
  switch (body.task) {
    case "leaflet-page":
      return {
        model: SONNET,
        maxTokens: 16000,
        schema: LeafletPage,
        system: `You read one page of a Bulgarian supermarket promotional leaflet (${body.store}) and extract every product offer on it.
${PRICE_RULES}
Extract every product that has a price. Skip decorative text, recipes, loyalty ads and legal notes.
If the page prints the validity period of the offers, return it as dates; today is ${body.today}, use it to infer the year. Otherwise return null for the dates.
If the page has no product offers, return an empty products list.`,
        content: [image(body.image), { type: "text", text: "Extract all offers from this leaflet page." }],
      };
    case "label":
      return {
        model: HAIKU,
        maxTokens: 2000,
        schema: Label,
        system: `You read a photo of a shelf price label (етикет) in a Bulgarian supermarket.
${PRICE_RULES}
If a promo price and a regular price are both shown, use the promo price the customer pays.
Items sold by weight (fruit, vegetables, deli counter): set is_weighed true, price_per_kg to the per-kg price and price to 0.
For packaged items price_per_kg is optional. If the photo is not a price label or is unreadable, set readable to false.`,
        content: [image(body.image), { type: "text", text: "Read this price label." }],
      };
    case "deals": {
      const history = (body.history ?? [])
        .map((t: any) => `User: ${t.q}\nAssistant: ${t.a}`)
        .join("\n");
      return {
        model: HAIKU,
        maxTokens: 4000,
        schema: Deals,
        system: `You help a shopper in Bulgaria find the best deals in the current supermarket leaflets.
You get a list of products, one per line: id | store | name | size | price EUR | old price EUR | price per unit | category.
Answer the question by picking the matching products and returning their ids, best deals first. Return at most 30 ids.
Only use products from the list. If nothing matches, say so and return no ids.
The answer text is one or two short sentences in Bulgarian; the products themselves are shown to the user as cards, so do not list them in the text.
${prefs(body.preferences)}
Leave out products the user is allergic to or dislikes, and mention it briefly if you left something out for that reason.`,
        content: [
          {
            type: "text",
            text: `Products:\n${body.products}\n\n${history ? `Conversation so far:\n${history}\n\n` : ""}Question: ${body.question}`,
          },
        ],
      };
    }
    case "recipes":
      return {
        model: SONNET,
        maxTokens: 8000,
        schema: Recipes,
        system: `You suggest home recipes to a shopper in Bulgaria based on the groceries they just bought. Write everything in Bulgarian.
Return exactly one recipe for each requested meal, sized for ${body.servings} servings.
Build each recipe mainly from the bought items. Assume spices, salt, pepper, cooking oil and water are always available — never mark those as missing.
A recipe may need at most 3 other ingredients the user does not have; mark each of those with missing: true.
List in used_item_ids the ids of the bought items the recipe uses. Keep steps short and practical.
${prefs(body.preferences)}`,
        content: [
          {
            type: "text",
            text: `Bought items (id | name | amount):\n${body.items}\n\nMeals wanted: ${(body.meals ?? []).join(", ")}${
              body.exclude?.length ? `\n\nAlready suggested, give different ones: ${body.exclude.join("; ")}` : ""
            }`,
          },
        ],
      };
    default:
      return null;
  }
}

// ---------- handler ----------

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const password = process.env.APP_PASSWORD;
  if (!password || !process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: "Сървърът не е настроен: липсва APP_PASSWORD или ANTHROPIC_API_KEY." });
  }
  if (req.headers.get("x-app-password") !== password) {
    return json(401, { error: "Грешна парола." });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Невалидна заявка." });
  }
  if (body.task === "ping") return json(200, { ok: true });

  const built = build(body);
  if (!built) return json(400, { error: "Непозната задача." });

  const client = new Anthropic();
  // The text is streamed to the browser as it is generated so the connection
  // stays active for the whole call; the browser parses the JSON at the end.
  const stream = client.messages.stream({
    model: built.model,
    max_tokens: built.maxTokens,
    system: built.system,
    output_config: { effort: "low", format: zodOutputFormat(built.schema) },
    messages: [{ role: "user", content: built.content }],
  });

  // Wait for the first event so API errors (bad key, rate limit) come back as a proper status.
  const events = stream[Symbol.asyncIterator]();
  let first: IteratorResult<Anthropic.MessageStreamEvent>;
  try {
    first = await events.next();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json(500, { error: "Невалиден ANTHROPIC_API_KEY." });
    if (error instanceof Anthropic.RateLimitError) return json(429, { error: "Твърде много заявки. Изчакай малко и опитай пак." });
    if (error instanceof Anthropic.APIError) return json(502, { error: `Грешка от Claude API (${error.status}): ${error.message}` });
    return json(502, { error: "Няма връзка с Claude API." });
  }

  const encoder = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let next = first;
        while (!next.done) {
          const event = next.value;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
          next = await events.next();
        }
      } catch {
        // The browser sees truncated JSON and reports the call as interrupted.
      }
      controller.close();
    },
  });
  return new Response(out, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
