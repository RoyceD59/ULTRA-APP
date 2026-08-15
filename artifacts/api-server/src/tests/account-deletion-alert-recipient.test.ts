/**
 * Tests for accountDeletionAlertRecipient() — the configurable recipient of
 * the account-deletion team notification (DELETE /api/uc/customer, step 15).
 *
 * Verifies:
 *   1. TEAM_ALERT_EMAIL set → used as the recipient (trimmed).
 *   2. TEAM_ALERT_EMAIL blank/whitespace → falls back to info@ucfilters.com.
 *   3. TEAM_ALERT_EMAIL unset → falls back to info@ucfilters.com.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env["SESSION_SECRET"] ??= "test-secret-for-deletion-alert-tests";

const { accountDeletionAlertRecipient } = await import("../routes/uc.js");

const ORIGINAL = process.env["TEAM_ALERT_EMAIL"];

after(() => {
  if (ORIGINAL === undefined) delete process.env["TEAM_ALERT_EMAIL"];
  else process.env["TEAM_ALERT_EMAIL"] = ORIGINAL;
});

describe("accountDeletionAlertRecipient", () => {
  beforeEach(() => { delete process.env["TEAM_ALERT_EMAIL"]; });

  it("uses TEAM_ALERT_EMAIL when configured", () => {
    process.env["TEAM_ALERT_EMAIL"] = "privacy@ucfilters.com";
    assert.equal(accountDeletionAlertRecipient(), "privacy@ucfilters.com");
  });

  it("trims surrounding whitespace from a configured value", () => {
    process.env["TEAM_ALERT_EMAIL"] = "  privacy@ucfilters.com  ";
    assert.equal(accountDeletionAlertRecipient(), "privacy@ucfilters.com");
  });

  it("falls back to info@ucfilters.com when the value is blank", () => {
    process.env["TEAM_ALERT_EMAIL"] = "";
    assert.equal(accountDeletionAlertRecipient(), "info@ucfilters.com");
  });

  it("falls back to info@ucfilters.com when the value is whitespace-only", () => {
    process.env["TEAM_ALERT_EMAIL"] = "   ";
    assert.equal(accountDeletionAlertRecipient(), "info@ucfilters.com");
  });

  it("falls back to info@ucfilters.com when unset", () => {
    assert.equal(accountDeletionAlertRecipient(), "info@ucfilters.com");
  });
});
