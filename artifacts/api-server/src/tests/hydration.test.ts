import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import hydrationRouter, { validHydrationDate } from "../routes/uc-hydration.js";
import { issueToken } from "../lib/jwt.js";

describe("customer-owned daily hydration", () => {
  const app = express().use(express.json()).use(hydrationRouter);
  const users: number[] = [];
  const token = (id: number) => issueToken({ id, email: "hydration-test@example.test", exp: Math.floor(Date.now() / 1000) + 3600 });
  before(async () => {
    for (let i = 0; i < 2; i++) {
      const row = await pool.query(`INSERT INTO uc_users(email,password_hash,first_name) VALUES($1,'unused','Hydration') RETURNING id`, [`hydration-${randomUUID()}@example.test`]);
      users.push(row.rows[0].id);
    }
  });
  after(async () => { await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [users]); });
  const path = "/uc/me/hydration/2026-10-03";
  it("reads an unset total and upserts decimal and zero without duplicate days", async () => {
    let response = await request(app).get(path).set("Authorization", `Bearer ${token(users[0])}`);
    assert.equal(response.status, 200); assert.equal(response.body.litres, null);
    for (const litres of [1.25, 1.25, 0]) {
      response = await request(app).put(path).set("Authorization", `Bearer ${token(users[0])}`).send({ litres });
      assert.equal(response.status, 200); assert.equal(response.body.litres, litres);
    }
    response = await request(app).get(path).set("Authorization", `Bearer ${token(users[0])}`);
    assert.equal(response.body.litres, 0);
    const rows = await pool.query("SELECT litres, local_date::text AS local_date FROM uc_daily_hydration WHERE user_id=$1", [users[0]]);
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].local_date, "2026-10-03");
  });
  it("isolates customers and rejects forged ownership fields", async () => {
    const other = await request(app).get(path).set("Authorization", `Bearer ${token(users[1])}`);
    assert.equal(other.body.litres, null);
    assert.equal((await request(app).put(path).set("Authorization", `Bearer ${token(users[1])}`).send({ litres: 2, userId: users[0] })).status, 400);
    assert.equal((await request(app).get(path)).status, 401);
    const teamToken = issueToken({ id: users[0], type: "team-session", email: "team@example.test" });
    assert.equal((await request(app).get(path).set("Authorization", `Bearer ${teamToken}`)).status, 401);
    const temporaryToken = issueToken({ id: users[0], mustChangePassword: true, email: "temporary@example.test" });
    assert.equal((await request(app).get(path).set("Authorization", `Bearer ${temporaryToken}`)).status, 401);
    const oldToken = issueToken({ id: users[0], credentialVersion: 3, email: "old@example.test" });
    assert.equal((await request(app).get(path).set("Authorization", `Bearer ${oldToken}`)).status, 401);
  });
  it("rejects invalid quantities and invalid dates without changing saved data", async () => {
    for (const litres of [-1, "1.2", null, "NaN", "Infinity"]) {
      const result = await request(app).put(path).set("Authorization", `Bearer ${token(users[0])}`).send({ litres });
      assert.equal(result.status, 400);
    }
    for (const date of ["2026-02-30", "2026-13-01", "2026-1-01", "0000-01-01"]) {
      assert.equal((await request(app).put(`/uc/me/hydration/${date}`).set("Authorization", `Bearer ${token(users[0])}`).send({ litres: 1 })).status, 400);
    }
    assert.equal(validHydrationDate("2028-02-29"), true);
    assert.equal(validHydrationDate("2026-02-29"), false);
  });
  it("preserves the supplied local date across adjacent UTC days", async () => {
    for (const localDate of ["2026-10-02", "2026-10-04"]) {
      const result = await request(app).put(`/uc/me/hydration/${localDate}`).set("Authorization", `Bearer ${token(users[0])}`).send({ litres: 0.75 });
      assert.deepEqual(result.body, { localDate, litres: 0.75 });
    }
  });
  it("rejects deleted accounts and physically cascades their hydration records", async () => {
    await pool.query("UPDATE uc_users SET deleted_at=now() WHERE id=$1", [users[1]]);
    assert.equal((await request(app).put(path).set("Authorization", `Bearer ${token(users[1])}`).send({ litres: 1 })).status, 401);
    await pool.query("DELETE FROM uc_users WHERE id=$1", [users[0]]);
    assert.equal((await pool.query("SELECT * FROM uc_daily_hydration WHERE user_id=$1", [users[0]])).rowCount, 0);
  });
});