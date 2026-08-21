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
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveTeamAlertEmail } from "../routes/uc.js";

describe("accountDeletionAlertRecipient", () => {
  it("uses the database value when configured", () => {
    assert.equal(
      resolveTeamAlertEmail("alerts@ucfilters.com", "privacy@ucfilters.com"),
      "alerts@ucfilters.com",
    );
  });

  it("uses a trimmed environment value when no database override exists", () => {
    assert.equal(resolveTeamAlertEmail(null, "  privacy@ucfilters.com  "), "privacy@ucfilters.com");
  });

  it("falls back when the database and environment values are blank", () => {
    assert.equal(resolveTeamAlertEmail("   ", ""), "info@ucfilters.com");
  });

  it("falls back when no recipient is configured", () => {
    assert.equal(resolveTeamAlertEmail(undefined, undefined), "info@ucfilters.com");
  });
});
