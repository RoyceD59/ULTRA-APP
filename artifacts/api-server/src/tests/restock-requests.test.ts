import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import router from "../routes/uc-restock-requests.js";
import { ensureRestockRequestSchema, purgeResolvedRestockContacts, restockKeys } from "../lib/restock-requests.js";
import { ensureProductEditorialSchema, effectiveEditorial } from "../lib/product-editorial.js";
import { ensureCompanionCatalogueSchema } from "../lib/companion-catalogue.js";
import { issueToken } from "../lib/jwt.js";

let server: http.Server, base: string, product: any, customerId: number;
const run = randomBytes(8).toString("hex");
const name = `Restock fixture ${run}`;
const teamId = `restock-team-${run}`;
let phoneSequence = 10;
const ids = new Set<number>();
const headers = { "content-type": "application/json" };
const token = (id: string | number, extra = {}) => `Bearer ${issueToken({
  id, email: `${run}@example.test`, exp: Math.floor(Date.now() / 1000) + 3600, ...extra,
})}`;
function input() {
  return {
    productKey: product.slug, ...(product.variants?.length ? { variantSku: product.variants[0].childSku } : {}),
    contact: { name, phone: `+120255501${phoneSequence++}`, location: "Test town" },
    idempotencyKey: `restock-${randomBytes(16).toString("hex")}`,
  };
}
async function submit(body: ReturnType<typeof input>, authorization?: string) {
  const result = await fetch(`${base}/uc/restock-requests`, { method: "POST",
    headers: { ...headers, ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000) });
  const rows = await pool.query("SELECT id FROM uc_restock_requests WHERE name=$1", [name]);
  rows.rows.forEach(row => ids.add(row.id));
  return result;
}
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/test_api_/, "Use the isolated test runner");
  await ensureProductEditorialSchema();
  await ensureCompanionCatalogueSchema();
  await ensureRestockRequestSchema();
  product = (await effectiveEditorial()).collection.products[0];
  assert.ok(product);
  customerId = (await pool.query(`INSERT INTO uc_users(email,password_hash,first_name)
    VALUES ($1,'not-a-real-password','Fixture') RETURNING id`, [`restock-${run}@example.test`])).rows[0].id;
  await pool.query(`INSERT INTO team_users(id,email,name,password_hash,role,is_active)
    VALUES($1,$2,'Restock fixture','not-a-real-password','admin',true)`, [teamId, `restock-admin-${run}@example.test`]);
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (ids.size) await pool.query("DELETE FROM uc_restock_requests WHERE id=ANY($1::int[])", [[...ids]]);
  if (customerId) {
    await pool.query("DELETE FROM uc_wishlist WHERE user_id=$1", [String(customerId)]);
    await pool.query("DELETE FROM uc_users WHERE id=$1", [customerId]);
  }
  await pool.query("DELETE FROM team_users WHERE id=$1", [teamId]);
});
test("guest contact is saved durably with canonical product identity, not an account or order", async () => {
  const body = input();
  const before = await pool.query("SELECT count(*)::int AS n FROM uc_orders");
  const response = await submit(body);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { saved: true, status: "pending" });
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  const row = (await pool.query("SELECT * FROM uc_restock_requests WHERE name=$1 AND phone=$2", [name, body.contact.phone])).rows[0];
  assert.equal(row.kind, "guest");
  assert.equal(row.customer_id, null);
  assert.equal(row.product_code, product.code);
  assert.equal(row.parent_sku, product.parentSku);
  assert.equal(row.variant_sku, body.variantSku ?? null);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM uc_orders")).rows[0].n, before.rows[0].n);
});
test("concurrent repeated submissions and fresh retry keys cannot inflate pending demand", async () => {
  const body = input();
  const results = await Promise.all(Array.from({ length: 6 }, () => submit(body)));
  assert.ok(results.every(result => result.status === 202));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM uc_restock_requests WHERE phone=$1", [body.contact.phone])).rows[0].n, 1);
  await submit({ ...body, idempotencyKey: `restock-${randomBytes(16).toString("hex")}`,
    contact: { ...body.contact, name: "Do not overwrite a previous prospect" } });
  assert.equal((await pool.query("SELECT name FROM uc_restock_requests WHERE phone=$1", [body.contact.phone])).rows[0].name, name);
});
test("more than a full pool of concurrent submissions completes within a bounded deadline", { timeout: 30_000 }, async () => {
  // A finite queue timeout lets a broken implementation fail and release its
  // clients instead of hanging the entire test runner/cleanup indefinitely.
  const options = (pool as unknown as { options: { max: number; connectionTimeoutMillis?: number } }).options;
  const previousTimeout = options.connectionTimeoutMillis;
  options.connectionTimeoutMillis = 10_000;
  try {
    const body = input();
    const requests = Math.max(10, options.max) + 4;
    const results = await Promise.all(Array.from({ length: requests }, () => submit(body)));
    assert.ok(results.every(response => response.status === 202), "all submissions must complete, not time out waiting for their own pool");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM uc_restock_requests WHERE phone=$1", [body.contact.phone])).rows[0].n, 1);
    assert.equal((await pool.query("SELECT 1 AS available")).rows[0].available, 1, "unrelated pool work must still make progress");
  } finally {
    options.connectionTimeoutMillis = previousTimeout;
  }
});
test("invalid contact, unpublished products and mismatched variants are rejected", async () => {
  const body = input();
  assert.equal((await submit({ ...body, contact: { ...body.contact, phone: "0712345678" } })).status, 400);
  assert.equal((await submit({ ...body, contact: { ...body.contact, location: " " } })).status, 400);
  assert.equal((await submit({ ...body, productKey: "not-published" })).status, 404);
  assert.equal((await submit({ ...body, variantSku: "wrong-product-option" })).status, 400);
});
test("bad, team, deleted and stale customer sessions never silently become guest prospects", async () => {
  const body = input();
  assert.equal((await submit(body, "Bearer invalid")).status, 401);
  assert.equal((await submit(body, token(teamId, { type: "team-session" }))).status, 401);
  assert.equal((await submit(body, token(customerId, { credentialVersion: 99 }))).status, 401);
  assert.equal((await submit(body, token(999999999))).status, 401);
});
test("registered requests link only to the authenticated account and keep wishlist compatibility", async () => {
  const body = input();
  assert.equal((await submit(body, token(customerId))).status, 202);
  const row = (await pool.query("SELECT * FROM uc_restock_requests WHERE phone=$1", [body.contact.phone])).rows[0];
  assert.equal(row.customer_id, customerId);
  assert.equal(row.kind, "customer");
  const wishlist = await pool.query("SELECT product_name FROM uc_wishlist WHERE user_id=$1", [String(customerId)]);
  assert.ok(wishlist.rows.some(row => row.product_name === product.name));
});
test("staff listing rejects anonymous/customers and includes exact request identity for live admins", async () => {
  assert.equal((await fetch(`${base}/uc/admin/restock-requests`)).status, 401);
  assert.equal((await fetch(`${base}/uc/admin/restock-requests`, { headers: { authorization: token(customerId) } })).status, 403);
  const admin = token(teamId, { type: "team-session", role: "admin" });
  const response = await fetch(`${base}/uc/admin/restock-requests`, { headers: { authorization: admin } });
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.ok(page.requests.some((row: any) => row.kind === "customer" && row.customerId === String(customerId)));
  assert.ok(page.demand.some((row: any) => row.productCode === product.code && row.waitingCount > 0));
  assert.equal(page.pageSize, 50);
  assert.ok(!JSON.stringify(page).includes("demandKey"));
  assert.equal((await fetch(`${base}/uc/admin/restock-requests?page=1.5`, { headers: { authorization: admin } })).status, 400);
  await pool.query("UPDATE team_users SET role='member' WHERE id=$1", [teamId]);
  assert.equal((await fetch(`${base}/uc/admin/restock-requests`, { headers: { authorization: admin } })).status, 403);
  await pool.query("UPDATE team_users SET role='admin' WHERE id=$1", [teamId]);
});
test("staff status changes resolve demand; old retry keys cannot reopen resolved requests", async () => {
  const body = input();
  await submit(body);
  const row = (await pool.query("SELECT id FROM uc_restock_requests WHERE phone=$1", [body.contact.phone])).rows[0];
  const admin = token(teamId, { type: "team-session", role: "admin" });
  const path = `${base}/uc/admin/restock-requests/${row.id}`;
  assert.equal((await fetch(path, { method: "PATCH", headers, body: JSON.stringify({ status: "resolved" }) })).status, 401);
  assert.equal((await fetch(path, { method: "PATCH", headers: { ...headers, authorization: admin }, body: JSON.stringify({ status: "resolved" }) })).status, 200);
  assert.equal((await submit(body)).status, 202);
  assert.equal((await pool.query("SELECT status FROM uc_restock_requests WHERE id=$1", [row.id])).rows[0].status, "resolved");
  assert.equal((await submit({ ...body, idempotencyKey: `restock-${randomBytes(16).toString("hex")}` })).status, 202);
  assert.equal((await fetch(path, { method: "PATCH", headers: { ...headers, authorization: admin }, body: JSON.stringify({ status: "pending" }) })).status, 409);
});
test("resolved guest contact expires while active demand is retained", async () => {
  const body = input();
  await submit(body);
  const row = (await pool.query("UPDATE uc_restock_requests SET status='resolved',resolved_at=now()-interval '181 days' WHERE phone=$1 RETURNING id", [body.contact.phone])).rows[0];
  await purgeResolvedRestockContacts();
  const expired = (await pool.query("SELECT name,phone,location,product_code,request_key FROM uc_restock_requests WHERE id=$1", [row.id])).rows[0];
  assert.equal(expired.name, null);
  assert.equal(expired.phone, null);
  assert.equal(expired.location, null);
  assert.equal(expired.product_code, product.code);
  assert.match(expired.request_key, /^expired:/);
  const admin = token(teamId, { type: "team-session", role: "admin" });
  assert.equal((await fetch(`${base}/uc/admin/restock-requests/${row.id}`, { method: "PATCH",
    headers: { ...headers, authorization: admin }, body: JSON.stringify({ status: "pending" }) })).status, 409);
});
test("soft account deletion erases contact snapshots and blocks further authenticated writes", async () => {
  await pool.query("UPDATE uc_users SET deleted_at=now() WHERE id=$1", [customerId]);
  const rows = await pool.query("SELECT * FROM uc_restock_requests WHERE id=ANY($1::int[]) AND kind='customer'", [[...ids]]);
  assert.ok(rows.rowCount);
  for (const row of rows.rows) {
    assert.equal(row.customer_id, null);
    assert.equal(row.name, null);
    assert.equal(row.status, "resolved");
    assert.match(row.request_key, /^erased:/);
  }
  assert.equal((await submit(input(), token(customerId))).status, 401);
});
test("deduplication separates authenticated ownership, guest phones and exact variants", () => {
  assert.notEqual(restockKeys("customer:1", "P", "A", "retry").demandKey, restockKeys("customer:2", "P", "A", "retry").demandKey);
  assert.notEqual(restockKeys("guest:+12025550101", "P", "A", "retry").demandKey, restockKeys("customer:1", "P", "A", "retry").demandKey);
  assert.notEqual(restockKeys("customer:1", "P", "A", "retry").demandKey, restockKeys("customer:1", "P", "B", "retry").demandKey);
});
