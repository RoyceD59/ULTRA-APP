import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let authorization: string;
let teamId = "";
const insertedUserIds: number[] = [];
const insertedOrderIds: number[] = [];

async function request(path: string, auth = authorization): Promise<Response> {
  const address = server.address() as { port: number };
  return fetch(`http://127.0.0.1:${address.port}${path}`, {
    headers: auth ? { authorization: auth } : {},
  });
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-customer-export";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => err ? reject(err) : resolve());
  });

  const suffix = `${Date.now()}-${process.pid}`;
  teamId = `customer-export-team-${suffix}`;
  const teamEmail = `customer-export-${suffix}@test.internal`;
  await pool.query(
    `INSERT INTO team_users (id, email, name, password_hash, role, is_active)
     VALUES ($1, $2, 'Customer Export Tester', 'x', 'admin', true)`,
    [teamId, teamEmail],
  );
  authorization = `Bearer ${issueToken({
    id: teamId,
    email: teamEmail,
    type: "team-session",
    role: "admin",
  })}`;

  const customers = await pool.query<{ id: number }>(
    `INSERT INTO uc_users
       (email, password_hash, first_name, last_name, phone, created_at)
     VALUES
       ($1, 'x', '=Formula', 'Matched', '+254700000001', '2026-02-10T12:00:00Z'),
       ($2, 'x', 'Outside', 'Range', '+254700000002', '2026-01-01T12:00:00Z')
     RETURNING id`,
    [`customer-export-match-${suffix}@test.internal`, `customer-export-outside-${suffix}@test.internal`],
  );
  insertedUserIds.push(...customers.rows.map((row) => row.id));

  const order = await pool.query<{ id: number }>(
    `INSERT INTO uc_orders (user_id, status, total, currency, payment_method, date_created)
     VALUES ($1, 'completed', '1000', 'KES', 'cod', now())
     RETURNING id`,
    [String(customers.rows[0]!.id)],
  );
  insertedOrderIds.push(order.rows[0]!.id);
});

after(async () => {
  if (insertedOrderIds.length) {
    await pool.query("DELETE FROM uc_orders WHERE id = ANY($1::int[])", [insertedOrderIds]);
  }
  if (insertedUserIds.length) {
    await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [insertedUserIds]);
  }
  if (teamId) await pool.query("DELETE FROM team_users WHERE id = $1", [teamId]);
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

describe("GET /uc/admin/customers/export", () => {
  it("requires admin access", async () => {
    const response = await request("/api/uc/admin/customers/export", "");
    assert.equal(response.status, 403);
  });

  it("exports all and only matching customers with safe CSV cells and a filter-aware filename", async () => {
    const response = await request(
      "/api/uc/admin/customers/export?q=Formula&from=2026-02-01&to=2026-02-28",
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /^attachment; filename="customers_\d{4}-\d{2}-\d{2}_search-formula_from-2026-02-01_to-2026-02-28\.csv"$/,
    );

    const csv = await response.text();
    assert.match(csv, /^name,email,phone,joinedDate,orderCount\r\n/);
    assert.match(csv, /'=Formula Matched/);
    assert.match(csv, /customer-export-match-/);
    assert.match(csv, /,"'\+254700000001",/);
    assert.match(csv, /,1\r\n$/);
    assert.doesNotMatch(csv, /customer-export-outside-/);
  });

  it("rejects invalid date filters", async () => {
    const response = await request("/api/uc/admin/customers/export?from=2026-02-30");
    assert.equal(response.status, 400);
  });
});