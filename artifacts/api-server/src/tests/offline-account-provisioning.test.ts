import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db, teamUsersTable, ucOfflineClientsTable, ucUsersTable } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { retryOfflineSaleDelivery } from "../lib/offline-provisioning.js";

const teamId = "offline-provisioning-test-admin";
const userIds: number[] = [];
const saleIds: number[] = [];
let server: http.Server;
let token: string;

async function request(path: string, init: RequestInit): Promise<{ status: number; body: any }> {
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function adminJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function sale(key: string, email: string, phone: string) {
  return {
    idempotencyKey: key,
    email,
    phone,
    firstName: "Existing",
    products: [{ productName: "Hydra Flux", productId: 1, quantity: 1 }],
    saleDate: "2026-09-14",
  };
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "offline-provisioning-test-secret";
  await db.insert(teamUsersTable).values({
    id: teamId, email: "offline-provisioning-admin@test.internal",
    name: "Offline Provisioning Admin", passwordHash: "x", role: "admin", isActive: true,
  });
  token = issueToken({ id: teamId, email: "offline-provisioning-admin@test.internal", type: "team-session", role: "admin", exp: Math.floor(Date.now() / 1000) + 3600 });
  const [user] = await db.insert(ucUsersTable).values({
    email: "existing-offline@example.com",
    phone: "+254712345678",
    passwordHash: await bcryptjs.hash("existing-password", 10),
    firstName: "Existing", lastName: "Customer",
  }).returning();
  userIds.push(user!.id);
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });
});

after(async () => {
  await db.delete(ucOfflineClientsTable).where(inArray(ucOfflineClientsTable.id, saleIds)).catch(() => undefined);
  await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, userIds)).catch(() => undefined);
  await db.delete(teamUsersTable).where(eq(teamUsersTable.id, teamId)).catch(() => undefined);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("offline Companion account provisioning", () => {
  it("links an existing account idempotently without replacing its password", async () => {
    const result = await request("/api/uc/offline-clients", adminJson(
      sale("offline-link-existing-001", "existing-offline@example.com", "+254 712 345 678"),
    ));
    assert.equal(result.status, 201);
    saleIds.push(result.body.client.id);
    assert.equal(result.body.client.accountSetupStatus, "linked-existing");
    assert.equal(result.body.client.deliveryStatus, "not_applicable");
    for (const internal of ["deliveryClaimToken", "deliveryClaimExpiresAt", "deliveryJobKey", "idempotencyKey"]) {
      assert.equal(internal in result.body.client, false, `${internal} must not be returned`);
    }

    const repeated = await request("/api/uc/offline-clients", adminJson(
      sale("offline-link-existing-001", "existing-offline@example.com", "+254 712 345 678"),
    ));
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.client.id, result.body.client.id);
    const listed = await request("/api/uc/offline-clients", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.clients.some((client: Record<string, unknown>) =>
      ["deliveryClaimToken", "deliveryClaimExpiresAt", "deliveryJobKey", "idempotencyKey"]
        .some((key) => key in client)), false);
    const edited = await request(`/api/uc/offline-clients/${result.body.client.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRef: "Edited",
        phone: "+254 712 345 678",
        email: "existing-offline@example.com",
        products: [{ productName: "Hydra Flux", productId: 1, quantity: 1 }],
        saleDate: "2026-09-14",
      }),
    });
    assert.equal(edited.status, 200);
    assert.equal("deliveryClaimToken" in edited.body.client, false);

    const login = await request("/api/uc/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "+254 712 345 678", password: "existing-password" }),
    });
    assert.equal(login.status, 200);
  });

  it("fails closed when email and phone identify different accounts", async () => {
    const [other] = await db.insert(ucUsersTable).values({
      email: "different-offline@example.com",
      phone: "+254798765432",
      passwordHash: await bcryptjs.hash("other-password", 10),
      firstName: "Other", lastName: "Customer",
    }).returning();
    userIds.push(other!.id);
    const result = await request("/api/uc/offline-clients", adminJson(
      sale("offline-conflict-001", "existing-offline@example.com", "+254 798 765 432"),
    ));
    assert.equal(result.status, 201);
    saleIds.push(result.body.client.id);
    assert.equal(result.body.client.accountSetupStatus, "conflict");
    assert.equal(result.body.client.companionUserId, null);
    const rows = await db.select({ id: ucUsersTable.id }).from(ucUsersTable)
      .where(and(eq(ucUsersTable.email, "existing-offline@example.com"), eq(ucUsersTable.phone, "+254712345678")));
    assert.equal(rows.length, 1);
  });

  it("leaves an active-email/deleted-phone identity conflicted and unlinked", async () => {
    const suffix = randomUUID();
    const email = `mixed-active-${suffix}@example.com`;
    const phone = `+2547${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const [active] = await db.insert(ucUsersTable).values({
      email, phone: "+254700000002", passwordHash: await bcryptjs.hash("active-secret", 10),
      firstName: "Active", lastName: "Identity",
    }).returning();
    const [deleted] = await db.insert(ucUsersTable).values({
      email: `deleted-${suffix}@example.com`, phone, passwordHash: await bcryptjs.hash("deleted-secret", 10),
      firstName: "Deleted", lastName: "Identity", deletedAt: new Date(),
    }).returning();
    userIds.push(active!.id, deleted!.id);
    const result = await request("/api/uc/offline-clients", adminJson(
      sale(`offline-mixed-${suffix}`, email, phone),
    ));
    assert.equal(result.status, 201);
    saleIds.push(result.body.client.id);
    assert.equal(result.body.client.accountSetupStatus, "conflict");
    assert.equal(result.body.client.companionUserId, null);
  });

  it("serializes different idempotency keys for the same normalized phone", async () => {
    const phone = "+254 733 444 555";
    const body = (key: string) => ({
      idempotencyKey: key,
      phone,
      firstName: "Concurrent",
      products: [{ productName: "Hydra Flux", productId: 1, quantity: 1 }],
      saleDate: "2026-09-14",
    });
    const [one, two] = await Promise.all([
      request("/api/uc/offline-clients", adminJson(body("offline-phone-race-001"))),
      request("/api/uc/offline-clients", adminJson(body("offline-phone-race-002"))),
    ]);
    assert.equal(one.status, 201);
    assert.equal(two.status, 201);
    saleIds.push(one.body.client.id, two.body.client.id);
    assert.equal(one.body.client.companionUserId, two.body.client.companionUserId);
    userIds.push(one.body.client.companionUserId);
  });

  it("does not reclaim an actively leased delivery after a process gap", async () => {
    const [user] = await db.insert(ucUsersTable).values({
      email: "pending-offline@example.com",
      phone: "+254711111111",
      passwordHash: await bcryptjs.hash(randomUUID(), 10),
      firstName: "Pending", lastName: "Customer",
    }).returning();
    userIds.push(user!.id);
    const [saleRow] = await db.insert(ucOfflineClientsTable).values({
      idempotencyKey: "offline-process-gap-001",
      clientRef: "Pending",
      email: "pending-offline@example.com",
      phone: "+254711111111",
      products: [{ productName: "Hydra Flux", quantity: 1 }],
      saleDate: "2026-09-14",
      companionUserId: user!.id,
      accountSetupStatus: "created",
      deliveryChannel: "email",
      deliveryStatus: "sending",
      deliveryClaimToken: "active-claim",
      deliveryClaimExpiresAt: new Date(Date.now() + 60_000),
    }).returning();
    saleIds.push(saleRow!.id);

    const result = await retryOfflineSaleDelivery(saleRow!.id);
    assert.equal(result?.deliveryStatus, "sending");
    const [savedUser] = await db.select({
      mustChangePassword: ucUsersTable.mustChangePassword,
      temporaryPasswordExpiresAt: ucUsersTable.temporaryPasswordExpiresAt,
    }).from(ucUsersTable).where(eq(ucUsersTable.id, user!.id));
    assert.equal(savedUser?.mustChangePassword, false);
    assert.equal(savedUser?.temporaryPasswordExpiresAt, null);
  });

  it("reconciles an expired lease after permanent password completion", async () => {
    const permanentHash = await bcryptjs.hash("chosen-permanent-password", 10);
    const [user] = await db.insert(ucUsersTable).values({
      email: "completed-offline@example.com",
      phone: "+254722222222",
      passwordHash: permanentHash,
      firstName: "Completed", lastName: "Customer",
      credentialVersion: 9,
      mustChangePassword: false,
    }).returning();
    userIds.push(user!.id);
    const [saleRow] = await db.insert(ucOfflineClientsTable).values({
      idempotencyKey: "offline-completed-lease-001",
      clientRef: "Completed",
      email: "completed-offline@example.com",
      phone: "+254722222222",
      products: [{ productName: "Hydra Flux", quantity: 1 }],
      saleDate: "2026-09-14",
      companionUserId: user!.id,
      accountSetupStatus: "created",
      deliveryChannel: "email",
      deliveryStatus: "sending",
      deliveryClaimToken: "expired-completed-claim",
      deliveryClaimExpiresAt: new Date(Date.now() - 60_000),
      issuedCredentialVersion: 8,
    }).returning();
    saleIds.push(saleRow!.id);

    const result = await retryOfflineSaleDelivery(saleRow!.id);
    assert.equal(result?.deliveryStatus, "sent");
    assert.equal(result?.deliveryClaimToken, undefined);
    const [savedSale] = await db.select({
      deliveryClaimToken: ucOfflineClientsTable.deliveryClaimToken,
      deliveryClaimExpiresAt: ucOfflineClientsTable.deliveryClaimExpiresAt,
    }).from(ucOfflineClientsTable).where(eq(ucOfflineClientsTable.id, saleRow!.id));
    assert.equal(savedSale?.deliveryClaimToken, null);
    assert.equal(savedSale?.deliveryClaimExpiresAt, null);
    const [savedUser] = await db.select({
      passwordHash: ucUsersTable.passwordHash,
      credentialVersion: ucUsersTable.credentialVersion,
      mustChangePassword: ucUsersTable.mustChangePassword,
    }).from(ucUsersTable).where(eq(ucUsersTable.id, user!.id));
    assert.equal(savedUser?.passwordHash, permanentHash);
    assert.equal(savedUser?.credentialVersion, 9);
    assert.equal(savedUser?.mustChangePassword, false);
  });
});