import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { validateCustomerContact } from "@workspace/api-zod/customer-contact";
import { activationEligibility, validInstallationDate } from "../lib/activation-eligibility.js";
import { activationPurchaseOptions } from "../lib/activation-purchases.js";
import { registerOrderUnit } from "../lib/register-order-unit.js";
import { checkoutDiagnostics } from "../lib/checkout-diagnostics.js";
import { orderEvidence } from "../lib/order-evidence.js";
import { prepareCheckoutOrder } from "../lib/checkout-orders.js";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

const realFetch = globalThis.fetch;
let server: http.Server, base: string, owner: number, other: number, token: string, otherToken: string, adminToken: string;
let accepted: number, unresolved: number, lineId: number, providerCalls = 0;
let guestOrder: number | undefined;
let productId: number;
const phones = ["+254711893421", "+254711893422"];
before(async () => {
  productId = (await appCatalogueFixture()).id;
  process.env.SESSION_SECRET ??= "isolated-checkout-activation-test";
  for (const key of ["WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET", "PAYSTACK_SECRET_KEY", "STRIPE_SECRET_KEY",
    "MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_SHORTCODE"]) delete process.env[key];
  globalThis.fetch = async (url) => {
    if (/paystack|safaricom|stripe|woocommerce/i.test(String(url))) providerCalls++;
    throw new Error("No provider access permitted in this suite");
  };
  for (let i = 0; i < 2; i++) {
    const row = (await pool.query(`INSERT INTO uc_users(email,password_hash,first_name,last_name,phone,address,is_admin)
      VALUES($1,'fixture-only','Fixture','Customer',$2,'Test building, Nairobi',$3) RETURNING id`,
      [`activation-${randomUUID()}@example.test`, phones[i], i === 0])).rows[0];
    if (i === 0) owner = row.id; else other = row.id;
  }
  token = issueToken({ id: owner, email: "fixture@example.test", firstName: "Fixture" });
  adminToken = token;
  otherToken = issueToken({ id: other, email: "other@example.test", firstName: "Other" });
  accepted = (await pool.query(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method,checkout_state,shipping_address)
    VALUES($1,'pending','2800','KES','cod','confirmed',$2) RETURNING id`, [String(owner), JSON.stringify({
      firstName: "Fixture", address1: "Test collection contact", phone: phones[0], country: "KE", fulfillment: "collection",
    })])).rows[0].id;
  unresolved = (await pool.query(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method,checkout_state,shipping_address)
    VALUES($1,'pending','1400','KES','paystack','remote_unknown',$2) RETURNING id`, [String(owner), JSON.stringify({
      firstName: "Fixture", address1: "Test delivery", phone: phones[0], country: "KE", fulfillment: "delivery",
    })])).rows[0].id;
  lineId = (await pool.query("INSERT INTO uc_order_items(order_id,product_id,name,quantity,total) VALUES($1,91001,'Fixture filter',2,'2800') RETURNING id", [accepted])).rows[0].id;
  await pool.query("INSERT INTO uc_order_items(order_id,product_id,name,quantity,total) VALUES($1,91002,'Untrackable product',1,'1400')", [unresolved]);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.query("DELETE FROM uc_registered_filters WHERE user_id=ANY($1::int[])", [[owner, other]]);
  const orders = [accepted, unresolved, ...(guestOrder ? [guestOrder] : [])];
  await pool.query("DELETE FROM uc_order_items WHERE order_id=ANY($1::int[])", [orders]);
  await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [orders]);
  await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [[owner, other]]);
  await pool.end();
});
async function request(path: string, method = "GET", data?: unknown, auth = token) {
  const res = await realFetch(`${base}${path}`, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  return { status: res.status, body: await res.json() as any };
}

test("contact validation rejects blanks/malformed fields and normalizes international phones", () => {
  for (const address of ["", "  ", null, 12]) assert.equal(validateCustomerContact({ phone: phones[0], address }).ok, false);
  for (const phone of ["", "invalid", null, 12]) assert.equal(validateCustomerContact({ phone, address: "Nairobi" }).ok, false);
  assert.equal(validateCustomerContact({ phone: "0711893421", country: "KE", address: " Nairobi " }).phone, phones[0]);
});
test("required registration/profile fields fail with actionable errors but legacy reads remain available", async () => {
  const bad = await request("/uc/auth/register", "POST", { email: "new@example.test", phone: phones[0], password: "fixture-password", firstName: "Fixture", address: "  " });
  assert.equal(bad.status, 400); assert.ok(bad.body.fields.address);
  assert.equal((await request("/uc/customer/profile", "PATCH", { address: "  " })).status, 400);
  assert.equal((await request("/uc/customer/profile", "PATCH", { phone: "" })).status, 400);
  await pool.query("UPDATE uc_users SET address='' WHERE id=$1", [other]);
  assert.equal((await request("/uc/orders", "GET", undefined, otherToken)).status, 200);
  assert.equal((await request("/uc/tickets", "POST", { productModel: "Filter", issueDescription: "Needs service" }, otherToken)).status, 422);
  assert.equal((await request("/uc/customer/profile", "PATCH", { phone: phones[1], address: "Completed address" }, otherToken)).status, 200);
  assert.equal((await pool.query("SELECT address FROM uc_users WHERE id=$1", [other])).rows[0].address, "Completed address");
});
test("every payment method rejects missing contact before any provider/persistence operation", async () => {
  const beforeCount = providerCalls;
  for (const method of ["cod", "free", "paystack", "mpesa", "stripe"]) {
    await assert.rejects(prepareCheckoutOrder({ idempotencyKey: randomUUID(), fulfillment: "collection", lineItems: [{ productId: 91001, quantity: 1 }],
      shippingAddress: { firstName: "Fixture", phone: phones[0], country: "KE", address1: " " } }, String(owner), method), /address/);
  }
  for (const path of ["/payments/paystack/init", "/payments/mpesa", "/payments/stripe/session"]) {
    const res = await request(path, "POST", { amount: 1000 });
    assert.equal(res.status, 422); assert.equal(res.body.retryable, false);
  }
  assert.equal(providerCalls, beforeCount);
});
test("accepted and reconciliation orders are listed once with honest payment and contact evidence", async () => {
  const history = await request("/uc/orders");
  assert.equal(history.status, 200);
  assert.equal(history.body.filter((o: any) => o.id === accepted).length, 1);
  const pending = history.body.find((o: any) => o.id === unresolved);
  assert.equal(pending.synchronizationStatus, "reconciliation_required");
  assert.notEqual(pending.paymentStatus, "paid");
  const admin = await request("/uc/admin/orders", "GET", undefined, adminToken);
  assert.equal(admin.status, 200);
  const order = admin.body.find((o: any) => o.id === accepted);
  assert.equal(order.shippingAddress.address1, "Test collection contact");
  assert.equal(order.fulfillment, "collection"); assert.equal(order.paymentStatus, "awaiting_collection");
  assert.equal(orderEvidence({ status: "processing", paymentMethod: "paystack" }).paymentStatus, "unverified");
});
test("eligibility uses acceptance/payment evidence, not status alone", () => {
  for (const status of ["failed", "cancelled", "refunded", "pending-wc"])
    assert.equal(activationEligibility({ status, paymentMethod: "paystack", paymentConfirmedAt: new Date() }, "app").eligible, false);
  assert.equal(activationEligibility({ status: "processing", paymentMethod: "paystack" }, "app").eligible, false);
  assert.equal(activationEligibility({ status: "on-hold", paymentMethod: "paystack", paymentConfirmedAt: new Date() }, "app").eligible, true);
  assert.equal(activationEligibility({ status: "pending", paymentMethod: "cod", checkoutState: "confirmed" }, "app").eligible, true);
  assert.equal(activationEligibility({ status: "processing", paymentMethod: "paystack", checkoutState: "remote_unknown", paymentConfirmedAt: new Date() }, "app").eligible, false);
  assert.equal(validInstallationDate("2026-02-30"), false);
});

test("detail fetch and reload preserve reconciliation and COD evidence, independently of fulfillment", async () => {
  await pool.query("UPDATE uc_orders SET status='processing', customer_stage='processing' WHERE id=$1", [accepted]);
  for (let reload = 0; reload < 2; reload++) {
    const review = await request(`/uc/orders/${unresolved}`);
    assert.equal(review.status, 200);
    assert.equal(review.body.checkoutState, "remote_unknown");
    assert.equal(review.body.synchronizationStatus, "reconciliation_required");
    assert.equal(review.body.paymentStatus, "unverified");
    const cod = await request(`/uc/orders/${accepted}`);
    assert.equal(cod.status, 200);
    assert.equal(cod.body.fulfillmentStatus, "processing");
    assert.equal(cod.body.fulfillment, "collection");
    assert.equal(cod.body.paymentStatus, "awaiting_collection");
  }
  await pool.query("UPDATE uc_orders SET status='pending', customer_stage=NULL WHERE id=$1", [accepted]);
});

test("guest confirmation accepts required contact and retries the same financial order without an account", async () => {
  const idempotencyKey = randomUUID();
  const payload = { idempotencyKey, fulfillment: "collection", paymentMethod: "cod",
    paymentReference: `cod_${idempotencyKey}`, lineItems: [{ productId, quantity: 1 }],
    shippingAddress: { firstName: "Avery", lastName: "Fixture", address1: "Guest contact building, Nairobi",
      phone: "+254712345678", country: "KE" } };
  const first = await request("/uc/orders", "POST", payload, "");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  guestOrder = first.body.id;
  const retry = await request("/uc/orders", "POST", payload, "");
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.id, guestOrder);
  const persisted = await pool.query("SELECT * FROM uc_orders WHERE checkout_idempotency_key=$1", [idempotencyKey]);
  assert.equal(persisted.rows.length, 1);
  assert.equal(persisted.rows[0].shipping_address.phone, "+254712345678");
  assert.equal(persisted.rows[0].shipping_address.address1, payload.shippingAddress.address1);
  assert.equal(persisted.rows[0].payment_confirmed_at, null);
});

test("server recovery retains review until explicit confirmation and scopes resolution to its owner", async () => {
  const key = randomUUID();
  await pool.query("UPDATE uc_orders SET checkout_idempotency_key=$2 WHERE id=$1", [unresolved, key]);
  const path = `/uc/checkout/recovery?idempotencyKey=${key}`;
  assert.equal((await request(path)).body.resolution, "unresolved");
  assert.equal((await request(path, "GET", undefined, otherToken)).body.orderId, null);
  assert.equal((await request("/uc/checkout/cancel", "POST", {idempotencyKey:key})).status, 409);
  await pool.query("UPDATE uc_orders SET checkout_state='confirmed',payment_confirmed_at=now() WHERE id=$1", [unresolved]);
  assert.equal((await request(path)).body.resolution, "completed");
  await pool.query("UPDATE uc_orders SET checkout_state='remote_unknown',payment_confirmed_at=NULL WHERE id=$1", [unresolved]);
});

test("invalid signed sessions cannot become guest checkout, payment, or retirement attempts", async () => {
  const key = randomUUID();
  const input = {idempotencyKey:key,fulfillment:"collection",lineItems:[{productId,quantity:1}],
    shippingAddress:{firstName:"Amina",lastName:"Otieno",address1:"Test building",phone:phones[0],country:"KE"}};
  assert.equal((await request("/uc/orders","POST",{...input,paymentMethod:"cod"},"invalid-session")).status,401);
  assert.equal((await request("/payments/paystack/init","POST",{email:"fixture@test.invalid",checkout:input},"invalid-session")).status,401);
  assert.equal((await request("/uc/checkout/cancel","POST",{idempotencyKey:key},"invalid-session")).status,401);
  const rows = await pool.query("SELECT id FROM uc_orders WHERE checkout_idempotency_key=$1",[key]);
  assert.equal(rows.rowCount,0);
});

test("no-attempt cancellation is durable and rejects a delayed old request while a corrected new intent succeeds", async () => {
  const key = randomUUID();
  assert.equal((await request("/uc/checkout/cancel", "POST", {idempotencyKey:key})).status, 200);
  const input = { idempotencyKey:key, fulfillment:"collection" as const,
    lineItems:[{productId,quantity:1}], shippingAddress:{firstName:"Avery",lastName:"Fixture",
      address1:"Corrected contact building",phone:phones[0],country:"KE"} };
  await assert.rejects(prepareCheckoutOrder(input,String(owner),"cod"), /retired/);
  const corrected = await prepareCheckoutOrder({...input,idempotencyKey:randomUUID()},String(owner),"cod");
  assert.equal(corrected.checkout_state, "payment_pending");
  await pool.query("DELETE FROM uc_order_items WHERE order_id=$1", [corrected.id]);
  await pool.query("DELETE FROM uc_orders WHERE id=$1", [corrected.id]);
});
test("units remain selectable; concurrent same-unit activation is idempotent and preserves maintenance", async () => {
  const catalogue = { lifespans: new Map([[91001, 90]]), capacities: new Map([[91001, 150]]) };
  const options = await activationPurchaseOptions(owner, "fixture@example.test", catalogue, { enabled: false, fetch: async () => [] });
  const line = options.purchases.find(p => p.orderId === accepted)!.items[0];
  assert.equal(line.availableUnitIds.length, 2);
  assert.ok(options.purchases.find(p => p.orderId === unresolved)!.items[0].unavailableReason);
  const input = { accountId: owner, source: "app" as const, orderId: accepted, productId: 91001, lineId,
    unitId: line.availableUnitIds[0], productName: line.name, capacityLitres: 150, activatedAt: new Date("2026-09-01") };
  const results = await Promise.all([registerOrderUnit(input), registerOrderUnit(input)]);
  assert.equal(results[0].registration.id, results[1].registration.id);
  await pool.query("UPDATE uc_registered_filters SET maintenance_count=2 WHERE id=$1", [results[0].registration.id]);
  await registerOrderUnit({ ...input, unitId: line.availableUnitIds[1] });
  assert.equal((await pool.query("SELECT maintenance_count FROM uc_registered_filters WHERE id=$1", [results[0].registration.id])).rows[0].maintenance_count, 2);
  await assert.rejects(registerOrderUnit({ ...input, activatedAt: new Date("2026-09-02") }), /original installation/);
  await assert.rejects(registerOrderUnit({ ...input, accountId: other }), /acceptance changed/);
  assert.equal((await activationPurchaseOptions(other, "other@example.test", catalogue, { enabled: false, fetch: async () => [] })).purchases.length, 0);
});
test("scoped reconciliation diagnostics cannot mutate orders or call providers", async () => {
  const count = providerCalls;
  const before = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [unresolved])).rows[0];
  const report = await checkoutDiagnostics(pool, [accepted, unresolved]);
  assert.equal(report.readOnly, true); assert.equal(report.orders.length, 2);
  assert.deepEqual((await pool.query("SELECT * FROM uc_orders WHERE id=$1", [unresolved])).rows[0], before);
  assert.equal(providerCalls, count);
  assert.equal((await request(`/uc/admin/orders/reconciliation-report?ids=${unresolved}`, "GET", undefined, otherToken)).status, 403);
});
test("service and physical test APIs reject blank or invalid transaction contact", async () => {
  const service = await request("/uc/tickets", "POST", { productModel: "Filter", issueDescription: "Test fixture",
    contactDetails: { phone: phones[0], address: " " } });
  assert.equal(service.status, 400); assert.ok(service.body.fields.address);
  const physical = await request("/uc/water-tests", "POST", { name: "Fixture", phone: "invalid",
    address: "Test building", waterSource: "tap" });
  assert.equal(physical.status, 400); assert.ok(physical.body.fields.phone);
});
test("live refund of a mirrored purchase removes activation offers without mutating ownership", async () => {
  await pool.query("UPDATE uc_orders SET wc_order_id=993321 WHERE id=$1", [accepted]);
  const catalogue = { lifespans: new Map([[91001, 90]]), capacities: new Map([[91001, 150]]) };
  const result = await activationPurchaseOptions(owner, "fixture@example.test", catalogue, { enabled: true,
    fetch: async params => params.include ? [{ id: 993321, status: "refunded" }] : [] });
  const item = result.purchases.find(p => p.orderId === accepted)!.items[0];
  assert.equal(item.availableUnitIds.length, 0); assert.match(item.unavailableReason!, /refunded/);
  assert.equal((await pool.query("SELECT user_id FROM uc_orders WHERE id=$1", [accepted])).rows[0].user_id, String(owner));
});

test("store read failures retain independent app units but never infer mirrored eligibility", async () => {
  const independent = (await pool.query(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method,checkout_state,shipping_address)
    VALUES($1,'pending','100','KES','cod','confirmed','{}') RETURNING id`, [String(owner)])).rows[0].id;
  await pool.query("INSERT INTO uc_order_items(order_id,product_id,name,quantity,total) VALUES($1,91001,'Independent filter',2,'100')", [independent]);
  const options = await activationPurchaseOptions(owner, "fixture@example.test",
    { lifespans: new Map([[91001, 90]]), capacities: new Map([[91001, 150]]) },
    { enabled: true, fetch: async () => null });
  assert.match(options.sourceErrors.store!, /unavailable/i);
  const standalone = options.purchases.find(p => p.source === "app" && p.orderId === independent);
  assert.ok(standalone, "owned app purchase is retained");
  assert.equal(standalone.items[0].availableUnitIds.length, 2);
  const mirror = options.purchases.find(p => p.source === "app" && p.orderId === accepted)!;
  assert.ok(mirror.items.every(i => i.availableUnitIds.length === 0));
  assert.ok(mirror.items.every(i => /Store confirmation unavailable/.test(i.unavailableReason ?? '')));
  assert.equal(options.purchases.filter(p => p.source === "store").length, 0);
});