import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import http from "node:http";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { prepareCheckoutOrder, bindCheckoutPayment } from "../lib/checkout-orders.js";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const users: { id: number; email: string; token: string }[] = [];
const emails: { to: string; subject: string; html: string; text: string }[] = [];
let product: Awaited<ReturnType<typeof appCatalogueFixture>>;
let server: http.Server, base: string, wooCalls = 0;
before(async () => {
  for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "PAYSTACK_SECRET_KEY", "STRIPE_SECRET_KEY"]) delete process.env[key];
  process.env.WC_BASE_URL = "https://retired-orders.invalid";
  process.env.WC_CONSUMER_KEY = "fixture";
  process.env.WC_CONSUMER_SECRET = "fixture";
  process.env.RESEND_API_KEY = "re_fixture";
  process.env.RESEND_BASE_URL = "https://resend.fixture.invalid";
  product = await appCatalogueFixture();
  for (let i = 0; i < 2; i++) {
    const email = `app-orders-${randomUUID()}@example.test`;
    const id = (await pool.query<{ id: number }>(`INSERT INTO uc_users
      (email,password_hash,first_name,last_name,phone,address)
      VALUES($1,'unused','Amina','Buyer','+254712345678','Test building, Nairobi') RETURNING id`, [email])).rows[0]!.id;
    users.push({ id, email, token: `Bearer ${issueToken({ id, email })}` });
  }
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("retired-orders.invalid") || url.includes("/wp-json/wc/")) {
      wooCalls++; throw new Error("WooCommerce must remain disconnected");
    }
    if (url === "https://resend.fixture.invalid/emails") {
      emails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: randomUUID() });
    }
    // Absorb notification transports, never contact real delivery services.
    return Response.json({});
  };
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = realFetch;
  await pool.query("DELETE FROM uc_orders WHERE user_id=ANY($1::text[])", [users.map(user => String(user.id))]);
  await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [users.map(user => user.id)]);
  for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "PAYSTACK_SECRET_KEY", "STRIPE_SECRET_KEY",
    "WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET", "RESEND_API_KEY", "RESEND_BASE_URL"]) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
});
function checkout() {
  return { idempotencyKey: randomUUID(), fulfillment: "collection" as const,
    lineItems: [{ productId: product.id, quantity: 1 }],
    shippingAddress: { firstName: "Amina", lastName: "Buyer", phone: "+254712345678",
      address1: "Test building, Nairobi", city: "Nairobi", country: "KE" } };
}
async function post(body: unknown, token = users[0]!.token) {
  const response = await realFetch(`${base}/orders`, { method: "POST",
    headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}
async function waitForEmail(count: number) {
  const deadline = Date.now() + 4000;
  while (emails.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(emails.length, count);
}

for (const method of ["mpesa", "paystack", "stripe"]) {
  test(`${method}: saved verified checkout absorbs sequential and concurrent confirmation retries; one receipt`, async () => {
    const input = checkout(), reference = `fixture-${randomUUID()}`;
    const pending = await prepareCheckoutOrder(input, String(users[0]!.id), method);
    await bindCheckoutPayment(pending.id, reference, { reference });
    // Explicit test-only verification mode; this never initiates provider money.
    const body = { ...input, paymentMethod: method, paymentReference: reference };
    const before = emails.length;
    const first = await post(body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.id, pending.id);
    assert.equal(first.body.paymentStatus, "paid");
    await waitForEmail(before + 1);
    const [second, third] = await Promise.all([post(body), post(body)]);
    assert.equal(second.status, 200); assert.equal(third.status, 200);
    assert.equal(second.body.id, pending.id); assert.equal(third.body.id, pending.id);
    assert.equal(second.body.status, first.body.status);
    assert.equal((await pool.query("SELECT id FROM uc_orders WHERE payment_reference=$1", [reference])).rowCount, 1);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(emails.length, before + 1);
    assert.equal(emails[before]!.to, users[0]!.email);
    const receipt = JSON.stringify(emails[before]);
    assert.ok(receipt.includes(String(pending.id)));
    assert.ok(receipt.includes(first.body.lineItems[0].name));
    assert.ok(receipt.includes("Paid"));
    const stolen = await post(body, users[1]!.token);
    assert.equal(stolen.status, 422);
    assert.notEqual(stolen.body.id, pending.id);
    assert.equal((await pool.query("SELECT user_id FROM uc_orders WHERE payment_reference=$1", [reference])).rows[0].user_id, String(users[0]!.id));
    assert.equal(wooCalls, 0);
  });
}

test("COD retry keys dedupe the same intent, distinct keys create distinct unpaid orders and exact receipts", async () => {
  const input = checkout(), before = emails.length;
  const first = await post({ ...input, paymentMethod: "cod" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.notEqual(first.body.paymentStatus, "paid");
  const retry = await post({ ...input, paymentMethod: "cod" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, first.body.id);
  const next = await post({ ...checkout(), paymentMethod: "cod" });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.id, first.body.id);
  await waitForEmail(before + 2);
  const receipt = emails.find(email => email.subject.includes(String(first.body.id)))!;
  assert.equal(receipt.to, users[0]!.email);
  const text = receipt.html + receipt.text;
  assert.ok(text.includes(first.body.lineItems[0].name));
  assert.ok(text.includes("Cash on Delivery"));
  assert.ok(text.includes("Payment pending"));
  assert.ok(text.includes(first.body.receiptSerial));
  assert.equal(wooCalls, 0);
});

test("order history is local, account-scoped, complete past twenty records and newest first", async () => {
  const older = "2026-08-01T00:00:00Z";
  const owned = (await pool.query<{ id: number }>(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method,date_created)
    SELECT $1,'completed','100','KES','cod',$2::timestamptz + i * interval '1 minute'
    FROM generate_series(1,25) i RETURNING id`, [String(users[1]!.id), older])).rows.map(row => row.id);
  const response = await realFetch(`${base}/orders`, { headers: { authorization: users[1]!.token } });
  assert.equal(response.status, 200);
  const rows = await response.json() as any[];
  const confirmed = rows.filter(row => owned.includes(row.id));
  assert.equal(confirmed.length, 25);
  assert.deepEqual(confirmed.map(row => row.id), [...owned].reverse());
  assert.ok(rows.every(row => row.paymentStatus !== "paid"), "fulfillment is not proof of payment");
  const anonymous = await realFetch(`${base}/orders`);
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), []);
  assert.equal(wooCalls, 0);
});
