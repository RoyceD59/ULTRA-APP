/**
 * Offline clients — phone and email round-trip
 *
 * Verifies that phone and email fields save and display correctly across all
 * form actions (create, edit, clear) and that invalid values are rejected.
 *
 * Scenarios:
 *   1. POST with valid phone + email → both returned in the response and in
 *      the GET list.
 *   2. PUT that changes phone and email → updated values returned.
 *   3. PUT that clears phone and email (null) → nulls returned, no error.
 *   4. Existing records with null phone/email are returned without errors.
 *   5. POST with an invalid phone (too short / non-numeric characters only) →
 *      400 with a descriptive error.
 *   6. POST with an invalid email (no @) → 400 with a descriptive error.
 *   7. PUT with invalid phone → 400.
 *   8. PUT with invalid email → 400.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db, teamUsersTable, ucOfflineClientsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEAM_ADMIN_ID = "test-offline-ph-email-admin";
const TEAM_IDS      = [TEAM_ADMIN_ID];

let server: http.Server;
let adminToken: string;
/** IDs of rows created during the test — cleaned up in `after`. */
const createdIds: number[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res  = await fetch(`http://localhost:${addr.port}${path}`, init);
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function authedJson(token: string, body: unknown): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

/** Minimal valid POST payload — caller can override any field. */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientRef: "Test Client",
    products:  [{ productName: "Hydra Flux bottle", productId: 1, quantity: 2 }],
    saleDate:  "2025-01-15",
    notes:     "",
    ...overrides,
  };
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-offline-phone-email";

  // Seed a team admin row the gate re-verifies on each request.
  await db.insert(teamUsersTable).values({
    id:           TEAM_ADMIN_ID,
    email:        "offline-ph-email-admin@test.internal",
    name:         "Phone Email Admin",
    passwordHash: "x",
    role:         "admin",
    isActive:     true,
  });

  adminToken = issueToken({
    id:   TEAM_ADMIN_ID,
    email: "offline-ph-email-admin@test.internal",
    type: "team-session",
    role: "admin",
    exp:  Math.floor(Date.now() / 1000) + 3600,
  });

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  // Delete created offline client rows.
  if (createdIds.length > 0) {
    try {
      await db
        .delete(ucOfflineClientsTable)
        .where(inArray(ucOfflineClientsTable.id, createdIds));
    } catch { /* per-run DB */ }
  }
  try {
    await db.delete(teamUsersTable).where(inArray(teamUsersTable.id, TEAM_IDS));
  } catch { /* per-run DB */ }
  await new Promise<void>((resolve, reject) =>
    server.close(e => (e ? reject(e) : resolve()))
  );
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("offline clients — phone and email: valid values round-trip", () => {

  it("POST with phone and email stores both and returns them in the response", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      method: "POST",
      ...authedJson(adminToken, validPayload({
        phone: "+254 712 345 678",
        email: "jane@example.com",
      })),
    });

    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const client = (body as { client: { id: number; phone: string; email: string } }).client;
    assert.ok(client?.id, "response must include the new row id");
    createdIds.push(client.id);

    assert.equal(client.phone, "+254 712 345 678", "phone must round-trip exactly");
    assert.equal(client.email, "jane@example.com", "email must be lowercased and stored");
  });

  it("GET list includes the phone and email for the created row", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(status, 200);

    const clients = (body as { clients: Array<{ id: number; phone: string | null; email: string | null }> }).clients;
    const row = clients.find(c => c.id === createdIds[0]);
    assert.ok(row, "row must appear in the list");
    assert.equal(row.phone, "+254 712 345 678");
    assert.equal(row.email, "jane@example.com");
  });

  it("PUT updates phone and email to new values", async () => {
    const id = createdIds[0]!;
    const { status, body } = await apiFetch(`/api/uc/offline-clients/${id}`, {
      method: "PUT",
      ...authedJson(adminToken, validPayload({
        phone: "0722000111",
        email: "UPDATED@example.com",
      })),
    });

    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    const client = (body as { client: { phone: string; email: string } }).client;
    assert.equal(client.phone, "0722000111");
    assert.equal(client.email, "updated@example.com", "email must be lowercased on save");
  });

  it("PUT can clear phone and email to null", async () => {
    const id = createdIds[0]!;
    const { status, body } = await apiFetch(`/api/uc/offline-clients/${id}`, {
      method: "PUT",
      ...authedJson(adminToken, validPayload({ phone: null, email: null })),
    });

    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    const client = (body as { client: { phone: string | null; email: string | null } }).client;
    assert.equal(client.phone, null, "phone must be null after clearing");
    assert.equal(client.email, null, "email must be null after clearing");
  });

  it("GET list returns the row with null phone/email without errors", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(status, 200);

    const clients = (body as { clients: Array<{ id: number; phone: string | null; email: string | null }> }).clients;
    const row = clients.find(c => c.id === createdIds[0]);
    assert.ok(row, "row must still appear in the list");
    assert.equal(row.phone, null, "null phone must remain null in the list");
    assert.equal(row.email, null, "null email must remain null in the list");
  });

  it("POST with omitted phone and email creates a row with null phone/email", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      method: "POST",
      ...authedJson(adminToken, validPayload()),   // no phone / email keys
    });

    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const client = (body as { client: { id: number; phone: string | null; email: string | null } }).client;
    createdIds.push(client.id);
    assert.equal(client.phone, null);
    assert.equal(client.email, null);
  });

  it("POST with empty-string phone and email stores null (treated as absent)", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      method: "POST",
      ...authedJson(adminToken, validPayload({ phone: "", email: "" })),
    });

    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const client = (body as { client: { id: number; phone: string | null; email: string | null } }).client;
    createdIds.push(client.id);
    assert.equal(client.phone, null, "empty phone string must be stored as null");
    assert.equal(client.email, null, "empty email string must be stored as null");
  });
});

describe("offline clients — phone validation rejects invalid values", () => {

  it("POST with a phone that is too short is rejected with 400", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      method: "POST",
      ...authedJson(adminToken, validPayload({ phone: "123" })),   // only 3 digits
    });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    const err = (body as { error?: string }).error ?? "";
    assert.ok(err.toLowerCase().includes("phone"), `error must mention 'phone': ${err}`);
  });

  it("POST with a non-numeric phone (letters) is rejected with 400", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      method: "POST",
      ...authedJson(adminToken, validPayload({ phone: "call-me-maybe" })),
    });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    const err = (body as { error?: string }).error ?? "";
    assert.ok(err.toLowerCase().includes("phone"), `error must mention 'phone': ${err}`);
  });

  it("PUT with an invalid phone is also rejected with 400", async () => {
    const id = createdIds[0]!;
    const { status, body } = await apiFetch(`/api/uc/offline-clients/${id}`, {
      method: "PUT",
      ...authedJson(adminToken, validPayload({ phone: "abc" })),
    });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  });
});

describe("offline clients — email validation rejects invalid values", () => {

  it("POST with an email missing @ is rejected with 400", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      method: "POST",
      ...authedJson(adminToken, validPayload({ email: "notanemail" })),
    });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    const err = (body as { error?: string }).error ?? "";
    assert.ok(err.toLowerCase().includes("email"), `error must mention 'email': ${err}`);
  });

  it("POST with an email missing a domain part is rejected with 400", async () => {
    const { status, body } = await apiFetch("/api/uc/offline-clients", {
      method: "POST",
      ...authedJson(adminToken, validPayload({ email: "user@" })),
    });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    const err = (body as { error?: string }).error ?? "";
    assert.ok(err.toLowerCase().includes("email"), `error must mention 'email': ${err}`);
  });

  it("PUT with an invalid email is also rejected with 400", async () => {
    const id = createdIds[0]!;
    const { status, body } = await apiFetch(`/api/uc/offline-clients/${id}`, {
      method: "PUT",
      ...authedJson(adminToken, validPayload({ email: "bad-email" })),
    });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  });
});
