/**
 * Route-level tests for GET /api/uc/ai/chat-feedback/export
 *
 * Covers:
 *   1. Admin denial — no Authorization header → 403
 *   2. Admin denial — WooCommerce principal (id ≥ 1e9) → 403
 *   3. Admin denial — valid JWT but non-existent DB user → 403
 *   4. Authorised download — CSV Content-Type and Content-Disposition headers
 *   5. CSV header row — ts,rating,question,answer
 *   6. CSV body row — correct columns and formula-injection sanitisation
 *   7. Rating filter — ?rating=down returns only down-rated rows
 *
 * Uses Node.js built-in test runner (node:test) — no extra test deps needed.
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import { db, ucUsersTable, ucAiFeedbackTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-export-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(e => (e ? reject(e) : resolve()))
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const addr = server.address() as { port: number };
  const res  = await fetch(`http://localhost:${addr.port}${path}`, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function authHeader(claims: { id: number | string; email: string }) {
  return `Bearer ${issueToken({ ...claims, firstName: "Export", lastName: "Test" })}`;
}

const CSV_HEADER = "ts,rating,question,answer,improvement_note";

/**
 * Split CSV text into logical records, respecting quoted fields that may
 * contain embedded CRLF newlines (real feedback answers are multi-line).
 */
function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (!inQuotes && ch === "\r" && text[i + 1] === "\n") {
      records.push(current);
      current = "";
      i++; // skip \n
    } else {
      current += ch;
    }
  }
  if (current.trim()) records.push(current);
  return records;
}

/** Parse a single CSV record into fields (handles quoted fields + "" escapes). */
function parseCsvRecord(record: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < record.length; i++) {
    const ch = record[i];
    if (inQuotes) {
      if (ch === '"') {
        if (record[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Return parsed data rows (excluding the header record). */
function csvDataRows(text: string): string[][] {
  return splitCsvRecords(text)
    .filter(r => r.trim() && r !== CSV_HEADER)
    .map(parseCsvRecord);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_EMAIL    = "export-test-admin@ucfilters-test.internal";
const WC_PRINCIPAL  = { id: 1_000_000_999, email: "wc@ucfilters.com" };

let testUserId: number;
let insertedFeedbackIds: number[] = [];

// ── Admin-denial tests (no DB fixtures needed) ────────────────────────────────

describe("GET /api/uc/ai/chat-feedback/export — admin denial", () => {
  it("returns 403 when Authorization header is absent", async () => {
    const { status } = await apiFetch("/api/uc/ai/chat-feedback/export");
    assert.equal(status, 403);
  });

  it("returns 403 for a WooCommerce principal (id ≥ 1e9)", async () => {
    const { status } = await apiFetch("/api/uc/ai/chat-feedback/export", {
      headers: { Authorization: authHeader(WC_PRINCIPAL) },
    });
    assert.equal(status, 403);
  });

  it("returns 403 for a valid JWT whose DB user does not exist", async () => {
    // Use a valid numeric id that is guaranteed not to exist in the DB
    const ghost = { id: 999_000_001, email: "ghost@ucfilters-test.internal" };
    const { status } = await apiFetch("/api/uc/ai/chat-feedback/export", {
      headers: { Authorization: authHeader(ghost) },
    });
    assert.equal(status, 403);
  });
});

// ── Authorised-access tests (require real DB fixtures) ────────────────────────

describe("GET /api/uc/ai/chat-feedback/export — authorised access", () => {
  // Set up: insert a test admin user + two feedback rows; clean up after.
  before(async () => {
    // Insert test user (isAdmin=false — we grant access via UC_ADMIN_EMAILS)
    const [inserted] = await db.insert(ucUsersTable).values({
      email:        TEST_EMAIL,
      passwordHash: "test-hash-not-real",
      firstName:    "Export",
      lastName:     "Test",
      isAdmin:      false,
    }).returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test user");
    testUserId = inserted.id;

    // Grant admin access via env var (no DB isAdmin flag needed)
    process.env["UC_ADMIN_EMAILS"] = TEST_EMAIL;

    // Insert two feedback rows — one "up", one "down" (with formula payload)
    const [row1, row2] = await db.insert(ucAiFeedbackTable).values([
      {
        rating:   "up",
        question: "Does the Sweet Home filter remove chlorine?",
        answer:   "Yes, it reduces chlorine taste and odour.",
      },
      {
        rating:   "down",
        question: '=HYPERLINK("https://evil.com","click")',   // formula-injection payload
        answer:   "I could not understand your question.",
      },
    ]).returning({ id: ucAiFeedbackTable.id });
    if (!row1 || !row2) throw new Error("Failed to insert test feedback rows");
    insertedFeedbackIds = [row1.id, row2.id];
  });

  after(async () => {
    // Clean up in reverse dependency order
    for (const id of insertedFeedbackIds) {
      await db.delete(ucAiFeedbackTable).where(eq(ucAiFeedbackTable.id, id));
    }
    if (testUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  it("returns 200 with CSV Content-Type and Content-Disposition headers", async () => {
    const { status, headers } = await apiFetch("/api/uc/ai/chat-feedback/export", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
    const cd = headers.get("content-disposition") ?? "";
    assert.ok(
      cd.includes("attachment"),
      `Content-Disposition must be attachment, got: ${cd}`,
    );
    assert.ok(
      /alison-feedback-\d{4}-\d{2}-\d{2}\.csv/.test(cd),
      `Content-Disposition must include dated filename, got: ${cd}`,
    );
  });

  it("includes the CSV header row as the first line", async () => {
    const { text } = await apiFetch("/api/uc/ai/chat-feedback/export", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const lines = text.split("\r\n");
    assert.equal(lines[0], CSV_HEADER,
      `First line must be header row, got: ${lines[0]}`);
  });

  it("sanitises formula-injection payload in the question column", async () => {
    const { text } = await apiFetch("/api/uc/ai/chat-feedback/export", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    // The malicious "down" question starts with '=' — must be apostrophe-prefixed
    assert.ok(
      text.includes("'=HYPERLINK"),
      "Formula payload must be prefixed with apostrophe in the CSV output",
    );
    // Must NOT appear raw (without the apostrophe prefix) as a quoted formula
    assert.ok(
      !text.includes('"=HYPERLINK'),
      'Formula cell must not start with "= (would execute in spreadsheet apps)',
    );
  });

  it("?rating=down returns only down-rated rows (one data row)", async () => {
    const { text } = await apiFetch("/api/uc/ai/chat-feedback/export?rating=down", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const dataRows = csvDataRows(text);
    // Only down-rated rows should be present (rating is column index 1)
    assert.ok(
      dataRows.every(r => r[1] === "down"),
      `All data rows must have rating=down, got:\n${dataRows.map(r => r[1]).join(",")}`,
    );
    // Exactly our one "down" fixture row should be present
    const hasOurRow = dataRows.some(r => (r[3] ?? "").includes("could not understand"));
    assert.ok(hasOurRow, "Expected to find the down-rated fixture row in the export");
    // The "up" row must be absent
    const hasUpRow = dataRows.some(r => (r[2] ?? "").includes("Sweet Home filter"));
    assert.ok(!hasUpRow, "Up-rated row must not appear in a rating=down export");
  });

  it("?rating=up returns only up-rated rows", async () => {
    const { text } = await apiFetch("/api/uc/ai/chat-feedback/export?rating=up", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const dataRows = csvDataRows(text);
    assert.ok(
      dataRows.every(r => r[1] === "up"),
      `All data rows must have rating=up, got:\n${dataRows.map(r => r[1]).join(",")}`,
    );
    const hasOurRow = dataRows.some(r => (r[2] ?? "").includes("Sweet Home filter"));
    assert.ok(hasOurRow, "Expected to find the up-rated fixture row in the export");
  });
});
