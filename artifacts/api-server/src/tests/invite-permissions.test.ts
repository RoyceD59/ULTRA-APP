/**
 * Invite permission integration tests.
 *
 * Verifies that an admin can pre-set page permissions on an invitation and the
 * registering member receives exactly those permissions. Also covers the
 * optional quick-invite path, which must retain the existing no-access default.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import http from "node:http";

import app from "../app.js";
import { db, teamInvitationsTable, teamUsersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

let server: http.Server;
let base: string;
const idsToDelete: string[] = [];
const inviteEmails: string[] = [];

async function createAdmin(): Promise<string> {
  const id = randomUUID();
  const email = `invite-admin-${Date.now()}-${id.slice(0, 8)}@teamtest.internal`;
  const password = "AdminPassword123!";
  await db.insert(teamUsersTable).values({
    id,
    email,
    name: "Invite Admin",
    passwordHash: await bcrypt.hash(password, 4),
    role: "admin",
    isActive: true,
    permissions: {},
  });
  idsToDelete.push(id);

  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, "admin login must succeed");
  const body = await response.json() as { token?: string };
  assert.ok(body.token, "admin login must return a token");
  return body.token!;
}

async function createInvite(
  token: string,
  email: string,
  permissions?: Record<string, string>,
): Promise<string> {
  const response = await fetch(`${base}/auth/invitations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email, ...(permissions ? { permissions } : {}) }),
  });
  assert.equal(response.status, 201, "invitation must be created");
  const body = await response.json() as { inviteUrl?: string };
  assert.ok(body.inviteUrl, "invitation must return a registration URL");
  const inviteToken = new URL(body.inviteUrl!).searchParams.get("token");
  assert.ok(inviteToken, "invite URL must contain its opaque token");
  return inviteToken!;
}

async function registerInvite(token: string, name: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name, password: "MemberPassword123!" }),
  });
  assert.equal(response.status, 201, "invitee registration must succeed");
  return await response.json() as Record<string, unknown>;
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-invite-permissions";
  // Avoid invoking the external Resend connector while testing invite delivery.
  process.env["RESEND_BASE_URL"] = "http://127.0.0.1:1";

  await new Promise<void>((resolve, reject) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("API test server did not bind"));
        return;
      }
      base = `http://127.0.0.1:${address.port}/api`;
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  if (idsToDelete.length) {
    await db.delete(teamUsersTable).where(inArray(teamUsersTable.id, idsToDelete));
  }
  if (inviteEmails.length) {
    await db.delete(teamInvitationsTable).where(inArray(teamInvitationsTable.email, inviteEmails));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("ProjectHub invite permissions", () => {
  it("applies pre-selected page permissions when the invitee registers", async () => {
    const adminToken = await createAdmin();
    const email = `invite-member-${Date.now()}@teamtest.internal`;
    inviteEmails.push(email);
    const selectedPermissions = { dashboard: "view", projects: "edit", tickets: "none" };

    const inviteToken = await createInvite(adminToken, email, selectedPermissions);
    const [storedInvite] = await db.select().from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.token, inviteToken));
    assert.deepEqual(storedInvite?.permissions, selectedPermissions, "invite must retain selected permissions");

    const registration = await registerInvite(inviteToken, "Invited Member");
    const registeredUser = registration["user"] as { id: string; permissions: Record<string, string> };
    idsToDelete.push(registeredUser.id);
    assert.deepEqual(registeredUser.permissions, selectedPermissions);
  });

  it("keeps the existing no-access default when the admin skips permissions", async () => {
    const adminToken = await createAdmin();
    const email = `quick-invite-member-${Date.now()}@teamtest.internal`;
    inviteEmails.push(email);

    const inviteToken = await createInvite(adminToken, email);
    const [storedInvite] = await db.select().from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.token, inviteToken));
    assert.equal(storedInvite?.permissions, null, "quick invite must not store a permission map");

    const registration = await registerInvite(inviteToken, "Quick Invite Member");
    const registeredUser = registration["user"] as { id: string; permissions: Record<string, string> };
    idsToDelete.push(registeredUser.id);
    assert.deepEqual(registeredUser.permissions, {});
  });
});