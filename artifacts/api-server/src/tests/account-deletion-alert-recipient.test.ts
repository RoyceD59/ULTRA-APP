/**
 * Tests for accountDeletionAlertRecipient() — the configurable recipient of
 * the account-deletion team notification (DELETE /api/uc/customer, step 15).
 *
 * Verifies:
 *   1. DB value set           → used as the recipient (takes priority).
 *   2. TEAM_ALERT_EMAIL set   → used as the recipient (trimmed) when no DB value.
 *   3. TEAM_ALERT_EMAIL blank → falls back to info@ucfilters.com.
 *   4. TEAM_ALERT_EMAIL unset → falls back to info@ucfilters.com.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env["SESSION_SECRET"] ??= "test-secret-for-deletion-alert-tests";

const { accountDeletionAlertRecipient, invalidateTeamAlertEmailCache } =
  await import("../routes/uc.js");

const ORIGINAL = process.env["TEAM_ALERT_EMAIL"];

after(() => {
  if (ORIGINAL === undefined) delete process.env["TEAM_ALERT_EMAIL"];
  else process.env["TEAM_ALERT_EMAIL"] = ORIGINAL;
});

describe("accountDeletionAlertRecipient", () => {
  beforeEach(() => {
    delete process.env["TEAM_ALERT_EMAIL"];
    // Clear the in-process cache so each test starts from a fresh DB/env read.
    invalidateTeamAlertEmailCache();
  });

  it("uses TEAM_ALERT_EMAIL when configured (no DB override)", async () => {
    process.env["TEAM_ALERT_EMAIL"] = "privacy@ucfilters.com";
    assert.equal(await accountDeletionAlertRecipient(), "privacy@ucfilters.com");
  });

  it("trims surrounding whitespace from a configured value", async () => {
    process.env["TEAM_ALERT_EMAIL"] = "  privacy@ucfilters.com  ";
    assert.equal(await accountDeletionAlertRecipient(), "privacy@ucfilters.com");
  });

  it("falls back to info@ucfilters.com when the value is blank", async () => {
    process.env["TEAM_ALERT_EMAIL"] = "";
    assert.equal(await accountDeletionAlertRecipient(), "info@ucfilters.com");
  });

  it("falls back to info@ucfilters.com when the value is whitespace-only", async () => {
    process.env["TEAM_ALERT_EMAIL"] = "   ";
    assert.equal(await accountDeletionAlertRecipient(), "info@ucfilters.com");
  });

  it("falls back to info@ucfilters.com when unset", async () => {
    assert.equal(await accountDeletionAlertRecipient(), "info@ucfilters.com");
  });
});
