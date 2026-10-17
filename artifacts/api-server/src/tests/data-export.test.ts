import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import http from "node:http";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

const realFetch = globalThis.fetch, saved = { ...process.env };
const users: { id: number; email: string; token: string }[] = [];
let server: http.Server, base: string;
let ownOrderIds: number[], foreignOrderId: number, wooCalls = 0;
const marker = randomUUID();
before(async () => {
  for (let i = 0; i < 2; i++) {
    const email = `export-${randomUUID()}@example.test`;
    const id = (await pool.query<{ id: number }>(`INSERT INTO uc_users(email,password_hash,first_name)
      VALUES($1,'unused','Export') RETURNING id`, [email])).rows[0]!.id;
    users.push({ id, email, token: `Bearer ${issueToken({ id, email })}` });
    await pool.query(`INSERT INTO uc_reviews(product_id,user_id,author_name,rating,title,body)
      VALUES(1,$1,'Fixture',5,'Review',$2)`, [String(id), `${i}-${marker}`]);
  }
  await pool.query("INSERT INTO uc_notif_prefs(user_id,opt_out_orders) VALUES($1,true)", [String(users[0]!.id)]);
  await pool.query("INSERT INTO uc_push_tokens(user_id,push_token) VALUES($1,$2)", [String(users[0]!.id), `ExponentPushToken[${marker}]`]);
  ownOrderIds = (await pool.query<{ id: number }>(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method)
    SELECT $1,'completed','100','KES','cod' FROM generate_series(1,102) RETURNING id`, [String(users[0]!.id)])).rows.map(row => row.id);
  foreignOrderId = (await pool.query<{ id: number }>(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method)
    VALUES($1,'completed','999','KES','cod') RETURNING id`, [String(users[1]!.id)])).rows[0]!.id;
  await pool.query(`INSERT INTO uc_order_items(order_id,product_id,name,quantity,total)
    VALUES($1,1,'Export filter',1,'100')`, [ownOrderIds[101]]);
  process.env.WC_CONSUMER_KEY = "fixture";
  process.env.WC_CONSUMER_SECRET = "fixture";
  process.env.WC_BASE_URL = "https://retired-export.invalid";
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("retired-export.invalid")) {
      wooCalls++; throw new Error("Retired Woo history must not be queried");
    }
    return realFetch(input, init);
  };
  const { default: app } = await import("../app.js");
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/customer/data-export`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = realFetch;
  const ids = users.map(user => String(user.id));
  for (const table of ["uc_reviews", "uc_notif_prefs", "uc_push_tokens", "uc_orders"]) await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [ids]);
  await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [users.map(user => user.id)]);
  for (const key of ["WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET"]) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});
test("data export requires authentication", async () => {
  assert.equal((await realFetch(base)).status, 401);
});
test("downloadable export retains every category, preferences, reviews and push registrations", async () => {
  const response = await realFetch(base, { headers: { authorization: users[0]!.token } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="ultra-clear-data-export-/);
  const data = await response.json() as any;
  for (const key of ["profile", "orders", "tickets", "waterTests", "enquiries", "reviews", "notificationPreferences", "pushRegistrations", "referrals"]) assert.ok(key in data, key);
  assert.match(data.format, /v2/);
  assert.equal(data.profile.id, users[0]!.id);
  assert.equal(data.profile.email, users[0]!.email);
  for (const key of ["code", "referredCount", "conversions", "creditsEarnedKes", "usedReferralCode"]) assert.ok(key in data.referrals);
  assert.ok(data.reviews.some((review: any) => review.body === `0-${marker}`));
  assert.equal(data.notificationPreferences[0].optOutOrderUpdates, true);
  assert.equal(data.pushRegistrations[0].pushToken, `ExponentPushToken[${marker}]`);
});
test("all 102 local orders are exported, including line items, without cross-account history or retired requests", async () => {
  for (const configured of [true, false]) {
    if (!configured) { delete process.env.WC_CONSUMER_KEY; delete process.env.WC_CONSUMER_SECRET; }
    const response = await realFetch(base, { headers: { authorization: users[0]!.token } });
    assert.equal(response.status, 200);
    const text = await response.text(), data = JSON.parse(text);
    assert.equal(data.orders.length, 102);
    assert.deepEqual(new Set(data.orders.map((order: any) => order.id)), new Set(ownOrderIds));
    assert.ok(!data.orders.some((order: any) => order.id === foreignOrderId));
    assert.equal(data.orders.find((order: any) => order.id === ownOrderIds[101]).lineItems[0].name, "Export filter");
    assert.ok(!text.includes(users[1]!.email));
    assert.ok(!text.includes(`1-${marker}`));
  }
  assert.equal(wooCalls, 0);
});
