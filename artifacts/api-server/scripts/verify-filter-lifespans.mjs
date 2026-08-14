#!/usr/bin/env node
/**
 * Verify that every trackable filter product in the live ucfilters.com
 * WooCommerce store carries the expected `filter_lifespan_days` meta value.
 *
 * The mobile app's filter tracker schedules replacement reminders from
 * lifespanDays (served by GET /api/uc/products, which reads this meta via
 * normalizeProduct in src/routes/uc.ts). A product without the meta returns
 * lifespanDays 0 and is treated as non-trackable — customers get no reminder.
 *
 * Run:  node scripts/verify-filter-lifespans.mjs
 * Requires WC_CONSUMER_KEY / WC_CONSUMER_SECRET in the environment.
 * Exits non-zero if any expected product is missing or has the wrong value.
 */

// Expected lifespans keyed by live WC product ID.
// Values derive from published filter specs:
//   bottles/pitcher/EcoSmart: 150–400L or 3 months → 90
//   Survivor Straw + cartridge: 400L or 4 months  → 120
//   faucet filters/cartridges: 4–5 months          → 120
//   facial/vanity (Derma Flux, Chanel): 4–5 months → 135 (filter) / 120 (cartridge)
//   shower filters + cartridge: 5 months           → 150
//   under-sink RO: 6 months                        → 180
//   commercial RO (Aqua Stream): 6–9 months        → 210
export const EXPECTED_LIFESPANS = {
  8054: { name: "Hydra Flux", days: 90 },
  8070: { name: "Truva Go", days: 90 },
  8043: { name: "Viva Drop", days: 90 },
  8046: { name: "Flex", days: 90 },
  8045: { name: "Timbo", days: 90 },
  8044: { name: "Gym Buddy", days: 90 },
  8047: { name: "Breeze", days: 90 },
  9591: { name: "EcoSmart Filter", days: 90 },
  9607: { name: "Pitcher Filter", days: 90 },
  9580: { name: "Filter Squeeze Ahlstrom (bottle cartridge)", days: 90 },
  9365: { name: "Survivor Straw", days: 120 },
  9630: { name: "Survivor Filter (straw cartridge)", days: 120 },
  8042: { name: "Sweet Home Kitchen Faucet Filter", days: 120 },
  10170: { name: "Faucet Filter Cartridge", days: 120 },
  8576: { name: "Derma Flux (facial/vanity filter)", days: 135 },
  9653: { name: "Derma Flux Cartridge", days: 120 },
  8049: { name: "Chanel Shower Filter", days: 135 },
  8053: { name: "J'adore Shower Filter", days: 150 },
  8051: { name: "Derma Care Shower Filter", days: 150 },
  9055: { name: "Pure Drop Shower Filter", days: 150 },
  9624: { name: "Shower Filter Cartridge", days: 150 },
  8978: { name: "Ultra Pure Pro 5-Stage RO", days: 180 },
  9633: { name: "Aqua Stream 1200", days: 210 },
  9640: { name: "Aqua Stream 1200 Pro", days: 210 },
  // Wireless Dispenser Filter: product page spec states 300L capacity,
  // 2–3 months average use → 90 (same band as bottles/pitcher, 150–400L / 3 months)
  8574: { name: "Wireless Dispenser Filter", days: 90 },
  // Portable Water Filter Pump: product page spec states
  // "Filter life Span: 4-5 months" → 120 (same band as faucet filters)
  8147: { name: "Portable Water Filter Pump", days: 120 },
};

// Products deliberately left NON-trackable (no lifespan meta on purpose):
//   9656 "Shell"                          — housing only, no filter media
// Never guess a lifespan; these stay 0 until the team confirms a value.
export const KNOWN_NON_TRACKABLE = [9656];

const key = process.env.WC_CONSUMER_KEY;
const secret = process.env.WC_CONSUMER_SECRET;
if (!key || !secret) {
  console.error("WC_CONSUMER_KEY / WC_CONSUMER_SECRET not set");
  process.exit(2);
}

const base = process.env.WC_BASE_URL || "https://www.ucfilters.com";
const url = `${base}/wp-json/wc/v3/products?per_page=100&consumer_key=${key}&consumer_secret=${secret}`;

// ucfilters.com may prepend PHP notices before the JSON body (see parseWcJson
// in src/routes/uc.ts) — scan for the first bracket before parsing.
const text = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const start = text.search(/[{[]/);
if (start === -1) {
  console.error("No JSON found in WC response");
  process.exit(2);
}
const products = JSON.parse(text.slice(start));

let failures = 0;
const byId = new Map(products.map((p) => [p.id, p]));

for (const [idStr, exp] of Object.entries(EXPECTED_LIFESPANS)) {
  const id = Number(idStr);
  const p = byId.get(id);
  if (!p) {
    console.error(`MISSING  ${id} ${exp.name} — not in live catalogue`);
    failures++;
    continue;
  }
  const meta = (p.meta_data ?? []).find((m) => m.key === "filter_lifespan_days");
  const actual = meta ? Number(meta.value) : 0;
  if (actual === exp.days) {
    console.log(`OK       ${id} ${exp.name} — ${actual} days`);
  } else {
    console.error(`WRONG    ${id} ${exp.name} — expected ${exp.days}, got ${actual}`);
    failures++;
  }
}

for (const p of products) {
  if (EXPECTED_LIFESPANS[p.id] || KNOWN_NON_TRACKABLE.includes(p.id)) continue;
  console.warn(`UNMAPPED ${p.id} ${p.name} — new product? decide trackable vs not`);
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} product(s) missing or with wrong lifespan meta`);
  process.exit(1);
}
console.log(`\nPASS: all ${Object.keys(EXPECTED_LIFESPANS).length} trackable products verified`);
