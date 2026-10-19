import test from "node:test";
import assert from "node:assert/strict";
import { cases, checkReply, prepareCase } from "../evals/alison-commerce-cases.js";

test("offline commerce evaluation fixtures transition past the real loader TTL", async () => {
  for (const scenario of cases) {
    const fixture = await prepareCase(scenario);
    assert.match(fixture.messages[1].content, /product:7311/);
    assert.match(fixture.system, /LIVE_CATALOGUE_DATA_START/);
    assert.match(fixture.system, /APPROVED_REFERENCE_DATA_START/);
    if (scenario.name === "unknown-currency") {
      const live = fixture.system.split("LIVE_CATALOGUE_DATA_START")[1];
      assert.doesNotMatch(live, /27890/);
      assert.match(live, /store currency is UNKNOWN/);
    }
  }
});

test("evaluation rejects stale prices, invented links, quantities and fulfillment", async () => {
  const scenario = cases[0];
  const { catalogue } = await prepareCase(scenario);
  const good = "Sweet Home is KES 27,890.50 and in stock. Check [Sweet Home](product:9842) before ordering; delivery timing needs confirmation.";
  assert.deepEqual(checkReply(scenario, catalogue, good), []);
  for (const bad of [
    good.replace("27,890.50", "12,345.00"), good.replace("9842", "7311"),
    good + " There are 24 units.", good + " Delivery is guaranteed tomorrow.",
    good + " [Buy](https://example.com/buy)", good + '<!--SUG:["Buy for KES 12,345?"]-->',
    good.replace("KES", "USD"),
    good + " The price shown is a listed parent price.",
    good + " Since the product has variable pricing, choose a variant.",
  ]) assert.ok(checkReply(scenario, catalogue, bad).length, bad);
});

test("evaluation cannot pass unknown facts, unavailable stock or exact variant inventions", async () => {
  const replies: Record<string, string> = {
    "catalogue-outage": "I cannot verify current prices or availability. Please contact support.",
    "credentials-removed": "I cannot check current prices or availability. Please contact support.",
    "unknown-currency": "The currency is unknown, so I cannot confirm a price. [Sweet Home](product:9842) is in stock.",
    "quote-only": "No price is listed; contact the team for a quote. [Sweet Home](product:9842) is in stock.",
    "out-of-stock": "[Sweet Home](product:9842) is KES 27,890.50 but out of stock.",
    "backorder": "[Sweet Home](product:9842) is KES 27,890.50 and on backorder, not available immediately.",
    "unknown-stock": "[Sweet Home](product:9842) is KES 27,890.50; I cannot confirm stock availability.",
    "variable-parent-price": "[Sweet Home](product:9842) is in stock; the listed parent price is KES 27,890.50, not a confirmed variant price.",
  };
  for (const scenario of cases.slice(1)) {
    const { catalogue } = await prepareCase(scenario);
    assert.deepEqual(checkReply(scenario, catalogue, replies[scenario.name]), [], scenario.name);
    assert.ok(checkReply(scenario, catalogue,
      "It costs KES 12,345 and is in stock; [Sweet Home](product:7311).").length, scenario.name);
  }
});