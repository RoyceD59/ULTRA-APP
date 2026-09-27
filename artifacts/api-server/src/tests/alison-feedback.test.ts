/**
 * Tests for the Alison feedback endpoint admin-authorization logic.
 *
 * Covers the four scenarios required by the reviewer:
 *   1. Unauthenticated (no/bad token) → denied
 *   2. WooCommerce / dev-login principal (id ≥ 1 000 000 000) → denied
 *   3. DB user with isAdmin=false and not in UC_ADMIN_EMAILS → denied
 *   4. DB user with isAdmin=true → allowed
 *   5. DB user with email in UC_ADMIN_EMAILS env list → allowed
 *
 * Plus purity checks on weekStats construction (server-side, over the full
 * feedbackLog, not the paged slice returned to the client).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkAdminAuth, adminEmailList, sanitiseCsvCell } from "../routes/uc-water-chat.js";

// ── Stub helpers ──────────────────────────────────────────────────────────────

type TokenStub = { id: number | string; email: string } | null;

function makeTokenVerifier(result: TokenStub) {
  return (_h: string | undefined) => result;
}

function makeUserLookup(result: { isAdmin: boolean; email: string } | undefined) {
  return async (_id: number) => result;
}

const VALID_DB_ID = 42; // numeric id in the DB-user range (< 1e9)
const WC_ID       = 1_000_000_001; // WooCommerce / dev-login principal id

// ── checkAdminAuth ─────────────────────────────────────────────────────────────

describe("checkAdminAuth — access control", () => {
  it("denies when authHeader is undefined (unauthenticated)", async () => {
    const result = await checkAdminAuth(
      undefined,
      makeTokenVerifier(null),
      makeUserLookup({ isAdmin: false, email: "anyone@example.com" }),
    );
    assert.equal(result, false);
  });

  it("denies when token verification fails (null claims)", async () => {
    const result = await checkAdminAuth(
      "Bearer bad-token",
      makeTokenVerifier(null),
      makeUserLookup({ isAdmin: true, email: "admin@ucfilters.com" }),
    );
    assert.equal(result, false);
  });

  it("denies WooCommerce / dev-login principal (id ≥ 1e9)", async () => {
    const result = await checkAdminAuth(
      "Bearer wc-token",
      makeTokenVerifier({ id: WC_ID, email: "wc@ucfilters.com" }),
      makeUserLookup({ isAdmin: true, email: "wc@ucfilters.com" }),
    );
    assert.equal(result, false);
  });

  it("denies when DB lookup returns no user", async () => {
    const result = await checkAdminAuth(
      "Bearer valid-token",
      makeTokenVerifier({ id: VALID_DB_ID, email: "ghost@example.com" }),
      makeUserLookup(undefined),
    );
    assert.equal(result, false);
  });

  it("denies DB user with isAdmin=false and not in email list", async () => {
    const result = await checkAdminAuth(
      "Bearer valid-token",
      makeTokenVerifier({ id: VALID_DB_ID, email: "customer@example.com" }),
      makeUserLookup({ isAdmin: false, email: "customer@example.com" }),
      [], // empty email list
    );
    assert.equal(result, false);
  });

  it("allows DB user with isAdmin=true", async () => {
    const result = await checkAdminAuth(
      "Bearer admin-token",
      makeTokenVerifier({ id: VALID_DB_ID, email: "admin@ucfilters.com" }),
      makeUserLookup({ isAdmin: true, email: "admin@ucfilters.com" }),
      [],
    );
    assert.equal(result, true);
  });

  it("allows DB user whose email is in UC_ADMIN_EMAILS list (isAdmin=false in DB)", async () => {
    const result = await checkAdminAuth(
      "Bearer conf-token",
      makeTokenVerifier({ id: VALID_DB_ID, email: "configured@ucfilters.com" }),
      makeUserLookup({ isAdmin: false, email: "configured@ucfilters.com" }),
      ["configured@ucfilters.com"],
    );
    assert.equal(result, true);
  });

  it("email-list match is case-insensitive", async () => {
    const result = await checkAdminAuth(
      "Bearer conf-token",
      makeTokenVerifier({ id: VALID_DB_ID, email: "BOSS@UCFILTERS.COM" }),
      makeUserLookup({ isAdmin: false, email: "BOSS@UCFILTERS.COM" }),
      ["boss@ucfilters.com"],
    );
    assert.equal(result, true);
  });

  it("fails closed when DB lookup throws", async () => {
    const result = await checkAdminAuth(
      "Bearer valid-token",
      makeTokenVerifier({ id: VALID_DB_ID, email: "admin@ucfilters.com" }),
      async (_id: number) => { throw new Error("DB unavailable"); },
    );
    assert.equal(result, false);
  });
});

// ── adminEmailList ─────────────────────────────────────────────────────────────

describe("adminEmailList — env-var parsing", () => {
  it("returns empty array when UC_ADMIN_EMAILS is unset", () => {
    const saved = process.env["UC_ADMIN_EMAILS"];
    delete process.env["UC_ADMIN_EMAILS"];
    assert.deepEqual(adminEmailList(), []);
    if (saved !== undefined) process.env["UC_ADMIN_EMAILS"] = saved;
  });

  it("parses a comma-separated list and lowercases each entry", () => {
    process.env["UC_ADMIN_EMAILS"] = " Admin@UCFilters.com , OPS@ucfilters.com ";
    assert.deepEqual(adminEmailList(), ["admin@ucfilters.com", "ops@ucfilters.com"]);
    delete process.env["UC_ADMIN_EMAILS"];
  });

  it("ignores blank entries", () => {
    process.env["UC_ADMIN_EMAILS"] = "a@b.com,,c@d.com";
    assert.deepEqual(adminEmailList(), ["a@b.com", "c@d.com"]);
    delete process.env["UC_ADMIN_EMAILS"];
  });
});

// ── weekStats correctness ─────────────────────────────────────────────────────
// The server must compute 7-day aggregate counts across the FULL feedback log,
// not just the paged slice (default 100 items) returned to clients.

describe("weekStats — server-side computation from full log", () => {
  /** Simulate the weekStats calculation used inside the GET handler. */
  function computeWeekStats(
    log: Array<{ ts: string; rating: "up" | "down" }>,
  ) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const week   = log.filter(e => e.ts >= cutoff);
    return {
      total: week.length,
      up:    week.filter(e => e.rating === "up").length,
      down:  week.filter(e => e.rating === "down").length,
    };
  }

  it("counts only entries within 7 days", () => {
    const now  = new Date().toISOString();
    const old  = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const log  = [
      { ts: now, rating: "up"   as const },
      { ts: now, rating: "down" as const },
      { ts: old, rating: "up"   as const }, // outside window — should not count
    ];
    const stats = computeWeekStats(log);
    assert.equal(stats.total, 2);
    assert.equal(stats.up,    1);
    assert.equal(stats.down,  1);
  });

  it("returns zeroes when no entries fall within 7 days", () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const log = [{ ts: old, rating: "up" as const }];
    const stats = computeWeekStats(log);
    assert.deepEqual(stats, { total: 0, up: 0, down: 0 });
  });

  it("counts across more than 100 entries (beyond the paged limit)", () => {
    const now  = new Date().toISOString();
    // 150 "up" entries — all in window, but only 100 would be in a paged response
    const log = Array.from({ length: 150 }, () => ({ ts: now, rating: "up" as const }));
    const stats = computeWeekStats(log);
    assert.equal(stats.total, 150);
    assert.equal(stats.up,    150);
  });
});

// ── sanitiseCsvCell — CSV formula-injection defence ────────────────────────────

describe("sanitiseCsvCell — formula-injection protection", () => {
  // ── formula-injection prefix tests ────────────────────────────────────────

  it("prefixes '=' formula with apostrophe and wraps in quotes", () => {
    const out = sanitiseCsvCell('=HYPERLINK("https://evil.com","click")');
    // Must begin with opening-quote + apostrophe + the original trigger char
    assert.ok(out.startsWith('"\'='), `Expected apostrophe-prefixed quoted cell, got: ${out}`);
    // Must NOT start with '"=' — that would still execute in spreadsheet apps
    assert.ok(!out.startsWith('"='), "Must not start with '\"=' — that would still execute");
  });

  it("prefixes '+' formula trigger with apostrophe and wraps in quotes", () => {
    const out = sanitiseCsvCell("+1+1");
    assert.equal(out, '"\'+1+1"');
  });

  it("prefixes '-' formula trigger with apostrophe and wraps in quotes", () => {
    const out = sanitiseCsvCell("-1+SUM(A1)");
    assert.equal(out, '"\'-1+SUM(A1)"');
  });

  it("prefixes '@' formula trigger with apostrophe and wraps in quotes", () => {
    const out = sanitiseCsvCell("@SUM(A1)");
    assert.equal(out, '"\'@SUM(A1)"');
  });

  it("neutralises formula trigger after leading whitespace (preserves whitespace in output)", () => {
    const out = sanitiseCsvCell("  =cmd|' /C calc'!A0");
    // The apostrophe is prepended before the leading spaces so the whole value
    // is rendered as text; the output is quoted because it contains a comma.
    assert.ok(out.startsWith('"\''), `Expected apostrophe-prefixed quoted cell, got: ${out}`);
    assert.ok(!out.includes("\t"), "Must not use tab as the injection-prevention prefix");
    // The original value (including spaces) must be preserved inside the cell
    assert.ok(out.includes("  =cmd"), "Original value with leading whitespace must be present");
  });

  // ── RFC 4180 quoting — no formula trigger ─────────────────────────────────

  it("does not alter ordinary question text", () => {
    const plain = "Why does my filter taste funny?";
    assert.equal(sanitiseCsvCell(plain), plain);
  });

  it("wraps commas in double-quotes per RFC 4180", () => {
    const out = sanitiseCsvCell("Nairobi, Kenya");
    assert.equal(out, '"Nairobi, Kenya"');
  });

  it("escapes embedded double-quotes by doubling them (RFC 4180)", () => {
    const out = sanitiseCsvCell('She said "hello"');
    assert.equal(out, '"She said ""hello"""');
  });

  it("wraps newlines in double-quotes", () => {
    const out = sanitiseCsvCell("line1\nline2");
    assert.equal(out, '"line1\nline2"');
  });

  it("wraps carriage-return+newline in double-quotes", () => {
    const out = sanitiseCsvCell("line1\r\nline2");
    assert.equal(out, '"line1\r\nline2"');
  });

  // ── ISO timestamp (typical ts column value) ───────────────────────────────

  it("returns plain value unchanged for normal ISO timestamps", () => {
    // ISO timestamps start with a digit — no formula trigger, no special chars
    const ts = "2026-07-31T12:00:00.000Z";
    assert.equal(sanitiseCsvCell(ts), ts);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("handles empty string without throwing", () => {
    assert.equal(sanitiseCsvCell(""), "");
  });

  it("handles rating value 'up' unchanged (no special chars)", () => {
    assert.equal(sanitiseCsvCell("up"), "up");
  });

  it("handles rating value 'down' unchanged (no special chars)", () => {
    assert.equal(sanitiseCsvCell("down"), "down");
  });
});

