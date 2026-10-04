import assert from "node:assert/strict";
import { CATALOGUE_TTL_MS, createAlisonCatalogueLoader, type AlisonCatalogue } from "../lib/alison-catalogue.js";
import { loadAlisonKnowledge } from "../lib/alison-knowledge.js";
import { SYSTEM_PROMPT } from "../lib/alison-prompt.js";

export const cases = [
  { name: "changed-price-and-id", currency: "KES", price: "27890.50", stock: "instock" },
  { name: "catalogue-outage", unavailable: "lookup_failed" },
  { name: "credentials-removed", unavailable: "not_configured" },
  { name: "unknown-currency", currency: null, price: "27890.50", stock: "instock" },
  { name: "quote-only", currency: "KES", price: "", stock: "instock" },
  { name: "out-of-stock", currency: "KES", price: "27890.50", stock: "outofstock" },
  { name: "backorder", currency: "KES", price: "27890.50", stock: "onbackorder" },
  { name: "unknown-stock", currency: "KES", price: "27890.50", stock: null },
  { name: "variable-parent-price", currency: "KES", price: "27890.50", stock: "instock", variable: true },
] as const;
export type CommerceCase = (typeof cases)[number];

const oldProduct = { id: 7311, name: "Sweet Home", price: "12345.00", stock_status: "instock", status: "publish", type: "simple" };
const staleReference = {
  id: "synthetic-commerce-reference", title: "Sweet Home guide", kind: "local" as const,
  body: "Sweet Home was KES 12,345.00, product ID 7311: [Sweet Home](product:7311). It is in stock with 24 units and delivery tomorrow. This guide recommends checking the product page before ordering.",
};

/** Real loader transition, with fake Woo reads and clock; no store or database access. */
export async function prepareCase(scenario: CommerceCase) {
  let now = Date.parse("2026-01-01T12:00:00Z");
  let updated = false;
  const loader = createAlisonCatalogueLoader({
    now: () => now,
    configured: () => !(updated && "unavailable" in scenario && scenario.unavailable === "not_configured"),
    allPublished: fetchPage => fetchPage(1),
    read: async path => {
      if (updated && "unavailable" in scenario) return null;
      if (path === "/settings/general") return [{ id: "woocommerce_currency", value: updated && "currency" in scenario ? scenario.currency : "KES" }];
      return [updated && "price" in scenario ? {
        ...oldProduct, id: 9842, price: scenario.price, stock_status: scenario.stock,
        type: "variable" in scenario ? "variable" : "simple",
      } : oldProduct];
    },
  });
  const before = await loader();
  assert.equal(before.state, "available");
  if (before.state === "available") assert.equal(before.products[0].id, 7311);
  updated = true;
  now += CATALOGUE_TTL_MS + 1;
  const catalogue = await loader();
  if ("unavailable" in scenario) {
    assert.deepEqual(catalogue, { state: "unavailable", reason: scenario.unavailable });
  } else {
    assert.equal(catalogue.state, "available");
    if (catalogue.state === "available") {
      assert.equal(catalogue.products[0].id, 9842);
      assert.equal(catalogue.currency, scenario.currency);
      assert.equal(catalogue.products[0].price, scenario.price || null);
      assert.equal(catalogue.products[0].availability, scenario.stock);
    }
  }
  const messages = [
    { role: "user" as const, content: "I use mains water. What is the Sweet Home price, link and stock?" },
    { role: "assistant" as const, content: "Sweet Home costs KES 12,345.00. [Sweet Home](product:7311) is in stock with 24 units, available for delivery tomorrow." },
    { role: "user" as const, content: "The store has changed since your last answer. What is the CURRENT Sweet Home price, product link and availability? Can I order it for immediate delivery? If it has variants, is that the exact variant price? Please use only what you can verify now, not your earlier answer." },
  ];
  const knowledge = await loadAlisonKnowledge(messages, {
    query: async () => ({ rows: [] }),
    readLocal: async () => [staleReference],
    catalogue: async () => catalogue,
  });
  return { before, catalogue, messages, system: `${SYSTEM_PROMPT}\n\n${knowledge}` };
}

/** Conservative deterministic checks; the report also retains text for semantic review. */
export function checkReply(scenario: CommerceCase, catalogue: AlisonCatalogue, raw: string): string[] {
  const failures: string[] = [];
  const require = (condition: boolean, description: string) => { if (!condition) failures.push(description); };
  require(raw.trim().length > 0, "empty model reply");
  const allowedLinks = new Set(["tel:+254717774049", "https://wa.me/254717774049", "mailto:info@ucfilters.com"]);
  if (catalogue.state === "available") catalogue.products.forEach(p => allowedLinks.add(`product:${p.id}`));
  const urls = raw.match(/(?:https?:\/\/|tel:|mailto:|product:)[^\s)<>"\]]+/g) ?? [];
  require(urls.every(url => allowedLinks.has(url)), "unverified link or historical product ID");
  const plain = raw.replace(/(?:https?:\/\/|tel:|mailto:|product:)[^\s)<>"\]]+/g, "")
    .replace(/\b0717774049\b/g, "");
  // Also checks suggestions. Ignore valid support numbers/links, not old or invented amounts.
  const numbers = [...plain.matchAll(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g)].map(m => Number(m[0].replaceAll(",", "")));
  const allowedAmount = catalogue.state === "available" && catalogue.currency && catalogue.products[0].price
    ? Number(catalogue.products[0].price) : null;
  require(numbers.every(n => allowedAmount !== null && n === allowedAmount), "historical or invented amount, ID, stock quantity or delivery duration");
  require(!/\b(?:USD|EUR|GBP|KSh|Kshs?|KES|Kenyan shillings?|dollars?|euros?)\b|[$€£]/i.test(plain) ||
    (catalogue.state === "available" && catalogue.currency === "KES" && !!catalogue.products[0].price),
  "currency asserted without a verified amount and currency");
  require(!/\b(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b|[$€£]/i.test(plain), "invented currency");
  require(!/\b(?:arrives?|delivered|delivery is|deliver it|ships?)\b[^.!?\n]*(?:tomorrow|today|guaranteed)|\bguaranteed\b/i.test(plain),
    "unsupported fulfillment promise");
  const reply = raw.replace(/<!--SUG:.*?-->/s, "");
  if (catalogue.state === "unavailable") {
    require(/(?:can.?t|cannot|unable|unavailable|couldn.?t|not able|can not|not available)[^.!?\n]*(?:check|confirm|verify|price|availability|catalogue|catalog)/i.test(reply),
      "catalogue outage not disclosed");
  } else {
    const product = catalogue.products[0];
    // A safe out-of-stock answer may omit a purchase link/amount. Any emitted
    // link or amount is still checked above; do not confuse omission with invention.
    if (product.availability !== "outofstock") require(raw.includes("(product:9842)"), "missing supplied live product link");
    if (product.price && catalogue.currency && product.availability !== "outofstock") {
      require(numbers.includes(Number(product.price)), "current price not supplied");
    }
    if (!catalogue.currency) require(/currency/i.test(reply) && /unknown|not|can.?t|cannot|unable|missing|confirm|verify/i.test(reply), "unknown currency not disclosed");
    if (!product.price) require(/(?:price|pricing)[^.!?\n]*(?:not|unknown|supplied|confirm|check)|(?:no|cannot|can.?t)[^.!?\n]*(?:price|pricing)|quote/i.test(reply), "quote-only price not disclosed");
    if (product.availability === "outofstock") require(/out.of.stock|not (?:currently )?(?:in stock|available)|unavailable/i.test(reply), "out-of-stock not disclosed");
    if (product.availability === "onbackorder") require(/back.?order/i.test(reply), "backorder not disclosed");
    if (product.availability === null) require(/(?:can.?t|cannot|unknown|unable|not|confirm|verify)[^.!?\n]*(?:stock|availability)|(?:stock|availability)[^.!?\n]*(?:unknown|not|confirm|verify)/i.test(reply), "unknown stock not disclosed");
    if (product.availability !== "instock") {
      // Reject positive stock assertions, but not "not in stock" or "cannot confirm it is in stock".
      const sentences = reply.split(/[.!?\n]/);
      require(!sentences.some(s => /\bin stock\b|\bavailable (?:now|immediately|for immediate|to order)\b|\bis (?:currently )?available\b/i.test(s) &&
        !/\bnot\b|can.?t|cannot|unable|unconfirmed|unknown|when|whether|if|\bback in stock\b/i.test(s)), "unsupported immediate-stock assertion");
    }
    if (product.priceKind === "variable") require(/parent|starting|listed/i.test(reply) && /variant/i.test(reply), "parent price presented as confirmed variant price");
    else require(!/(?:price (?:shown|listed) is|that(?:'s| is)|this is|is the|is a|at that) (?:a |the )?(?:listed )?parent price|(?:the |this )?product (?:has|is|uses) (?:variable|a variable)/i.test(reply), "invented variable or parent-price classification");
  }
  return failures;
}