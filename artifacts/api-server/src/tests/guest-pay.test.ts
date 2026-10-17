import { before, after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID, createHmac } from "node:crypto";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { hashPayToken, payLinkState, guestPaySummary, revalidatePayOrder, GUEST_PAY_DDL } from "../lib/guest-pay.js";
import { recoverSnapshotCheckout, setStripeForGuestPayTests } from "../routes/payments.js";
import { prepareCheckoutOrder } from "../lib/checkout-orders.js";
import Stripe from "stripe";
import { createRequire } from "node:module";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";
import { invalidateCatalogueCache } from "../routes/uc.js";

const { createGuestPayDelivery } = createRequire(import.meta.url)("../../../uc-companion/server/guest-pay-delivery.cjs");

const realFetch = globalThis.fetch;
describe("saved-order scoped guest payment capability", () => {
  let server: http.Server, base: string, buyer: number, other: number, auth: string, otherAuth: string;
  let price = 300, stock = true, calls = 0, timeOut = false, window = 0;
  let latestAmount = 0, remoteCalls = 0;
  let bottle: Awaited<ReturnType<typeof appCatalogueFixture>>, variable: Awaited<ReturnType<typeof appCatalogueFixture>>;
  let mpesaCalls = 0, mpesaCallback = "", mpesaTimeout = false;
  const prefix = `guest-pay-${randomUUID()}`;
  const address = { firstName: "Amina", lastName: "PrivateSurname", country: "KE",
    phone: "+254712345678", address1: "PrivateFlat77", city: "Nairobi" };
  const input = (key = randomUUID(), variant = false) => ({
    lineItems: variant ? [{ productId: variable.id, variationId: variable.childId, childSku: variable.childSku, quantity: 1 }]
      : [{ productId: bottle.id, quantity: 1 }],
    fulfillment: "delivery", shippingAddress: address, idempotencyKey: key,
  });
  async function api(path: string, body: unknown, token?: string, headers = {}) {
    window++; // Independent requests have separate test-only limiter budgets.
    const response = await realFetch(base + path, { method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${window}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any, headers: response.headers };
  }
  async function save(checkout = input(), method = "paystack") {
    const response = await api("/uc/orders/pay-link", { checkout, method }, auth);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return { ...response.body, checkout };
  }
  before(async () => {
    bottle = await appCatalogueFixture(300);
    variable = await appCatalogueFixture(4399, true);
    app.set("trust proxy", "loopback");
    for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_SHORTCODE", "STRIPE_SECRET_KEY"]) delete process.env[key];
    process.env.SESSION_SECRET ??= "guest-fixture-only";
    process.env.UC_GUEST_PAY_PUBLIC_ORIGIN = "https://guest-pay.test";
    process.env.PAYSTACK_SECRET_KEY = "guest-pay-fixture";
    process.env.WC_BASE_URL = "https://guest-shop.test";
    process.env.WC_CONSUMER_KEY = "fixture"; process.env.WC_CONSUMER_SECRET = "fixture";
    const users = await pool.query(`INSERT INTO uc_users(email,password_hash,first_name,last_name,phone,address)
      VALUES($1,'unused','Amina','PrivateSurname','+254712345678','PrivateFlat77'),
      ($2,'unused','Other','Buyer','+254712345679','Other private flat') RETURNING id,email`,
      [`${prefix}@test.invalid`, `${prefix}-other@test.invalid`]);
    buyer = users.rows[0].id; other = users.rows[1].id;
    auth = issueToken({ id: buyer, email: users.rows[0].email, firstName: "Amina", lastName: "PrivateSurname" });
    otherAuth = issueToken({ id: other, email: users.rows[1].email, firstName: "Other", lastName: "Buyer" });
    await pool.query(GUEST_PAY_DDL); // Both startup DDL and fresh schema must coexist.
    globalThis.fetch = async (target: any, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("safaricom.co.ke/oauth")) return new Response('{"access_token":"fixture"}');
      if (url.includes("safaricom.co.ke/mpesa/stkpush/v1/processrequest")) {
        mpesaCalls++; mpesaCallback = JSON.parse(String(init?.body)).CallBackURL;
        if (mpesaTimeout) throw new Error("Accepted STK; lost response");
        return new Response('{"CheckoutRequestID":"STK_GUEST_FIXTURE","ResponseCode":"0"}');
      }
      if (url.includes("safaricom.co.ke/mpesa/stkpushquery")) return new Response('{"ResultCode":"0"}');
      if (url.includes("guest-shop.test") && url.includes("/variations/7101")) return new Response(JSON.stringify({
        id: 7101, parent_id: 10001, sku: "UC-BOG-SSB-008-BL", status: "publish", purchasable: true, price: "4399", stock_status: stock ? "instock" : "outofstock",
      }));
      if (url.includes("guest-shop.test") && url.includes("/variations")) return new Response(JSON.stringify([
        { id: 7101, sku: "UC-BOG-SSB-008-BL", status: "publish" },
      ]));
      if (url.includes("guest-shop.test") && url.includes("/products")) return new Response(JSON.stringify([
        { id: 10001, sku: "UC-BOG-SSB-008", name: "Hydra Flux", type: "variable", price: "4399", status: "publish", stock_status: "instock" },
        { id: 10002, sku: "FIXTURE-BOTTLE", name: "Fixture bottle", price: String(price), status: "publish", stock_status: stock ? "instock" : "outofstock" },
      ]));
      if (url.includes("guest-shop.test") && url.includes("/orders")) {
        if (init?.method === "POST") {
          remoteCalls++;
          const body = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ ...body, id: 900000 + remoteCalls, total: String(latestAmount / 100), currency: "KES", status: "processing" }));
        }
        return new Response("[]");
      }
      if (url.includes("api.paystack.co/transaction/initialize")) {
        calls++; const body = JSON.parse(String(init?.body)); latestAmount = body.amount;
        if (timeOut) throw new Error("Remote outcome unknown");
        return new Response(JSON.stringify({ status: true, data: { reference: body.reference,
          authorization_url: "https://checkout.paystack.com/fixture", access_code: "fixture" } }));
      }
      if (url.includes("api.paystack.co/transaction/verify/")) return new Response(JSON.stringify({
        status: true, data: { status: "pending", amount: latestAmount, currency: "KES" },
      }));
      // No live connector/provider/notification traffic in this suite.
      return new Response(JSON.stringify({ data: [], success: false }));
    };
    server = http.createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  beforeEach(async () => {
    window++; price = 300; stock = true; calls = 0; timeOut = false;
    await pool.query(`UPDATE uc_product_editorial SET record=jsonb_set(
      jsonb_set(record,'{price_kes}','300'::jsonb),'{ownership,product_price_kes}','300'::jsonb)
      WHERE code=$1`, [bottle.code]);
    await pool.query("UPDATE uc_catalogue_inventory SET stock_status='instock' WHERE id=$1", [variable.childId]);
    invalidateCatalogueCache();
  });
  after(async () => {
    setStripeForGuestPayTests(null);
    globalThis.fetch = realFetch;
    await new Promise<void>(r => server.close(() => r()));
    await pool.query("DELETE FROM uc_orders WHERE user_id=ANY($1::text[])", [[String(buyer), String(other)]]);
    await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [[buyer, other]]);
    await pool.query("DELETE FROM mpesa_stk_initiations WHERE checkout_request_id IN ('STK_GUEST_FIXTURE','STK_INTERRUPTED_GUEST')");
    for (const key of ["UC_GUEST_PAY_PUBLIC_ORIGIN", "PAYSTACK_SECRET_KEY", "WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET",
      "MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY","MPESA_SHORTCODE","STRIPE_SECRET_KEY"]) delete process.env[key];
  });
  it("real proxy/API isolates multiple payer budgets, polling, initiation and invalid-link abuse without forwarded IPs", async () => {
    const first = await save(), second = await save();
    const delivery = createGuestPayDelivery({ apiOrigin: new URL(base).origin, fetchImpl: realFetch });
    const proxy = http.createServer((req, res) => {
      delivery(req, res, new URL(req.url!, "http://proxy.invalid").pathname).then((handled: boolean) => {
        if (!handled) { res.writeHead(404); res.end(); }
      }).catch(() => { res.writeHead(503); res.end(); });
    });
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(proxy.address() as import("node:net").AddressInfo).port}`;
    const throughProxy = async (path: string, token: string, extra: object = {}) => {
      const response = await realFetch(origin + "/guest-pay/" + path, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...extra }),
      });
      return { status: response.status, body: await response.json() as any };
    };
    try {
      // Two payers share exactly the same TCP peer/proxy, with no synthetic
      // forwarded IP headers. Forty summary/poll requests exceed the old global
      // five-request budget without exhausting either capability.
      for (let poll = 0; poll < 20; poll++) {
        const results = await Promise.all([first, second].map(link =>
          throughProxy(poll % 2 ? "reconcile" : "summary", link.token)));
        assert.ok(results.every(result => result.status === 200 && result.body.state === "ready"));
      }
      for (let attempt = 0; attempt < 6; attempt++) {
        assert.equal((await throughProxy("initialize", first.token, { method: "stripe" })).status, 422);
      }
      assert.equal((await throughProxy("initialize", first.token, { method: "paystack", email: "payer@test.invalid" })).status, 429);
      assert.equal((await throughProxy("summary", first.token)).status, 200); // Separate status budget.
      assert.equal((await throughProxy("initialize", second.token, { method: "paystack", email: "payer@test.invalid" })).status, 200);
      assert.equal(calls, 1); // Other payer can initialize despite the first payer's cap.
      for (let poll = 21; poll < 60; poll++) assert.equal((await throughProxy("summary", first.token)).status, 200);
      assert.equal((await throughProxy("summary", first.token)).status, 429); // Abuse still bounded.
      assert.equal((await throughProxy("reconcile", second.token)).status, 200);
      for (let invalid = 0; invalid < 120; invalid++) assert.equal((await throughProxy("summary", "bad")).status, 200);
      assert.equal((await throughProxy("summary", "bad")).status, 429);
      assert.equal((await throughProxy("summary", second.token)).status, 200); // Invalid-link budget cannot starve valid links.
    } finally { await new Promise<void>(resolve => proxy.close(() => resolve())); }
  });
  it("requires buyer auth, keeps one order and one 256-bit hashed bearer across reload/retries", async () => {
    assert.equal((await api("/uc/orders/pay-link", { checkout: input(), method: "paystack" })).status, 401);
    const checkout = input();
    const first = await save(checkout);
    const second = await save(checkout);
    assert.equal(first.url, second.url); assert.equal(first.orderId, second.orderId);
    assert.match(first.token, /^[a-zA-Z0-9_-]{43}$/);
    const result = await pool.query("SELECT * FROM uc_guest_pay_links WHERE order_id=$1", [first.orderId]);
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].token_hash, hashPayToken(first.token));
    assert.ok(!JSON.stringify(result.rows).includes(first.token));
    assert.ok(Math.abs(new Date(result.rows[0].expires_at).getTime() - Date.now() - 72 * 3600000) < 10000);
    assert.equal(first.summary.total, 800); assert.equal(first.summary.state, "ready");
    assert.equal((await api("/uc/orders/pay-link", { checkout: input(checkout.idempotencyKey), method: "paystack" }, otherAuth)).body.orderId === first.orderId, false);
  });
  it("signed-out payload is explicitly allowlisted and variant identity/size come from the saved server quote", async () => {
    const saved = await save(input(randomUUID(), true));
    const opened = await api("/guest-pay/summary", { token: saved.token });
    assert.equal(opened.status, 200); assert.equal(opened.body.buyerFirstName, "Amina");
    assert.equal(opened.body.items[0].sku, variable.childSku);
    assert.equal(opened.body.items[0].variant, variable.record.variants[0].label);
    assert.equal(opened.body.items[0].size, "750 ml");
    assert.deepEqual(Object.keys(opened.body).sort(), ["analyticsEvents","buyerFirstName","currency","deliveryArea","fulfillment","items","methods","state","total"].sort());
    for (const privateValue of ["PrivateSurname", "PrivateFlat77", "+254712345678", prefix, "shippingAddress", "user_id", "token"]) {
      assert.ok(!JSON.stringify(opened.body).includes(privateValue), privateValue);
    }
    assert.match(opened.headers.get("cache-control") || "", /no-store/);
    assert.equal(opened.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(opened.body.analyticsEvents, ["pay_link_opened", "begin_checkout"]);
    assert.deepEqual((await api("/guest-pay/summary", { token: saved.token })).body.analyticsEvents, []);
    assert.equal((await api("/guest-pay/summary", { token: "A".repeat(43) })).body.state, "invalid");
    const malformed = await realFetch(base + "/guest-pay/summary", { method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"token":"${saved.token}","phone":"PrivateContact",broken` });
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get("cache-control")!, /no-store/);
    const malformedBody = await malformed.text();
    assert.equal(malformedBody.includes(saved.token), false);
    assert.equal(malformedBody.includes("PrivateContact"), false);
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "cod" })).status, 422);
    assert.equal((await api("/uc/orders/pay-link", { checkout: saved.checkout, method: "paystack" }, saved.token)).status, 401);
  });
  it("other accounts cannot revoke a buyer order; expiry and owner cancellation cannot initialize", async () => {
    const saved = await save();
    await api("/uc/orders/pay-link/revoke", { idempotencyKey: saved.checkout.idempotencyKey }, otherAuth);
    assert.equal((await api("/guest-pay/summary", { token: saved.token })).body.state, "ready");
    await pool.query("UPDATE uc_guest_pay_links SET expires_at=now()-interval '1 second' WHERE order_id=$1", [saved.orderId]);
    assert.equal((await api("/guest-pay/summary", { token: saved.token })).body.state, "expired");
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid" })).status, 409);
    await api("/uc/orders/pay-link/revoke", { idempotencyKey: saved.checkout.idempotencyKey }, auth);
    assert.equal((await api("/guest-pay/summary", { token: saved.token })).body.state, "cancelled"); assert.equal(calls, 0);
  });
  it("current price and exact variation stock changes demand buyer refresh before any provider request", async () => {
    const saved = await save(); price = 500;
    await pool.query(`UPDATE uc_product_editorial SET record=jsonb_set(
      jsonb_set(record,'{price_kes}','500'::jsonb),'{ownership,product_price_kes}','500'::jsonb)
      WHERE code=$1`, [bottle.code]);
    invalidateCatalogueCache();
    const stale = await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid", amount: 1000 });
    assert.equal(stale.status, 409); assert.equal(stale.body.state, "refresh_required"); assert.equal(calls, 0);
    assert.equal((await api("/guest-pay/summary", { token: saved.token })).body.state, "refresh_required");
    price = 300; const variation = await save(input(randomUUID(), true)); stock = false;
    await pool.query("UPDATE uc_catalogue_inventory SET stock_status='outofstock' WHERE id=$1", [variable.childId]);
    invalidateCatalogueCache();
    assert.equal((await api("/guest-pay/initialize", { token: variation.token, method: "paystack", email: "payer@test.invalid" })).status, 409);
    assert.equal(calls, 0);
  });
  it("concurrent buyer/guest attempts share one durable guard and use the saved total, not payer edits", async () => {
    const saved = await save();
    const [buyerResult, guestResult] = await Promise.all([
      api("/payments/paystack/init", { checkout: saved.checkout, email: "buyer@test.invalid", amount: 1 }, auth),
      api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid", amount: 1, checkout: input(), callbackUrl: "https://evil.test" }),
    ]);
    assert.ok([buyerResult, guestResult].some(r => r.status === 200));
    assert.equal(calls, 1); assert.equal(latestAmount, 80000);
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid" })).status, 409);
    assert.equal(calls, 1);
    const orders = await pool.query("SELECT id FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2", [String(buyer), saved.checkout.idempotencyKey]);
    assert.equal(orders.rows.length, 1);
  });
  it("ambiguous provider acceptance never releases the guard or issues a new charge", async () => {
    const saved = await save(); timeOut = true;
    const first = await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid" });
    assert.equal(first.status, 500); assert.equal(first.body.retryable, false);
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid" })).status, 409);
    assert.equal((await api("/guest-pay/reconcile", { token: saved.token })).body.state, "pending");
    assert.equal(calls, 1);
    const order = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [saved.orderId])).rows[0];
    assert.match(order.payment_reference, /^uc_/);
    assert.equal(order.checkout_snapshot.paymentNotStarted, false);
    assert.equal((await api("/uc/orders/pay-link/revoke", { idempotencyKey: saved.checkout.idempotencyKey }, auth)).status, 409);
    const priorProviderFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, init) => String(url).includes("paystack.co/transaction/verify")
        ? Response.json({ status: true, data: { status: "abandoned", amount: 80000, currency: "KES" } })
        : priorProviderFetch(url, init);
      assert.equal((await api("/guest-pay/reconcile", { token: saved.token })).body.state, "review_required");
      assert.equal((await api("/uc/orders/pay-link/revoke", { idempotencyKey: saved.checkout.idempotencyKey }, auth)).status, 409);
    } finally { globalThis.fetch = priorProviderFetch; }
  });
  it("only amount/currency-bound verified transitions pay the original order, and confirmation failures cannot repeat payment", async () => {
    const saved = await save(); await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid" });
    const order = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [saved.orderId])).rows[0];
    await assert.rejects(recoverSnapshotCheckout(order.payment_reference, 800.01, "KES"));
    await assert.rejects(recoverSnapshotCheckout(order.payment_reference, 800, "USD"));
    let notifications = 0;
    const notify = async () => { notifications++; throw new Error("Fixture delivery failure"); };
    assert.equal(await recoverSnapshotCheckout(order.payment_reference, 800, "KES", undefined, notify), saved.orderId);
    assert.equal(await recoverSnapshotCheckout(order.payment_reference, 800, "KES", undefined, notify), saved.orderId);
    assert.equal(notifications, 1);
    const result = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [saved.orderId])).rows[0];
    assert.equal(result.checkout_state, "confirmed"); assert.ok(result.payment_confirmed_at);
    assert.equal(result.checkout_snapshot.confirmationDispatch, "queue_failed");
    const summary = await api("/guest-pay/summary", { token: saved.token });
    assert.equal(summary.body.state, "paid"); assert.equal(summary.body.verified, true);
    assert.deepEqual(summary.body.analyticsEvents, ["pay_link_opened", "begin_checkout", "pay_link_paid", "purchase"]);
    assert.deepEqual((await api("/guest-pay/summary", { token: saved.token })).body.analyticsEvents, []);
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid" })).status, 409);
    assert.equal(calls, 1);
    await pool.query("UPDATE uc_guest_pay_links SET expires_at=now()-interval '1 second' WHERE order_id=$1", [saved.orderId]);
    const expiredPaid = (await api("/guest-pay/summary", { token: saved.token })).body;
    assert.equal(expiredPaid.state, "expired");
    assert.equal(expiredPaid.buyerFirstName, undefined);
  });
  it("duplicate signed callbacks converge on the saved order without detached recovery or fulfillment duplication", async () => {
    const saved = await save(); await api("/guest-pay/initialize", { token: saved.token, method: "paystack", email: "payer@test.invalid" });
    const order = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [saved.orderId])).rows[0];
    const event = { event: "charge.success", data: { reference: order.payment_reference, amount: 80000, currency: "KES", status: "success" } };
    const signature = createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(JSON.stringify(event)).digest("hex");
    assert.equal((await api("/payments/paystack/webhook", event, undefined, { "x-paystack-signature": "bad" })).status, 401);
    const beforeRemote = remoteCalls;
    for (let repeat = 0; repeat < 2; repeat++) assert.equal((await api("/payments/paystack/webhook", event, undefined, { "x-paystack-signature": signature })).status, 200);
    assert.equal(remoteCalls, beforeRemote, "retired Woo order creation must not run");
    assert.equal((await api("/guest-pay/summary", { token: saved.token })).body.state, "paid");
  });
  it("reserved benefits survive code expiry, but missing reservation evidence fails closed", async () => {
    const code = `GUEST_${randomUUID().slice(0, 8)}`;
    const promo = await pool.query(`INSERT INTO uc_promotions(code,type,effect_mode,effect_value,starts_at,active,created_by,updated_by)
      VALUES($1,'free_shipping','fixed',0,now()-interval '1 minute',true,'fixture','fixture') RETURNING id`, [code]);
    try {
      const saved = await save({ ...input(), promoCode: code } as any);
      assert.equal(saved.summary.total, 300);
      await pool.query("UPDATE uc_promotions SET ends_at=now()-interval '1 second',active=false WHERE id=$1", [promo.rows[0].id]);
      const order = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [saved.orderId])).rows[0];
      assert.equal(await revalidatePayOrder(order), true);
      await pool.query("DELETE FROM uc_promotion_uses WHERE promotion_id=$1", [promo.rows[0].id]);
      assert.equal(await revalidatePayOrder(order), false);
    } finally {
      await pool.query("DELETE FROM uc_promotion_uses WHERE promotion_id=$1", [promo.rows[0].id]);
      await pool.query("DELETE FROM uc_promotions WHERE id=$1", [promo.rows[0].id]);
    }
  });
  it("M-Pesa callbacks recover the original immutable order even when the STK response was lost", async () => {
    Object.assign(process.env, { MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "fixture", MPESA_CONSUMER_KEY: "fixture",
      MPESA_CONSUMER_SECRET: "fixture", API_BASE_URL: "https://api.guest.test" });
    const saved = await save(input(), "mpesa"); mpesaTimeout = true; mpesaCalls = 0;
    const result = await api("/guest-pay/initialize", { token: saved.token, method: "mpesa", phone: "0712345679" });
    assert.equal(result.status, 500); assert.equal(result.body.retryable, false);
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "mpesa", phone: "0712345679" })).status, 409);
    assert.equal(mpesaCalls, 1);
    const callback = new URL(mpesaCallback);
    const event = { Body: { stkCallback: { CheckoutRequestID: "STK_INTERRUPTED_GUEST", ResultCode: 0,
      CallbackMetadata: { Item: [{ Name: "Amount", Value: 800 }, { Name: "MpesaReceiptNumber", Value: "FIXTURE123" },
        { Name: "PhoneNumber", Value: 254712345679 }] } } } };
    const beforeRemote = remoteCalls; latestAmount = 80000;
    assert.equal((await api(callback.pathname.replace(/^\/api/, "") + callback.search, event)).status, 200);
    assert.equal((await api("/guest-pay/summary", { token: saved.token })).body.state, "paid");
    assert.equal(remoteCalls, beforeRemote, "retired Woo order creation must not run");
    assert.equal((await api(callback.pathname.replace(/^\/api/, "") + callback.search, event)).status, 200);
    assert.equal(remoteCalls, beforeRemote, "duplicate callbacks cannot create remote orders");
    for (const key of ["MPESA_SHORTCODE","MPESA_PASSKEY","MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","API_BASE_URL"]) delete process.env[key];
    mpesaTimeout = false;
  });
  it("Stripe lost responses reconcile by exact order/attempt metadata without another session or charge", async () => {
    process.env.STRIPE_SECRET_KEY = "fixture";
    process.env.STRIPE_ENABLED = "true";
    let sessions: any[] = [], stripeCalls = 0, capturedOptions: any;
    setStripeForGuestPayTests({ checkout: { sessions: {
      create: async (body: any, options: any) => {
        stripeCalls++; capturedOptions = options;
        sessions = [{ id: "cs_guest_fixture", url: "https://checkout.stripe.com/fixture",
          amount_total: 80000, currency: "kes", metadata: body.metadata, payment_status: "unpaid" }];
        throw new Error("Stripe accepted; response interrupted");
      },
      list: async () => ({ data: sessions, has_more: false }),
      retrieve: async () => sessions[0],
    } }, webhooks: new Stripe("fixture").webhooks } as any);
    const saved = await save(input(), "stripe");
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "stripe" })).status, 500);
    assert.equal(stripeCalls, 1); assert.match(capturedOptions.idempotencyKey, /^guest-order-/);
    const pending = await api("/guest-pay/reconcile", { token: saved.token });
    assert.equal(pending.body.state, "pending"); assert.equal(pending.body.resumeUrl, "https://checkout.stripe.com/fixture");
    assert.equal(stripeCalls, 1);
    sessions[0].payment_status = "paid"; latestAmount = 80000;
    process.env.STRIPE_WEBHOOK_SECRET = "guest-signature-fixture";
    const event = { id: "evt_fixture", type: "checkout.session.completed", data: { object: sessions[0] } };
    const stripe = new Stripe("fixture");
    const signature = stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: process.env.STRIPE_WEBHOOK_SECRET });
    assert.equal((await api("/payments/stripe/webhook", event, undefined, { "stripe-signature": "bad" })).status, 401);
    assert.equal((await api("/payments/stripe/webhook", event, undefined, { "stripe-signature": signature })).status, 200);
    assert.equal((await api("/guest-pay/reconcile", { token: saved.token })).body.state, "paid");
    assert.equal((await api("/payments/stripe/webhook", event, undefined, { "stripe-signature": signature })).status, 200);
    assert.equal((await api("/guest-pay/initialize", { token: saved.token, method: "stripe" })).status, 409);
    setStripeForGuestPayTests(null); delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_ENABLED; delete process.env.STRIPE_WEBHOOK_SECRET;
  });
  it("ordinary COD checkout still uses its original unaffiliated flow and cannot issue a guest capability", async () => {
    const order = await prepareCheckoutOrder(input() as any, String(buyer), "cod");
    assert.equal(order.payment_method, "cod");
    assert.equal((await api("/uc/orders/pay-link", { checkout: input(), method: "cod" }, auth)).status, 422);
  });
});
