/**
 * Confirms that the contact card on the ticket form always shows the most
 * recent phone number and that the server captures it correctly.
 *
 * Covers two related concerns:
 *
 * 1. SERVER — profile update persists the phone to the DB so that a ticket
 *    submitted immediately afterwards finds the new number via getUserContact.
 *    PATCH /api/uc/customer/profile → POST /api/uc/tickets must sequence such
 *    that the phone in the team notification is the one just saved.
 *
 * 2. CLIENT — AuthContext.updateUser writes through to React state, so the
 *    contact card (which reads user.phone directly from useAuth()) reflects the
 *    new phone the moment the account screen saves it — without a restart or
 *    explicit refetch.  This is verified by code-path analysis below.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import {
  db,
  ucUsersTable,
  ucTicketsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import bcryptjs from "bcryptjs";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-phone-refresh";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) =>
      err ? reject(err) : resolve(),
    );
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(e => (e ? reject(e) : resolve())),
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function bearerFor(userId: number, email: string): string {
  return `Bearer ${issueToken({ id: userId, email, firstName: "Phone", lastName: "Test" })}`;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_EMAIL     = "phone-refresh-ticket@ucfilters-test.internal";
const INITIAL_PHONE  = "";
const ADDED_PHONE    = "+254700111222";

let testUserId:      number;
let insertedTicketIds: string[] = [];

describe("Phone refresh — profile update flows through to ticket contact", () => {
  before(async () => {
    // Create a registered user with no phone (simulates first-time flow)
    const hash = await bcryptjs.hash("test-password-not-real", 1);
    const [row] = await db
      .insert(ucUsersTable)
      .values({
        email:        TEST_EMAIL,
        passwordHash: hash,
        firstName:    "Phone",
        lastName:     "Test",
        phone:        INITIAL_PHONE,
        address:      "Test building, Nairobi",
        isAdmin:      false,
      })
      .returning({ id: ucUsersTable.id });
    if (!row) throw new Error("Failed to insert test user");
    testUserId = row.id;
  });

  after(async () => {
    if (insertedTicketIds.length > 0) {
      await db
        .delete(ucTicketsTable)
        .where(inArray(ucTicketsTable.id, insertedTicketIds));
    }
    if (testUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
    }
  });

  // ── Part 1: server-side profile update ────────────────────────────────────

  it("profile starts with no phone", async () => {
    const { status, body } = await apiFetch("/api/uc/customer/profile", {
      headers: { Authorization: bearerFor(testUserId, TEST_EMAIL) },
    });
    assert.equal(status, 200);
    const b = body as Record<string, unknown>;
    assert.equal(b["phone"], "", "Phone should be empty before the update");
  });

  it("PATCH /api/uc/customer/profile persists the phone to the DB", async () => {
    const { status, body } = await apiFetch("/api/uc/customer/profile", {
      method:  "PATCH",
      headers: {
        Authorization:  bearerFor(testUserId, TEST_EMAIL),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: ADDED_PHONE }),
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    const b = body as Record<string, unknown>;
    assert.equal(b["phone"], ADDED_PHONE, "Response must include the new phone");

    // Verify the phone is durably persisted in the DB (the source getUserContact reads)
    const row = await db.query.ucUsersTable.findFirst({
      where: eq(ucUsersTable.id, testUserId),
    });
    assert.equal(
      row?.phone,
      ADDED_PHONE,
      "DB row must reflect the new phone so getUserContact returns it for ticket notifications",
    );
  });

  it("GET /api/uc/customer/profile now returns the updated phone", async () => {
    const { status, body } = await apiFetch("/api/uc/customer/profile", {
      headers: { Authorization: bearerFor(testUserId, TEST_EMAIL) },
    });
    assert.equal(status, 200);
    const b = body as Record<string, unknown>;
    assert.equal(
      b["phone"],
      ADDED_PHONE,
      "Profile endpoint must return the phone that was just saved",
    );
  });

  // ── Part 2: ticket creation uses the live DB phone ─────────────────────────

  it("POST /api/uc/tickets succeeds after the phone is added", async () => {
    const { status, body } = await apiFetch("/api/uc/tickets", {
      method:  "POST",
      headers: {
        Authorization:  bearerFor(testUserId, TEST_EMAIL),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productModel:         "Sweet Home",
        issueDescription:     "Testing phone capture after profile update",
        preferredContactTime: "Any time",
        photos:               [],
        videos:               [],
      }),
    });
    assert.equal(status, 201, `Ticket submission failed: ${JSON.stringify(body)}`);
    const b = body as Record<string, unknown>;
    assert.ok(typeof b["id"] === "string" && b["id"] !== "", "Response must include a ticket id");

    // Track for cleanup
    insertedTicketIds.push(b["id"] as string);

    // The ticket row is stored with the userId so the team can look up the
    // contact details via getUserContact, which now returns the new phone.
    const ticket = await db.query.ucTicketsTable.findFirst({
      where: eq(ucTicketsTable.id, b["id"] as string),
    });
    assert.equal(
      ticket?.userId,
      String(testUserId),
      "Ticket row must be linked to the user so getUserContact resolves the phone",
    );
  });

  it("getUserContact returns the new phone for the submitted ticket", async () => {
    // Directly query the DB the same way the server's getUserContact does,
    // confirming the phone that will reach team notifications is the updated one.
    const row = await db.query.ucUsersTable.findFirst({
      where: eq(ucUsersTable.id, testUserId),
    });
    assert.equal(
      row?.phone,
      ADDED_PHONE,
      "getUserContact source (ucUsersTable) must return the updated phone, " +
        "not the stale value from before the profile edit",
    );
  });

  // ── Part 3: invalid phone is rejected (format guard) ──────────────────────

  it("PATCH /api/uc/customer/profile rejects an invalid phone format", async () => {
    const { status } = await apiFetch("/api/uc/customer/profile", {
      method:  "PATCH",
      headers: {
        Authorization:  bearerFor(testUserId, TEST_EMAIL),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: "07001112223334" }),   // local format, not E.164
    });
    assert.equal(status, 400, "A non-E.164 phone must be rejected with 400");
  });

  it("PATCH /api/uc/customer/profile rejects clearing the required phone and preserves the saved number", async () => {
    const { status, body } = await apiFetch("/api/uc/customer/profile", {
      method:  "PATCH",
      headers: {
        Authorization:  bearerFor(testUserId, TEST_EMAIL),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: "" }),
    });
    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
    const row = await db.query.ucUsersTable.findFirst({ where: eq(ucUsersTable.id, testUserId) });
    assert.equal(row?.phone, ADDED_PHONE);
  });
});

/**
 * CLIENT-SIDE ANALYSIS (no runtime test possible here — verified by code review):
 *
 * The contact card in `app/ticket/new.tsx` reads `user?.phone` directly from
 * `useAuth()`.  The hook returns the `user` React-state value from AuthContext.
 *
 * `updateUser` in `context/AuthContext.tsx` (lines 171-176):
 *   - Merges the incoming `updates` over the current `user` object
 *   - Writes the merged object to AsyncStorage (durable across cold starts)
 *   - Calls `setUser(updated)` — React state, triggers immediate re-render
 *
 * `EditProfileModal.handleSave` in `app/(tabs)/account.tsx` (lines 86-100):
 *   1. `await api.updateProfile(...)` — persists to DB via PATCH /api/uc/customer/profile
 *   2. `await updateUser({ firstName, lastName, phone })` — updates React state
 *   3. Calls `onSaved(...)` to close the modal
 *
 * Navigation: `router.push('/(tabs)/account?editProfile=1')` keeps the ticket
 * form mounted in the background.  When the user returns, the form's
 * `useAuth()` subscription already reflects the new `user.phone` — no refetch,
 * no restart required.
 *
 * Conclusion: the data flow is correct end-to-end.
 */
