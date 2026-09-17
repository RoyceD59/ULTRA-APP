import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { conversations, db, teamUsersTable } from "@workspace/db";

import app from "../app.js";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let baseUrl: string;
const testTeamUserId = randomUUID();

async function createConversation(title: string): Promise<Response> {
  return fetch(`${baseUrl}/anthropic/conversations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${issueToken({ id: testTeamUserId, email: "team@test.local", type: "team-session", role: "admin", exp: Math.floor(Date.now() / 1000) + 3600 })}`,
    },
    body: JSON.stringify({ title }),
  });
}

async function conversationCount(): Promise<number> {
  const [result] = await db.select({ value: count() }).from(conversations);
  return result?.value ?? 0;
}

before(
  async () => {
    process.env["SESSION_SECRET"] ??= "test-secret-anthropic-conversation-create";
    await db.insert(teamUsersTable).values({
      id: testTeamUserId,
      email: "team@test.local",
      name: "Anthropic Test",
      passwordHash: "test-only",
      role: "admin",
      isActive: true,
    });
    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Server did not bind"));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}/api`;
        resolve();
      });
    });
  },
  { timeout: 30_000 },
);

after(async () => {
  await db.delete(teamUsersTable).where(eq(teamUsersTable.id, testTeamUserId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /anthropic/conversations title validation", () => {
  it("trims surrounding whitespace before inserting", async () => {
    const title = `Trimmed title ${Date.now()}`;
    const response = await createConversation(`  ${title}  `);

    assert.equal(response.status, 201);
    const body = (await response.json()) as { id: number; title: string };
    assert.equal(body.title, title);

    const [stored] = await db
      .select({ title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, body.id));
    assert.equal(stored?.title, title);

    await db.delete(conversations).where(eq(conversations.id, body.id));
  });

  it("returns 400 for a whitespace-only title without inserting", async () => {
    const beforeCount = await conversationCount();
    const response = await createConversation("   \t  ");

    assert.equal(response.status, 400);
    assert.equal(await conversationCount(), beforeCount);
  });

  it("returns 400 for a trimmed title over 80 characters without inserting", async () => {
    const beforeCount = await conversationCount();
    const response = await createConversation(`  ${"a".repeat(81)}  `);

    assert.equal(response.status, 400);
    assert.equal(await conversationCount(), beforeCount);
  });

  it("rejects a valid team token after the live user is deactivated", async () => {
    const id = randomUUID();
    await db.insert(teamUsersTable).values({
      id,
      email: `${id}@test.local`,
      name: "Anthropic Test",
      passwordHash: "test-only",
      role: "admin",
      isActive: true,
    });
    const token = issueToken({
      id,
      email: `${id}@test.local`,
      type: "team-session",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await db.update(teamUsersTable).set({ isActive: false }).where(eq(teamUsersTable.id, id));
    const response = await fetch(`${baseUrl}/anthropic/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    await db.delete(teamUsersTable).where(eq(teamUsersTable.id, id));
  });
});