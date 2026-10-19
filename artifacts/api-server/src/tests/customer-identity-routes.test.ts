import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { db, pool, ucUsersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const { default: app } = await import("../app.js");
const createdIds: number[] = [];
let server: http.Server;
let baseUrl = "";

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/uc/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "identity-routes-test-secret";
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (createdIds.length) await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdIds));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("Companion registration identity gates", () => {
  it("concurrent signup produces one account without takeover or reuse", async () => {
    const suffix = randomUUID();
    const email = `registration-${suffix}@example.test`;
    const phone = `+2547${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const payload = { email, phone, address: "Test building, Nairobi", password: "registration-secret", firstName: "Test" };
    const responses = await Promise.all([post(payload), post(payload)]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 409).length, 1);
    const rows = await db.select({ id: ucUsersTable.id, passwordHash: ucUsersTable.passwordHash })
      .from(ucUsersTable).where(and(eq(ucUsersTable.email, email), eq(ucUsersTable.phone, phone)));
    assert.equal(rows.length, 1);
    createdIds.push(rows[0]!.id);
    assert.ok(rows[0]!.passwordHash.length > 0);
  });

  it("registration DB error logs only an allowlisted code, never raw PII or error detail", async () => {
    const sentinelEmail = `sentinel-${randomUUID()}@example.test`;
    const sentinelPhone = "+254700000001";
    const calls: unknown[][] = [];
    const loggerMock = mock.method(logger, "error", (...args: unknown[]) => { calls.push(args); });
    const connectMock = mock.method(pool, "connect", async () => {
      throw Object.assign(new Error(`query detail ${sentinelEmail} ${sentinelPhone}`), {
        code: "XX999", detail: sentinelEmail,
      });
    });
    try {
      const response = await post({
        email: sentinelEmail, phone: sentinelPhone, password: "registration-secret", firstName: "Test",
        address: "Test building, Nairobi",
      });
      assert.equal(response.status, 503);
      const serialized = JSON.stringify(calls);
      assert.equal(serialized.includes(sentinelEmail), false);
      assert.equal(serialized.includes(sentinelPhone), false);
      assert.equal(serialized.includes("query detail"), false);
      assert.equal(serialized.includes("unknown"), true);
    } finally {
      connectMock.mock.restore();
      loggerMock.mock.restore();
    }
  });
});