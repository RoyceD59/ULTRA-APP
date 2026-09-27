import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import bcryptjs from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db, ucUsersTable } from "@workspace/db";

const { default: app } = await import("../app.js");
const originalFetch = globalThis.fetch;
const originalWcBase = process.env["WC_BASE_URL"];
const createdIds: number[] = [];
let server: http.Server;
let baseUrl = "";
let wooResponse: Record<string, unknown> = {};

before(async () => {
  process.env["SESSION_SECRET"] ??= "woo-identity-test-secret";
  process.env["WC_BASE_URL"] = "https://woo-identity.test";
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://woo-identity.test/")) {
      return new Response(JSON.stringify(wooResponse), { status: 200 });
    }
    return originalFetch(input, init);
  };
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalWcBase === undefined) delete process.env["WC_BASE_URL"];
  else process.env["WC_BASE_URL"] = originalWcBase;
  if (createdIds.length) await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdIds));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function login(email: string, password = "woo-password") {
  const response = await originalFetch(`${baseUrl}/api/uc/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("Woo verified identity gates", () => {
  it("fails closed when provider email mismatches submitted email", async () => {
    const submitted = `submitted-${randomUUID()}@example.com`;
    wooResponse = { token: "woo-token", user_email: `different-${randomUUID()}@example.com` };
    const result = await login(submitted);
    assert.equal(result.status, 401);
    const rows = await db.select({ id: ucUsersTable.id }).from(ucUsersTable)
      .where(eq(ucUsersTable.email, submitted));
    assert.equal(rows.length, 0);
  });

  it("fails closed when provider email is missing or blank", async () => {
    const submitted = `missing-${randomUUID()}@example.com`;
    for (const user_email of [undefined, ""]) {
      wooResponse = { token: "woo-token", ...(user_email === undefined ? {} : { user_email }) };
      const result = await login(submitted);
      assert.equal(result.status, 401);
    }
  });

  it("does not issue Woo session or replace an existing password account", async () => {
    const email = `collision-${randomUUID()}@example.com`;
    const password = "companion-original";
    const [row] = await db.insert(ucUsersTable).values({
      email, phone: "", passwordHash: await bcryptjs.hash(password, 10),
      firstName: "Password", lastName: "Owner",
    }).returning({ id: ucUsersTable.id });
    createdIds.push(row!.id);
    wooResponse = { token: "woo-token", user_email: email };
    const result = await login(email, "wrong-woo-password");
    assert.equal(result.status, 401);
    assert.equal("token" in result.body, false);
    const [stored] = await db.select({ passwordHash: ucUsersTable.passwordHash })
      .from(ucUsersTable).where(eq(ucUsersTable.id, row!.id));
    assert.equal(await bcryptjs.compare(password, stored!.passwordHash), true);
  });

  it("concurrent verified Woo logins converge to one database principal", async () => {
    const email = `concurrent-${randomUUID()}@example.com`;
    wooResponse = { token: "woo-token", user_email: email };
    const results = await Promise.all([login(email), login(email)]);
    assert.ok(results.every((result) => result.status === 200));
    const rows = await db.select({ id: ucUsersTable.id }).from(ucUsersTable)
      .where(and(eq(ucUsersTable.email, email), eq(ucUsersTable.authProvider, "woocommerce")));
    assert.equal(rows.length, 1);
    createdIds.push(rows[0]!.id);
  });
});