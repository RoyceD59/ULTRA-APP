import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedLeadDeliveryPayload, leadDeliveryConfigured } from "../lib/lead-delivery.js";

test("lead delivery stays disabled until a verified HTTPS endpoint is configured", () => {
  const previous = process.env.GOOGLE_LEAD_APPS_SCRIPT_URL;
  delete process.env.GOOGLE_LEAD_APPS_SCRIPT_URL;
  assert.equal(leadDeliveryConfigured(), false);
  process.env.GOOGLE_LEAD_APPS_SCRIPT_URL = "http://example.test/exec";
  assert.equal(leadDeliveryConfigured(), false);
  process.env.GOOGLE_LEAD_APPS_SCRIPT_URL = "https://script.google.com/macros/s/verified/exec";
  assert.equal(leadDeliveryConfigured(), true);
  if (previous === undefined) delete process.env.GOOGLE_LEAD_APPS_SCRIPT_URL;
  else process.env.GOOGLE_LEAD_APPS_SCRIPT_URL = previous;
});

test("secondary lead payload excludes internal assessment and attribution fields", () => {
  const payload = approvedLeadDeliveryPayload({
    submissionId: "public:submission",
    idempotencyKey: "public:key",
    firstName: "Amara",
    phone: "254700000000",
    country: "Kenya",
    area: "Nairobi",
    source: "municipal",
    concern: "taste",
    setting: "home",
    consent: "result_and_follow_up",
    consentVersion: "2026-01",
    sourceAttribution: { utmSource: "private-campaign" },
    assessmentId: "internal-id",
    reference: "WT-INTERNAL",
  });
  assert.equal("assessmentId" in payload, false);
  assert.equal("reference" in payload, false);
  assert.equal("sourceAttribution" in payload, false);
  assert.equal(payload.submissionId, "public:submission");
});