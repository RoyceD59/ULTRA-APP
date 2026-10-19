import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { before, after, describe, it } from "node:test";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
const teamId = randomUUID();
const email = `count-auth-${teamId}@test.internal`;
let bearer: string;

before(async () => {
  process.env["SESSION_SECRET"] ??= "customer-count-auth-test-only";
  await pool.query(
    `INSERT INTO team_users (id,email,name,password_hash,role,is_active)
     VALUES ($1,$2,'Count auth','x','member',true)`, [teamId, email],
  );
  bearer = `Bearer ${issueToken({ id: teamId, email, type: "team-session", role: "member" })}`;
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
});

after(async () => {
  await pool.query("DELETE FROM team_users WHERE id=$1", [teamId]);
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

async function request(authorization?: string) {
  const { port } = server.address() as { port: number };
  return fetch(`http://127.0.0.1:${port}/api/uc/admin/customers/count`, {
    headers: authorization ? { authorization } : {},
  });
}

describe("customer count live team authentication", () => {
  it("preserves access for active members and admins", async () => {
    for (const role of ["member", "admin"]) {
      await pool.query("UPDATE team_users SET role=$2 WHERE id=$1", [teamId, role]);
      const response = await request(bearer);
      assert.equal(response.status, 200);
      const body = await response.json();
      for (const key of ["count", "newThisWeek", "newThisMonth"]) {
        assert.equal(typeof body[key], "number");
      }
    }
  });

  it("immediately rejects the same bearer after deactivation or deletion", async () => {
    await pool.query("UPDATE team_users SET is_active=false WHERE id=$1", [teamId]);
    assert.equal((await request(bearer)).status, 401);
    await pool.query("UPDATE team_users SET is_active=true WHERE id=$1", [teamId]);
    assert.equal((await request(bearer)).status, 200);
    await pool.query("DELETE FROM team_users WHERE id=$1", [teamId]);
    assert.equal((await request(bearer)).status, 401);
  });

  it("rejects missing, customer, expired, unknown and legacy passcode principals", async () => {
    for (const authorization of [
      undefined,
      `Bearer ${issueToken({ id: 1, email })}`,
      `Bearer ${issueToken({ id: teamId, email, type: "team-session", exp: 1 })}`,
      `Bearer ${issueToken({ id: randomUUID(), email, type: "team-session" })}`,
      `Bearer ${issueToken({ id: "team", email, type: "team-session", role: "admin" })}`,
    ]) {
      assert.equal((await request(authorization)).status, 401);
    }
  });
});
