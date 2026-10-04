import type { AlisonCatalogue } from "./alison-catalogue.js";

type ChatMessage = { role: "user" | "assistant"; content: string };
type LiveProduct = Extract<AlisonCatalogue, { state: "available" }>["products"][number];

const unavailable: AlisonCatalogue = { state: "unavailable", reason: "lookup_failed" };
const support = "[Call support](tel:+254717774049)";
const suggestions = '\n<!--SUG:["How do I maintain my filter?","Which filter suits my water source?"]-->';

// Store-fact language is not the same as all shopping vocabulary: "installation
// order", returns, and a recommendation's valid product link are guidance.
// Actual price/stock assertions use deterministic facts; links alone are
// validated separately without discarding the useful answer.
const storeFactLanguage = /\b(?:prices?|pricing|costs?|currency|stock|availability|backorders?|quotes?|retails?|retailing|discounts?|budgets?|afford(?:able)?|cheap(?:er)?|expensive|payments?|paying|checkout|restock|product ids?)\b|\b(?:KES|KShs?|USD|EUR|GBP|shillings?|dollars?|euros?|pounds?)\b|[$€£]|\b(?:is|are) (?:currently )?available\b|\bavailable (?:now|immediately|to order|for (?:immediate|purchase|delivery))\b|\b(?:guaranteed delivery|deliver(?:y|ies)? (?:today|tomorrow)|ships? (?:today|tomorrow)|sold out|in immediate stock)\b/i;
const purchaseRequest = /\b(?:can i|may i|how (?:can|do) i|where (?:can|do) i|i want to|ready to|place an|placing an)\b[^.!?\n]{0,60}\b(?:buy|purchase|order)\b|\b(?:current|immediate|confirm|check|verify)\b[^.!?\n]{0,40}\b(?:delivery|shipping|product link)\b|\b(?:price|stock|product)\b[^.!?\n]{0,40}\b(?:link|availability)\b/i;

function guidanceText(s: string): string {
  return s.replace(/\b(?:offers? (?:a )?)?free water (?:quality )?(?:assessment|check|test)\b/gi, "");
}

function bodyWithoutSuggestions(raw: string): string {
  return raw.replace(/<!--SUG:[\s\S]*?-->/g, "");
}

function storeFactTurn(messages: ChatMessage[], raw: string): boolean {
  const latest = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
  return storeFactLanguage.test(guidanceText(latest)) || purchaseRequest.test(latest) ||
    storeFactLanguage.test(guidanceText(bodyWithoutSuggestions(raw)));
}

export function needsCommerceGuard(messages: ChatMessage[], raw: string): boolean {
  // Link-only guidance and suggestions also need validation on stored HTTP
  // replays, but do not necessarily need replacement by a commerce template.
  return storeFactTurn(messages, raw) || /product\s*:/i.test(raw) ||
    storeFactLanguage.test(guidanceText(raw));
}

/** Read only the server-rendered live block, never history or approved references. */
export function catalogueFromKnowledge(context: string): AlisonCatalogue {
  const start = "\nLIVE_CATALOGUE_DATA_START\n";
  const end = "\nLIVE_CATALOGUE_DATA_END";
  const framed = `\n${context}`;
  const first = framed.indexOf(start);
  if (first < 0 || framed.indexOf(start, first + start.length) !== -1) return unavailable;
  const stop = framed.indexOf(end, first + start.length);
  if (stop < 0 || framed.indexOf(end, stop + end.length) !== -1) return unavailable;
  // The production renderer puts one JSON object on the line just before END.
  // Names containing delimiters are JSON-escaped, never structural markers.
  const json = framed.slice(first + start.length, stop).split("\n").at(-1);
  if (!json || json.length > 6500) return unavailable;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    if (value.state === "unavailable") return unavailable;
    if (value.state !== "available" || typeof value.checkedAt !== "string" ||
        !Number.isFinite(Date.parse(value.checkedAt)) ||
        !(value.currency === null || (typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency))) ||
        !Array.isArray(value.products) || value.products.length > 8) return unavailable;
    const ids = new Set<number>();
    const products: LiveProduct[] = [];
    for (const raw of value.products) {
      if (!raw || typeof raw !== "object") return unavailable;
      const p = raw as Record<string, unknown>;
      if (!Number.isSafeInteger(p.id) || Number(p.id) <= 0 || ids.has(Number(p.id)) ||
          typeof p.name !== "string" || !p.name.trim() || p.name.length > 160 ||
          !(p.price === null || (typeof p.price === "string" && /^\d{1,12}(?:\.\d{1,6})?$/.test(p.price))) ||
          !["listed", "variable"].includes(String(p.priceKind)) ||
          ![null, "instock", "outofstock", "onbackorder"].includes(p.availability as string | null)) return unavailable;
      ids.add(Number(p.id));
      products.push({
        id: Number(p.id), name: p.name, price: p.price as string | null,
        priceKind: p.priceKind as LiveProduct["priceKind"], availability: p.availability as string | null,
      });
    }
    return { state: "available", checkedAt: value.checkedAt, currency: value.currency as string | null, products };
  } catch {
    return unavailable;
  }
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function matchedProducts(text: string, products: LiveProduct[]): LiveProduct[] {
  const search = ` ${normalized(text)} `;
  return products.filter(p => search.includes(` ${normalized(p.name)} `) ||
    new RegExp(`\\bproduct:${p.id}(?!\\d)`, "i").test(text));
}

/** Never choose a product using an AI-generated link or historical assistant assertion. */
function requestedProduct(messages: ChatMessage[], products: LiveProduct[]): LiveProduct | undefined {
  const users = messages.filter(m => m.role === "user");
  const latest = users.at(-1)?.content ?? "";
  const matches = matchedProducts(latest, products);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return undefined;
  // Only resolve a customer's explicit pronoun against their own recent messages.
  // An unknown explicit ID must not be treated as a current link to an earlier item.
  if (/product\s*:/i.test(latest) || !/\b(?:it|its|this|that|same)\b/i.test(latest)) return undefined;
  for (const user of users.slice(0, -1).slice(-2).reverse()) {
    const earlier = matchedProducts(user.content, products);
    if (earlier.length === 1) return earlier[0];
    if (earlier.length > 1) return undefined;
  }
  return undefined;
}

function displayPrice(price: string): string {
  // Keep decimal precision and zero exactly as supplied; do not round via Number.
  const [whole, decimals] = price.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (decimals === undefined ? "" : `.${decimals}`);
}

function safeProductLabel(name: string): string {
  // Prevent Woo names from introducing Markdown links, HTML or structural comments.
  return name.replace(/[\[\]()<>\\`]/g, "").replace(/\s+/g, " ").trim() || "View product";
}

function commerceReply(catalogue: AlisonCatalogue, messages: ChatMessage[]): string {
  const safetyQuestion = /\b(?:safe|safety|ill|illness|sick|symptoms?|fluoride|arsenic|lead|heavy metals?|bacteria|contaminants?)\b/i
    .test(messages.filter(m => m.role === "user").at(-1)?.content ?? "");
  const safetyNote = safetyQuestion
    ? " Price and stock do not establish water safety or contaminant removal; arrange a professional water test for safety concerns."
    : "";
  if (catalogue.state === "unavailable") {
    return `I cannot verify current prices, stock or product links because the store catalogue is unavailable. Please check the Shop or ${support} for current details.${safetyNote}`;
  }
  const product = requestedProduct(messages, catalogue.products);
  if (!product) {
    // The prompt contains a subset, not a whole-store existence check. Do not
    // fabricate a match, recommend the first item, or claim the product is missing.
    return `I cannot verify current prices, stock or a product link for that item from this turn's store data. Please check the Shop or ${support}, or tell me the exact product name.${safetyNote}`;
  }
  const link = `[${safeProductLabel(product.name)}](product:${product.id})`;
  const parts: string[] = [];
  switch (product.availability) {
    case "instock": parts.push(`${link} is listed as in stock.`); break;
    case "outofstock": parts.push(`${link} is out of stock.`); break;
    case "onbackorder": parts.push(`${link} is on backorder, not in immediate stock.`); break;
    default: parts.push(`${link}: current stock availability cannot be verified.`); break;
  }
  if (!catalogue.currency) {
    parts.push("The current currency cannot be verified, so I cannot quote a price amount.");
  } else if (product.price === null) {
    parts.push(`No current price is supplied; check the product page or ${support} for a quote.`);
  } else if (product.priceKind === "variable") {
    parts.push(`The listed parent price is ${catalogue.currency} ${displayPrice(product.price)}; check the product page for the exact variant price.`);
  } else {
    parts.push(`The current listed price is ${catalogue.currency} ${displayPrice(product.price)}.`);
  }
  parts.push("Delivery timing is not verified here; check the product page or support before ordering.");
  return parts.join(" ") + safetyNote;
}

export function guardAlisonCommerceReply(input: {
  messages: ChatMessage[]; knowledgeContext: string; rawReply: string;
}): { rawReply: string; guarded: boolean } {
  if (!needsCommerceGuard(input.messages, input.rawReply)) return { rawReply: input.rawReply, guarded: false };
  const catalogue = catalogueFromKnowledge(input.knowledgeContext);
  if (storeFactTurn(input.messages, input.rawReply)) {
    return { rawReply: commerceReply(catalogue, input.messages) + suggestions, guarded: true };
  }
  // Preserve installation, cleaning, empathetic returns instructions and
  // document-backed recommendations. Strip unverifiable links, not guidance.
  const products = catalogue.state === "available" ? catalogue.products : [];
  let invalidLink = false;
  let rawReply = input.rawReply.replace(/\[([^\]\n]+)\]\(\s*product\s*:\s*(\d+)\s*\)/gi, (_link, label: string, id: string) => {
    const product = products.find(p => p.id === Number(id));
    if (!product || normalized(label) !== normalized(product.name)) {
      invalidLink = true;
      return label.replace(/[<>\\`]/g, "");
    }
    return `[${safeProductLabel(product.name)}](product:${product.id})`;
  });
  // Bare/malformed product URIs are not trusted tappable links.
  rawReply = rawReply.replace(/(?<!\]\()product\s*:\s*\d+/gi, () => {
    invalidLink = true;
    return "the product";
  });
  // Unsafe follow-up chips must not replace the useful main guidance.
  rawReply = rawReply.replace(/<!--SUG:[\s\S]*?-->/g, block =>
    storeFactLanguage.test(block) || /\b(?:buy|purchase|order)\b|product\s*:/i.test(block) ? suggestions.trimStart() : block);
  if (invalidLink) {
    const main = bodyWithoutSuggestions(rawReply).trimEnd();
    rawReply = `${main} I cannot verify a current product link for that item; please check the Shop or ${support}.${suggestions}`;
  }
  return { rawReply, guarded: rawReply !== input.rawReply };
}