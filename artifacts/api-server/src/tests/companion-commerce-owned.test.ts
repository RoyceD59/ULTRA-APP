import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { ensureProductEditorialSchema, effectiveEditorial } from "../lib/product-editorial.js";
import { ensureCompanionCatalogueSchema, companionCatalogue, updateCompanionInventory,
  reserveCompanionInventory, settleCompanionInventory } from "../lib/companion-catalogue.js";
import { ensureCompanionHistorySchema, importCompanionHistory, reviewedImportPayment } from "../lib/companion-history-import.js";
import { issueToken } from "../lib/jwt.js";

let server: http.Server, base: string, token: string, parent: any, child: any;
let originalEditorial: any, originalInventory: any[], teamId: string;
const realFetch = globalThis.fetch;
let outbound = 0;
before(async () => {
  process.env.SESSION_SECRET = "isolated-commerce-test-secret";
  process.env.WC_CONSUMER_KEY = "fixture";
  process.env.WC_CONSUMER_SECRET = "fixture";
  await ensureProductEditorialSchema();
  await ensureCompanionCatalogueSchema();
  await ensureCompanionHistorySchema();
  const catalogue = await companionCatalogue(true);
  parent = catalogue.find(p => !p.parent_id && p.code === "HDF") ?? catalogue.find(p => !p.parent_id);
  child = catalogue.find(p => p.parent_id === parent.id);
  originalEditorial = (await pool.query("SELECT * FROM uc_product_editorial WHERE code=$1", [parent.code])).rows[0];
  originalInventory = (await pool.query("SELECT * FROM uc_catalogue_inventory WHERE code=$1", [parent.code])).rows;
  const id = randomUUID();
  teamId = id;
  await pool.query(`INSERT INTO team_users(id,email,name,password_hash,role,is_active)
    VALUES($1,'owned-catalogue-fixture@example.invalid','Test operator','unused','admin',true)`, [id]);
  token = issueToken({ id, type: "team-session", role: "admin" });
  const management = (await import("../routes/companion-commerce-management.js")).default;
  const records = (await import("../routes/uc-product-records.js")).default;
  const uc = (await import("../routes/uc.js")).default;
  const app = express();
  app.use(express.json(), management, records, uc);
  server = app.listen(0);
  await new Promise<void>(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (!url.startsWith(base)) { outbound++; throw new Error("External calls forbidden in this fixture"); }
    return realFetch(input, init);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>(r => server.close(() => r()));
  await pool.query("DELETE FROM uc_inventory_reservations WHERE order_id=ANY($1::int[])", [[9123001, 9123002]]);
  await pool.query("UPDATE uc_product_editorial SET record=$2,revision=$3,gallery_mapped=$4 WHERE code=$1",
    [parent.code, originalEditorial.record, originalEditorial.revision, originalEditorial.gallery_mapped]);
  for (const row of originalInventory) await pool.query(`UPDATE uc_catalogue_inventory
    SET stock_status=$2,stock_quantity=$3,manage_stock=$4,archived=$5,revision=$6,metadata=$7 WHERE id=$1`,
    [row.id,row.stock_status,row.stock_quantity,row.manage_stock,row.archived,row.revision,row.metadata]);
  await pool.query("DELETE FROM uc_inventory_reservations WHERE inventory_id IN (SELECT id FROM uc_catalogue_inventory WHERE code='FIXTURE')");
  await pool.query("DELETE FROM uc_catalogue_inventory WHERE code='FIXTURE'");
  await pool.query("DELETE FROM uc_product_editorial WHERE code='FIXTURE'");
  await pool.query("DELETE FROM team_users WHERE id=$1", [teamId]);
  await pool.query("DELETE FROM uc_legacy_order_imports WHERE woo_order_id=981234");
  await pool.end();
});
function request(path: string, method = "GET", body?: any, admin = false) {
  return realFetch(`${base}${path}`, { method, headers: {
    "Content-Type": "application/json", ...(admin ? { Authorization: `Bearer ${token}` } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test("configured external credentials cannot reactivate catalogue, login, webhooks or legacy checkout", async () => {
  assert.equal(parent.stock_status, "unknown");
  assert.ok(parent.id >= 1_000_000 && child.id !== parent.id);
  assert.equal((await request("/uc/admin/products")).status, 403);
  assert.equal((await request("/uc/admin/products", "GET", undefined, true)).status, 200);
  assert.equal((await request("/uc/auth/login", "POST", { email: "unknown@example.invalid", password: "not-an-account" })).status, 401);
  assert.equal((await request("/uc/webhooks/woocommerce", "POST", {})).status, 410);
  assert.equal((await request("/uc/orders", "POST", { lineItems: [{ productId: parent.id, quantity: 1 }] })).status, 409);
  assert.equal(outbound, 0);
});
test("unknown inventory rejects admission; holds prevent overselling and settle once", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(reserveCompanionInventory(client, 9123001, [{ productId: parent.id, variationId: child.id, quantity: 1 }]));
    await client.query("ROLLBACK");
    await updateCompanionInventory(child.id, { stock_quantity: 2, stock_status: "instock" }, "fixture");
    await client.query("BEGIN");
    await reserveCompanionInventory(client, 9123001, [{ productId: parent.id, variationId: child.id, quantity: 2 }]);
    await client.query("COMMIT");
    await client.query("BEGIN");
    await assert.rejects(reserveCompanionInventory(client, 9123002, [{ productId: parent.id, variationId: child.id, quantity: 1 }]));
    await client.query("ROLLBACK");
    await assert.rejects(updateCompanionInventory(child.id, { stock_quantity: 1, stock_status: "instock" }, "fixture"));
    await client.query("BEGIN");
    await settleCompanionInventory(client, { id: 9123001, payment_method: "cod" }, "completed");
    await settleCompanionInventory(client, { id: 9123001, payment_method: "cod" }, "completed");
    await client.query("COMMIT");
    assert.equal((await pool.query("SELECT stock_quantity FROM uc_catalogue_inventory WHERE id=$1", [child.id])).rows[0].stock_quantity, 0);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
test("admin price edits persist across initialization and null stock stays distinct from zero", async () => {
  const edited = await request(`/uc/admin/products/${parent.id}`, "PATCH", { regularPrice: "9.99", stockQuantity: null, stockStatus: "instock" }, true);
  assert.equal(edited.status, 200, await edited.text());
  await ensureProductEditorialSchema(); await ensureCompanionCatalogueSchema();
  const updated = (await companionCatalogue(true)).find(p => p.id === parent.id)!;
  assert.equal(updated.price, "9.99");
  assert.equal(updated.stock_quantity, null);
});
test("historical snapshot preview is read-only and absent ownership never creates a customer order", async () => {
  const bundle = { version: 1 as const, sourceReviewed: true as const, reviewedBy: "fixture", owners: [],
    orders: [{ id: 981234, customer_id: 555, total: "99.00", currency: "KES",
      payment_method: "cod", status: "completed", date_created_gmt: "2026-01-01T00:00:00",
      line_items: [{ product_id: 9591, quantity: 1, name: "Preserved historical item", total: "99.00" }] }] };
  const before = (await pool.query("SELECT COUNT(*) AS n FROM uc_orders")).rows[0].n;
  assert.equal(reviewedImportPayment(bundle, { ...bundle.orders[0], date_paid_gmt: "2026-01-02T00:00:00" }), null);
  const preview = await importCompanionHistory(bundle);
  assert.equal(preview.unresolved, 1);
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM uc_legacy_order_imports")).rows[0].n, "0");
  await importCompanionHistory(bundle, true);
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM uc_orders")).rows[0].n, before);
  assert.equal((await pool.query("SELECT state FROM uc_legacy_order_imports WHERE woo_order_id=981234")).rows[0].state, "pending_review");
});
test("draft creation, archive and retained stable identity are functional", async () => {
  const { input } = await effectiveEditorial();
  const record = structuredClone(input.products[0]);
  record.code = "FIXTURE"; record.slug = "fixture-owned"; record.name = "Fixture product";
  record.parent_sku = "FIXTURE-PARENT"; record.publishable = false; record.purchasable = false;
  record.variants = record.variants.map((v: any, i: number) => ({ ...v, child_sku: `FIXTURE-CHILD-${i}` }));
  record.images = record.images.map((i: any, n: number) => ({
    ...i, file: `images/FIXTURE-PARENT_${String(n + 1).padStart(2, "0")}.jpg`, approved: false,
  }));
  const created = await request("/uc/admin/product-records", "POST", { record }, true);
  assert.equal(created.status, 201, await created.text());
  const id = (await companionCatalogue(true)).find(p => p.code === "FIXTURE" && !p.parent_id)!.id;
  assert.equal((await request(`/uc/products/${id}`)).status, 404);
  assert.equal((await request("/uc/admin/product-records/FIXTURE", "DELETE", undefined, true)).status, 200);
  await ensureCompanionCatalogueSchema();
  assert.equal((await pool.query("SELECT archived FROM uc_catalogue_inventory WHERE id=$1", [id])).rows[0].archived, true);
  assert.equal((await companionCatalogue(true)).find(p => p.code === "FIXTURE" && !p.parent_id)!.id, id);
});
