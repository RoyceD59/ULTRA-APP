import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { prepareCheckoutOrder, bindCheckoutPayment, confirmCheckoutOrder } from "../lib/checkout-orders.js";
import { requestPhysicalTest } from "../lib/instant-water-check-service.js";
import { setPhysicalTestNotificationSenderForTests, type PhysicalTestNotification } from "../lib/physical-test-notifications.js";
import { quoteMatchesCheckout } from "../../../uc-companion/hooks/checkoutQuoteIdentity.js";
import { recoverSnapshotCheckout } from "../routes/payments.js";
import { reconcileAbandonedCheckouts } from "../lib/abandoned-checkouts.js";
import { releaseUnsuccessfulCheckout, type PaymentVerifier } from "../lib/checkout-cancellation.js";
import { verifyPaymentOnServer } from "../routes/uc.js";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

describe("authoritative checkout and managed waived-service benefits", () => {
  let server: http.Server, base = "", uid = 0, otherId = 0, token = "";
  const realFetch = globalThis.fetch;
  const prefix = `BENEFIT${Date.now()}`;
  const codes: Record<string, string> = {};
  let remotePosts: any[] = [];
  let remotes: any[] = [];
  let failRemote = false;
  let catalogueDown = false;
  let paymentAmount = 0;
  let providerCalls = 0;
  let providerStatus = "success";
  let mpesaCalls = 0;
  const mpesaStatuses = new Map<string,string>();
  const mpesaRefs: string[] = [];
  const address = { firstName: "Amina", lastName: "Otieno", country: "KE", phone: "+254712345678", address1: "Collection contact, Nairobi", city: "" };
  const cart = [{ productId: 10001, quantity: 1 }, { productId: 10002, quantity: 2 }];
  const fixture = (key = randomUUID(), extra: Record<string, unknown> = {}) => ({
    lineItems: cart, fulfillment: "collection" as const, shippingAddress: address, idempotencyKey: key, ...extra,
  });
  async function api(path: string, body: unknown, signed = true, headers = {}) {
    const result = await realFetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json",
      "X-Forwarded-For": `198.51.100.${paymentWindow}`,
      ...(signed ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
    const text = await result.text();
    assert.ok(result.headers.get("content-type")?.includes("application/json"), `Non-JSON response (${result.status}) for ${path}: ${text}`);
    return { status: result.status, body: JSON.parse(text) as any };
  }
  async function promo(kind: string, value = 0, cap?: number) {
    const code = `${prefix}_${randomUUID().slice(0,8)}`.toUpperCase();
    await pool.query(`INSERT INTO uc_promotions(code,type,effect_mode,effect_value,starts_at,active,global_use_limit,per_user_use_limit,created_by,updated_by)
      VALUES($1,$2,'fixed',$3,now()-interval '1 minute',true,$4,1,'test','test')`, [code, kind, value, cap ?? null]);
    return code;
  }
  let paymentWindow = 0;
  beforeEach(() => { paymentWindow++; });
  before(async () => {
    app.set("trust proxy", "loopback"); // Test-only, so each scenario has its own payment allowance.
    for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY","MPESA_SHORTCODE","PAYSTACK_SECRET_KEY","STRIPE_SECRET_KEY"]) delete process.env[key];
    process.env.SESSION_SECRET ??= "isolated-benefits-test";
    process.env.UC_GUEST_PAY_PUBLIC_ORIGIN = "https://benefits-checkout.test";
    process.env.WC_BASE_URL = "https://benefits-shop.test";
    process.env.WC_CONSUMER_KEY = "fixture";
    process.env.WC_CONSUMER_SECRET = "fixture";
    cart[0]!.productId = (await appCatalogueFixture(1400)).id;
    cart[1]!.productId = (await appCatalogueFixture(300)).id;
    const users = await pool.query(`INSERT INTO uc_users(email,password_hash,first_name,last_name,phone,is_admin,address)
      VALUES($1,'unused','Amina','Otieno','+254712345678',true,'Fixture address'),($2,'unused','Mary','Otieno','+254712345679',false,'Fixture address') RETURNING id,email`,
      [`${prefix}@test.invalid`,`${prefix}-other@test.invalid`]);
    uid = users.rows[0].id; otherId = users.rows[1].id;
    token = issueToken({ id: uid, email: users.rows[0].email, firstName: "Amina", lastName: "Otieno" });
    codes.ship = await promo("free_shipping");
    codes.test = await promo("free_water_test");
    codes.discount = await promo("checkout_discount", 500);
    await pool.query("INSERT INTO uc_promotion_products(promotion_id,product_id) SELECT id,$2 FROM uc_promotions WHERE code=$1", [codes.discount, cart[0]!.productId]);
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("safaricom.co.ke/oauth/")) return new Response(JSON.stringify({access_token:"fixture-token"}));
      if (target.includes("safaricom.co.ke/mpesa/stkpush/v1/processrequest")) {
        const ref = `STK_${randomUUID()}`; mpesaCalls++; mpesaRefs.push(ref);
        return new Response(JSON.stringify({CheckoutRequestID:ref,ResponseCode:"0",CustomerMessage:"Fixture push"}));
      }
      if (target.includes("safaricom.co.ke/mpesa/stkpushquery/")) {
        const ref = JSON.parse(String(init?.body)).CheckoutRequestID;
        return new Response(JSON.stringify({ResultCode:mpesaStatuses.get(ref) ?? "pending",ResultDesc:"Fixture result"}));
      }
      if (target.includes("benefits-shop.test") && target.includes("/products")) {
        if (catalogueDown) return new Response("Offline", { status: 503 });
        return new Response(JSON.stringify([
          { id: 10001, name: "Live filter", price: "1400", stock_status: "instock", status: "publish" },
          { id: 10002, name: "Live bottle", price: "300", stock_status: "instock", status: "publish" },
        ]));
      }
      if (target.includes("benefits-shop.test") && target.includes("/orders")) {
        if (init?.method === "POST") {
          const payload = JSON.parse(String(init.body)); remotePosts.push(payload);
          const total = payload.line_items.reduce((s: number,i: any) => s + Number(i.total),0) +
            payload.shipping_lines.reduce((s: number,i: any) => s + Number(i.total),0) +
            payload.fee_lines.reduce((s: number,i: any) => s + Number(i.total),0);
          const order = { ...payload, id: 900000 + remotePosts.length, total: String(total), status: "processing", currency: "KES" };
          remotes.push(order);
          if (failRemote) throw new Error("Timeout after Woo acceptance");
          return new Response(JSON.stringify(order), { status: 201 });
        }
        return new Response(JSON.stringify(remotes));
      }
      if (target.includes("api.paystack.co/transaction/initialize")) {
        providerCalls++;
        paymentAmount = JSON.parse(String(init?.body)).amount;
        return new Response(JSON.stringify({ status: true, data: { reference: JSON.parse(String(init?.body)).reference ?? `PS_${randomUUID()}`, authorization_url: "https://payments.test", access_code: "test" } }));
      }
      if (target.includes("api.paystack.co/transaction/verify/")) return new Response(JSON.stringify({ status: true, data: { status: providerStatus, amount: paymentAmount, currency: "KES" } }));
      return new Response(JSON.stringify({ data: [], success: true }));
    };
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
    delete process.env.WC_BASE_URL; delete process.env.WC_CONSUMER_KEY; delete process.env.WC_CONSUMER_SECRET; delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.UC_GUEST_PAY_PUBLIC_ORIGIN;
    for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY","MPESA_SHORTCODE"]) delete process.env[key];
    await pool.query("DELETE FROM mpesa_stk_initiations WHERE checkout_request_id=ANY($1::text[])",[mpesaRefs]);
    await pool.query("DELETE FROM instant_water_assessments WHERE customer_user_id=ANY($1::text[])", [[String(uid),String(otherId)]]);
    await pool.query("DELETE FROM uc_promotion_uses WHERE user_id=ANY($1::int[])", [[uid,otherId]]);
    await pool.query("DELETE FROM uc_promotions WHERE code LIKE $1", [`${prefix}%`]);
    await pool.query("DELETE FROM uc_orders WHERE user_id=ANY($1::text[])", [[String(uid),String(otherId)]]);
    await pool.query("DELETE FROM uc_referral_benefits WHERE user_id=ANY($1::int[])", [[uid,otherId]]);
    await pool.query("DELETE FROM uc_rewards_ledger WHERE user_id=ANY($1::int[])", [[uid,otherId]]);
    await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [[uid,otherId]]);
  });
  it("replaces independently failed M-Pesa attempts once while retaining the order and reservation", async () => {
    for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY"]) process.env[key]="fixture";
    process.env.MPESA_SHORTCODE="174379";
    const code = await promo("free_shipping",0,1);
    const checkout = fixture(randomUUID(),{fulfillment:"delivery",shippingAddress:{...address,address1:"Test road",city:"Nairobi"},promoCode:code});
    const body = {checkout,amount:1,phone:"254712345678"};
    const first = await api("/payments/mpesa",body);
    assert.equal(first.status,200); assert.equal(mpesaCalls,1);
    const original = (await pool.query("SELECT * FROM uc_orders WHERE checkout_idempotency_key=$1",[checkout.idempotencyKey])).rows[0];
    assert.equal(Number(original.total),2000);
    assert.equal((await api("/payments/mpesa",body)).body.checkoutRequestId,first.body.checkoutRequestId);
    assert.equal(mpesaCalls,1,"pending/unknown must never initiate again");
    mpesaStatuses.set(first.body.checkoutRequestId,"1032");
    const replacements = await Promise.all([api("/payments/mpesa",body),api("/payments/mpesa",body)]);
    const replacement = replacements.find(r=>r.status===200)!;
    assert.ok(replacement); assert.notEqual(replacement.body.checkoutRequestId,first.body.checkoutRequestId);
    assert.equal(mpesaCalls,2,"only one concurrent terminal-failure replacement");
    const current = (await pool.query("SELECT * FROM uc_orders WHERE id=$1",[original.id])).rows[0];
    assert.equal(current.checkout_snapshot.paymentAttempts.length,1);
    assert.equal(current.checkout_snapshot.paymentAttempts[0].reference,first.body.checkoutRequestId);
    assert.notEqual(current.checkout_snapshot.paymentAttemptId,original.checkout_snapshot.paymentAttemptId);
    assert.equal((await pool.query("SELECT count(*)::int n FROM uc_promotion_uses WHERE operation_ref=$1",[String(original.id)])).rows[0].n,1);
    assert.equal((await api("/payments/mpesa",body)).body.checkoutRequestId,replacement.body.checkoutRequestId);
    assert.equal(mpesaCalls,2);
    let notifications = 0;
    const notify = async (order:any) => {notifications++;assert.equal(order.mpesa_receipt,"FIXTURE_RECEIPT");};
    mpesaStatuses.set(replacement.body.checkoutRequestId,"0");
    assert.equal(await recoverSnapshotCheckout(replacement.body.checkoutRequestId,2000,"KES","FIXTURE_RECEIPT",notify),original.id);
    assert.equal(await recoverSnapshotCheckout(replacement.body.checkoutRequestId,2000,"KES","OTHER_RECEIPT",notify),original.id);
    assert.equal(notifications,1,"receipt is filled once before initial notification");
    const settled = (await pool.query("SELECT * FROM uc_orders WHERE id=$1",[original.id])).rows[0];
    assert.equal(settled.mpesa_receipt,"FIXTURE_RECEIPT");
    assert.equal(settled.checkout_state,"confirmed");
    for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY","MPESA_SHORTCODE"]) delete process.env[key];
  });
  it("keeps app-owned checkouts visible only to their verified account",async()=>{
    const ownerEmail=(await pool.query("SELECT email FROM uc_users WHERE id=$1",[uid])).rows[0].email;
    const other=(await pool.query("SELECT email FROM uc_users WHERE id=$1",[otherId])).rows[0];
    const input=fixture(randomUUID(),{shippingAddress:{...address,email:other.email}});
    const response=await api("/uc/orders",{...input,paymentMethod:"cod"});
    assert.equal(response.status,200);
    const persisted = (await pool.query("SELECT user_id FROM uc_orders WHERE id=$1", [response.body.id])).rows[0];
    assert.equal(persisted.user_id,String(uid),"untrusted checkout email is never the ownership identity");
    assert.equal(remotePosts.length,0,"retired Woo authority must not be contacted");
    assert.ok(ownerEmail);
    const mine=await realFetch(`${base}/uc/orders`,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(mine.status,200);
    assert.ok((await mine.json() as any[]).some(o=>o.id===response.body.id));
    const another=issueToken({id:otherId,email:other.email,firstName:"Mary",lastName:"Otieno"});
    const theirs=await realFetch(`${base}/uc/orders`,{headers:{Authorization:`Bearer ${another}`}});
    assert.equal(theirs.status,200);
    assert.ok(!(await theirs.json() as any[]).some(o=>o.id===response.body.id),"fuzzy Woo search must not leak the order");
  });
  it("quotes real catalogue IDs, product-restricted discounts and updated cart totals", async () => {
    const bare = await api("/uc/checkout/quote", { lineItems: cart, fulfillment: "collection" });
    assert.equal(bare.status,200); assert.equal(bare.body.subtotal,2000); assert.equal(bare.body.total,2000); assert.equal(bare.body.delivery,0);
    const restricted = await api("/uc/checkout/quote", { lineItems: cart, fulfillment: "delivery", code: codes.discount });
    assert.equal(restricted.status,200); assert.equal(restricted.body.discountAmount,500); assert.equal(restricted.body.total,2000);
    const changed = await api("/uc/checkout/quote", { lineItems: [{productId:cart[0]!.productId,quantity:2}], fulfillment:"collection",code:codes.discount });
    assert.equal(changed.body.total,2300);
    const ineligible = await api("/uc/checkout/quote", {lineItems:[{productId:cart[1]!.productId,quantity:1}],fulfillment:"collection",code:codes.discount});
    assert.equal(ineligible.status,422);
    for (const lineItems of [[],[{productId:cart[0]!.productId,quantity:0}],[{productId:cart[0]!.productId,quantity:1.5}],[{productId:cart[0]!.productId,quantity:"1"}],[{productId:99999,quantity:1}]]) {
      assert.equal((await api("/uc/checkout/quote",{lineItems,fulfillment:"collection"})).status,422);
    }
    catalogueDown = true;
    assert.equal((await api("/uc/checkout/quote",{lineItems:[{productId:22,quantity:1}],fulfillment:"collection"})).status,422);
    catalogueDown = false;
  });
  it("blocks stale client quotes and frees only safely cancelled checkout reservations", async () => {
    const quote = (await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"collection"})).body;
    const input = {lineItems:cart,fulfillment:"collection",applyReferralDiscount:false};
    assert.equal(quoteMatchesCheckout(quote,input),true);
    assert.equal(quoteMatchesCheckout(quote,{...input,fulfillment:"delivery"}),false);
    assert.equal(quoteMatchesCheckout(quote,{...input,lineItems:[{productId:cart[0]!.productId,quantity:2}]}),false);
    assert.equal(quoteMatchesCheckout(quote,{...input,code:"CHANGED"}),false);
    const code = await promo("free_shipping",0,1);
    const checkout = fixture(randomUUID(),{fulfillment:"delivery",shippingAddress:{...address,address1:"A road",city:"Nairobi"},promoCode:code});
    const order = await prepareCheckoutOrder(checkout as any,String(uid),"paystack");
    const released = await api("/uc/checkout/cancel",{idempotencyKey:checkout.idempotencyKey}); assert.equal(released.status,200);
    assert.equal((await api("/uc/checkout/cancel",{idempotencyKey:checkout.idempotencyKey})).status,200);
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"delivery",code})).status,200);
    await assert.rejects(prepareCheckoutOrder(checkout as any,String(uid),"paystack"),/cancelled/);
    const paid = await prepareCheckoutOrder(fixture() as any,String(uid),"paystack");
    await bindCheckoutPayment(paid.id,"uncertain-payment",{reference:"uncertain-payment"});
    const refused = await api("/uc/checkout/cancel",{idempotencyKey:paid.checkout_idempotency_key}); assert.equal(refused.status,409);
    const unmodified = await pool.query("SELECT status FROM uc_orders WHERE id=$1",[paid.id]); assert.equal(unmodified.rows[0].status,"pending");
    process.env.PAYSTACK_SECRET_KEY = "fixture-key";
    providerStatus = "failed";
    assert.equal((await api("/uc/checkout/cancel",{idempotencyKey:paid.checkout_idempotency_key})).status,200);
    providerStatus = "success"; delete process.env.PAYSTACK_SECRET_KEY;
    await assert.rejects(prepareCheckoutOrder(fixture(randomUUID(),{quotedTotal:1}) as any,String(uid),"paystack"),/Prices changed/);
    assert.ok(order.id);
  });
  it("reconciles old Paystack and M-Pesa failures against their saved references and restores the final use exactly once", async () => {
    const code = await promo("free_shipping",0,1);
    const input = fixture(randomUUID(),{fulfillment:"delivery",shippingAddress:{...address,address1:"A road",city:"Nairobi"},promoCode:code});
    const order = await prepareCheckoutOrder(input as any,String(uid),"paystack");
    await bindCheckoutPayment(order.id,"abandoned-paystack",{reference:"abandoned-paystack"});
    await pool.query("UPDATE uc_orders SET date_created=now()-interval '2 days' WHERE id=$1",[order.id]);
    process.env.PAYSTACK_SECRET_KEY="fixture-key";
    providerStatus="failed";
    const runs = await Promise.all([
      reconcileAbandonedCheckouts({userIds:[String(uid)]}),
      reconcileAbandonedCheckouts({userIds:[String(uid)]}),
    ]);
    assert.equal(runs.reduce((n,r)=>n+r.released,0),1,"concurrent cleanup releases once");
    const cancelled = (await pool.query("SELECT * FROM uc_orders WHERE id=$1",[order.id])).rows[0];
    assert.equal(cancelled.status,"cancelled");
    assert.equal(cancelled.payment_reference,"abandoned-paystack");
    assert.equal(cancelled.checkout_snapshot.provider.reference,"abandoned-paystack");
    assert.equal(cancelled.checkout_snapshot.benefitRelease.reference,"abandoned-paystack");
    assert.equal(cancelled.checkout_snapshot.benefitRelease.outcome,"terminal_failure");
    assert.equal(cancelled.checkout_snapshot.benefitRelease.promotionUses.length,1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM uc_order_items WHERE order_id=$1",[order.id])).rows[0].n,2);
    assert.equal((await reconcileAbandonedCheckouts({userIds:[String(uid)]})).released,0);
    await assert.rejects(confirmCheckoutOrder(order.id,"abandoned-paystack"),/cancelled/);
    await assert.rejects(bindCheckoutPayment(order.id,"abandoned-paystack",{}),/payment attempt/);
    await assert.rejects(recoverSnapshotCheckout("abandoned-paystack",2000,"KES",undefined,async()=>{}),/cancelled/);
    const uses = await Promise.allSettled([
      prepareCheckoutOrder({...input,idempotencyKey:randomUUID()} as any,String(uid),"mpesa"),
      prepareCheckoutOrder({...input,idempotencyKey:randomUUID()} as any,String(otherId),"mpesa"),
    ]);
    assert.equal(uses.filter(r=>r.status==="fulfilled").length,1,"the final released use has exactly one new owner");
    const replacement = (uses.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<any>).value;
    for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY"]) process.env[key]="fixture";
    process.env.MPESA_SHORTCODE="174379";
    const ref=`FAILED_${randomUUID()}`;
    mpesaStatuses.set(ref,"1032");
    await bindCheckoutPayment(replacement.id,ref,{checkoutRequestId:ref});
    await pool.query("UPDATE uc_orders SET date_created=now()-interval '2 days' WHERE id=$1",[replacement.id]);
    const mpesa = await reconcileAbandonedCheckouts({userIds:[replacement.user_id]});
    assert.equal(mpesa.released,1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM uc_promotion_uses WHERE operation_ref=$1",[String(replacement.id)])).rows[0].n,0);
    for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY","MPESA_SHORTCODE"]) delete process.env[key];
    providerStatus="success"; delete process.env.PAYSTACK_SECRET_KEY;
  });
  it("uses age only for selection and keeps unknown, paid, remotely attempted and ambiguous initiation reservations", async () => {
    const rows: any[] = [];
    async function reserved(method="paystack") {
      const code=await promo("free_shipping",0,1);
      const order=await prepareCheckoutOrder(fixture(randomUUID(),{fulfillment:"delivery",
        shippingAddress:{...address,address1:"A road",city:"Nairobi"},promoCode:code}) as any,String(uid),method);
      rows.push(order); return order;
    }
    const fresh=await reserved();
    const never=await reserved();
    const failedStripe=await reserved("stripe");
    await bindCheckoutPayment(failedStripe.id,"expired-stripe",{sessionId:"expired-stripe"});
    const protectedIds: number[]=[fresh.id];
    for (const state of ["pending","unknown","paid","throws","initializing","legacy","remote_attempted","remote_unknown","remote_total_mismatch","confirmed","paid_marker","receipt","remote_marker","wc_marker"]) {
      const order=await reserved();
      protectedIds.push(order.id);
      if (!["initializing","legacy"].includes(state)) await bindCheckoutPayment(order.id,`keep-${state}`,{reference:`keep-${state}`});
      if (["remote_attempted","remote_unknown","remote_total_mismatch","confirmed"].includes(state)) {
        await pool.query("UPDATE uc_orders SET checkout_state=$2 WHERE id=$1",[order.id,state]);
      }
      if (state==="initializing") await pool.query(`UPDATE uc_orders SET checkout_state='payment_pending',
        checkout_snapshot=checkout_snapshot || '{"paymentStartedAt":"saved-before-request","paymentNotStarted":false}'::jsonb WHERE id=$1`,[order.id]);
      if (state==="legacy") await pool.query("UPDATE uc_orders SET checkout_snapshot=checkout_snapshot-'paymentNotStarted' WHERE id=$1",[order.id]);
      if (state==="paid_marker") await pool.query("UPDATE uc_orders SET payment_confirmed_at=now() WHERE id=$1",[order.id]);
      if (state==="receipt") await pool.query("UPDATE uc_orders SET mpesa_receipt='PAID_RECEIPT' WHERE id=$1",[order.id]);
      if (state==="remote_marker") await pool.query("UPDATE uc_orders SET remote_attempted_at=now() WHERE id=$1",[order.id]);
      if (state==="wc_marker") await pool.query("UPDATE uc_orders SET wc_order_id=99999 WHERE id=$1",[order.id]);
    }
    await pool.query("UPDATE uc_orders SET date_created=now()-interval '2 days' WHERE id=ANY($1::int[])",
      [rows.filter(r=>r.id!==fresh.id).map(r=>r.id)]);
    const calls: [string,string][]=[];
    const verify: PaymentVerifier=async (method,reference)=>{
      calls.push([method,reference]);
      if (reference==="expired-stripe") return {ok:false,failureFinal:true,reason:"Expired session"};
      if (reference==="keep-throws") throw new Error("Provider offline");
      if (reference==="keep-paid") return {ok:true};
      return {ok:false};
    };
    const result=await reconcileAbandonedCheckouts({userIds:[String(uid)],verify});
    assert.equal(result.released,2);
    assert.equal(result.errors,1,"provider failures retain the reservation and do not abort the run");
    assert.ok(calls.some(([m,r])=>m==="stripe" && r==="expired-stripe"));
    for (const id of protectedIds) {
      const row=(await pool.query("SELECT status FROM uc_orders WHERE id=$1",[id])).rows[0];
      assert.equal(row.status,"pending",`protected order ${id} must remain untouched`);
      assert.equal((await pool.query("SELECT count(*)::int n FROM uc_promotion_uses WHERE operation_ref=$1",[String(id)])).rows[0].n,1);
    }
    assert.equal((await pool.query("SELECT checkout_snapshot FROM uc_orders WHERE id=$1",[never.id])).rows[0].checkout_snapshot.benefitRelease.outcome,"never_initiated");
  });
  it("lets recovery win while cleanup verifies and rejects stale failure evidence after attempt replacement", async () => {
    const code=await promo("free_shipping",0,1);
    const order=await prepareCheckoutOrder(fixture(randomUUID(),{fulfillment:"delivery",
      shippingAddress:{...address,address1:"A road",city:"Nairobi"},promoCode:code}) as any,String(uid),"paystack");
    await bindCheckoutPayment(order.id,"racing-recovery",{reference:"racing-recovery"});
    const snapshot=(await pool.query("SELECT * FROM uc_orders WHERE id=$1",[order.id])).rows[0];
    let started!: ()=>void, finish!: ()=>void;
    const entered=new Promise<void>(r=>started=r);
    const waiting=new Promise<void>(r=>finish=r);
    const cleanup=releaseUnsuccessfulCheckout(snapshot,"abandoned_cleanup",async(method,reference)=>{
      assert.equal(method,"paystack"); assert.equal(reference,"racing-recovery");
      started(); await waiting; return {ok:false,failureFinal:true};
    });
    await entered;
    const recovered=await recoverSnapshotCheckout("racing-recovery",2000,"KES",undefined,async()=>{});
    assert.equal(recovered,order.id);
    finish();
    assert.equal(await cleanup,"retained");
    assert.equal((await pool.query("SELECT count(*)::int n FROM uc_promotion_uses WHERE operation_ref=$1",[String(order.id)])).rows[0].n,1);
    const changing=await prepareCheckoutOrder(fixture() as any,String(uid),"mpesa");
    await bindCheckoutPayment(changing.id,"old-attempt",{checkoutRequestId:"old-attempt"});
    const prior=(await pool.query("SELECT * FROM uc_orders WHERE id=$1",[changing.id])).rows[0];
    assert.equal(await releaseUnsuccessfulCheckout(prior,"abandoned_cleanup",async()=>{
      await pool.query(`UPDATE uc_orders SET payment_reference='new-attempt',
        checkout_snapshot=jsonb_set(checkout_snapshot,'{paymentAttemptId}','"replacement"') WHERE id=$1`,[changing.id]);
      return {ok:false,failureFinal:true};
    }),"retained");
    assert.equal((await pool.query("SELECT payment_reference,status FROM uc_orders WHERE id=$1",[changing.id])).rows[0].status,"pending");
    const initiating=await prepareCheckoutOrder(fixture() as any,String(uid),"stripe");
    assert.equal(await releaseUnsuccessfulCheckout(initiating,"abandoned_cleanup",async()=>{throw new Error("Must not verify");}),"released");
  });
  it("restores a reserved referral benefit once, retains its order audit, and allows exactly one new claim", async () => {
    const inserted=await pool.query(`INSERT INTO uc_referral_benefits(conversion_id,user_id,kind,discount_percent)
      VALUES($1,$2,'discount',10) RETURNING id`,[Date.now(),uid]);
    const benefitId=inserted.rows[0].id;
    const input=fixture(randomUUID(),{applyReferralDiscount:true});
    const order=await prepareCheckoutOrder(input as any,String(uid),"paystack");
    assert.equal(Number((await pool.query("SELECT referral_benefit_id FROM uc_orders WHERE id=$1",[order.id])).rows[0].referral_benefit_id),Number(benefitId));
    await bindCheckoutPayment(order.id,"failed-referral",{reference:"failed-referral"});
    const snapshot=(await pool.query("SELECT * FROM uc_orders WHERE id=$1",[order.id])).rows[0];
    const verify:PaymentVerifier=async(m,r)=>{
      assert.equal(m,"paystack"); assert.equal(r,"failed-referral"); return {ok:false,failureFinal:true};
    };
    const outcomes=await Promise.all([
      releaseUnsuccessfulCheckout(snapshot,"abandoned_cleanup",verify),
      releaseUnsuccessfulCheckout(snapshot,"abandoned_cleanup",verify),
    ]);
    assert.equal(outcomes.filter(o=>o==="released").length,1);
    const benefit=(await pool.query("SELECT * FROM uc_referral_benefits WHERE id=$1",[benefitId])).rows[0];
    assert.equal(benefit.status,"available"); assert.equal(benefit.used_order_id,null); assert.equal(benefit.used_at,null);
    const cancelled=(await pool.query("SELECT * FROM uc_orders WHERE id=$1",[order.id])).rows[0];
    assert.equal(cancelled.referral_benefit_id,null,"release the unique active entitlement link while retaining the link in the audit");
    assert.equal(Number(cancelled.checkout_snapshot.benefitRelease.referralBenefitId),Number(benefitId));
    assert.equal(cancelled.checkout_snapshot.benefitRelease.referralRestored,true);
    const claims=await Promise.allSettled([
      prepareCheckoutOrder({...input,idempotencyKey:randomUUID()} as any,String(uid),"paystack"),
      prepareCheckoutOrder({...input,idempotencyKey:randomUUID()} as any,String(uid),"paystack"),
    ]);
    assert.equal(claims.filter(o=>o.status==="fulfilled").length,1,
      claims.filter(o=>o.status==="rejected").map(o=>String((o as PromiseRejectedResult).reason)).join("; "));
    assert.equal(await releaseUnsuccessfulCheckout(snapshot,"abandoned_cleanup",verify),"already_cancelled");
    assert.equal((await pool.query("SELECT status FROM uc_referral_benefits WHERE id=$1",[benefitId])).rows[0].status,"used","repeated old cleanup cannot restore a newly claimed benefit");
  });
  it("keeps reservations when initiation wins a release race and rejects untrusted failure-shaped provider responses", async () => {
    const order=await prepareCheckoutOrder(fixture() as any,String(uid),"paystack");
    const lock=await pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM uc_orders WHERE id=$1 FOR UPDATE",[order.id]);
      const release=releaseUnsuccessfulCheckout(order,"abandoned_cleanup");
      await lock.query(`UPDATE uc_orders SET checkout_state='payment_initiating',
        checkout_snapshot=checkout_snapshot || '{"paymentNotStarted":false,"paymentStartedAt":"persisted-before-request"}'::jsonb WHERE id=$1`,[order.id]);
      await lock.query("COMMIT");
      assert.equal(await release,"retained");
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    const mockFetch=globalThis.fetch;
    try {
      process.env.PAYSTACK_SECRET_KEY="fixture-key";
      globalThis.fetch=async()=>new Response(JSON.stringify({status:false,data:{status:"failed"}}));
      assert.notEqual((await verifyPaymentOnServer("paystack","untrusted-failure")).failureFinal,true);
      globalThis.fetch=async()=>new Response(JSON.stringify({status:true,data:{status:"failed"}}),{status:503});
      assert.notEqual((await verifyPaymentOnServer("paystack","provider-offline")).failureFinal,true);
      for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY"]) process.env[key]="fixture";
      process.env.MPESA_SHORTCODE="174379";
      globalThis.fetch=async(url:any)=>String(url).includes("/oauth/")
        ?new Response(JSON.stringify({access_token:"fixture"}))
        :new Response(JSON.stringify({ResultCode:"1032"}),{status:503});
      assert.notEqual((await verifyPaymentOnServer("mpesa","provider-offline")).failureFinal,true);
    } finally {
      globalThis.fetch=mockFetch;
      delete process.env.PAYSTACK_SECRET_KEY;
      for (const key of ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_PASSKEY","MPESA_SHORTCODE"]) delete process.env[key];
    }
  });
  it("requires fulfillment, waives selected delivery only and rejects stacked or wrong-operation benefits", async () => {
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart})).status,422);
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"collection",code:codes.ship})).status,422);
    const waived = await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"delivery",code:codes.ship});
    assert.equal(waived.body.delivery,0); assert.equal(waived.body.total,2000);
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"delivery",code:codes.ship,applyReferralDiscount:true})).status,422);
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"collection",code:codes.test})).status,422);
    const missing = await api("/uc/customer/referrals/discount/quote",{lineItems:cart,fulfillment:"collection"});
    assert.equal(missing.status,422); assert.match(missing.body.error,/earned referral/i);
  });
  it("new staff-created activated service codes have no artificial amount fields", async () => {
    const code = `${prefix}_ADMIN`;
    const created = await api("/uc/admin/promotions",{code,type:"free_shipping",startsAt:new Date(Date.now()-60000).toISOString(),globalUseLimit:2,perUserUseLimit:1});
    assert.equal(created.status,201); assert.equal(Number(created.body.promotion.effect_value),0);
    const id = created.body.promotion.id;
    await api(`/uc/admin/promotions/${id}/deactivate`,{});
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"delivery",code})).status,422);
    await api(`/uc/admin/promotions/${id}/activate`,{});
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"delivery",code})).status,200);
    await pool.query("UPDATE uc_promotions SET ends_at=now()-interval '1 second' WHERE id=$1",[id]);
    assert.equal((await api("/uc/checkout/quote",{lineItems:cart,fulfillment:"delivery",code})).status,422);
  });
  it("persists collection and selected shipping with app-owned amounts and replay-safe uses", async () => {
    const key = randomUUID();
    const body = { ...fixture(key,{fulfillment:"delivery",shippingAddress:{...address,address1:"1 Test Road",city:"Nairobi"},promoCode:codes.ship}),paymentMethod:"cod",paymentReference:"" };
    const first = await api("/uc/orders",body);
    assert.equal(first.status,200); assert.equal(first.body.total,"2000"); assert.equal(first.body.shippingAddress.fulfillment,"delivery");
    const posts = remotePosts.length;
    await pool.query("UPDATE uc_promotions SET active=false WHERE code=$1",[codes.ship]);
    const replay = await api("/uc/orders",body); assert.equal(replay.status,200); assert.equal(replay.body.id,first.body.id); assert.equal(remotePosts.length,posts);
    assert.equal(first.body.shippingAddress.shippingAmount,"0");
    assert.equal(remotePosts.length,0);
    const use = await pool.query("SELECT * FROM uc_promotion_uses WHERE user_id=$1 AND idempotency_key=$2",[uid,`checkout:${key}`]);
    assert.equal(use.rows.length,1);
    const collection = await api("/uc/orders",{...fixture(),paymentMethod:"cod"});
    assert.equal(collection.status,200); assert.equal(collection.body.shippingAddress.fulfillment,"collection"); assert.equal(collection.body.total,"2000");
    const delivery = await api("/uc/orders",{...fixture(randomUUID(),{fulfillment:"delivery",shippingAddress:{...address,address1:"A road",city:"Nairobi"}}),paymentMethod:"cod"});
    assert.equal(delivery.body.total,"2500");
    assert.equal((await api("/uc/orders",{...fixture(randomUUID(),{fulfillment:"delivery"}),paymentMethod:"cod"})).status,422);
  });
  it("reserves the final redemption atomically with its order and permits identical retries", async () => {
    const code = await promo("free_shipping",0,1);
    const one = fixture(randomUUID(),{fulfillment:"delivery",shippingAddress:{...address,address1:"A road",city:"Nairobi"},promoCode:code});
    const two = { ...one,idempotencyKey:randomUUID() };
    const settled = await Promise.allSettled([
      prepareCheckoutOrder(one as any,String(uid),"paystack"),
      prepareCheckoutOrder(two as any,String(otherId),"paystack"),
    ]);
    assert.equal(settled.filter(r=>r.status==="fulfilled").length,1);
    const index = settled.findIndex(r=>r.status==="fulfilled");
    const original = (settled[index] as PromiseFulfilledResult<any>).value;
    const repeated = await prepareCheckoutOrder((index===0?one:two) as any,String(index===0?uid:otherId),"paystack");
    assert.equal(repeated.id,original.id);
    const count = await pool.query("SELECT count(*)::int AS n FROM uc_promotion_uses u JOIN uc_promotions p ON p.id=u.promotion_id WHERE p.code=$1",[code]);
    assert.equal(count.rows[0].n,1);
  });
  it("uses authoritative payment amounts, immutable cart snapshots, payment retry and webhook recovery", async () => {
    process.env.PAYSTACK_SECRET_KEY="fixture-key";
    const input = fixture(randomUUID(),{fulfillment:"delivery",shippingAddress:{...address,address1:"A road",city:"Nairobi"}});
    const init = await api("/payments/paystack/init",{email:`${prefix}@test.invalid`,amount:1,checkout:input});
    assert.equal(init.status,200); assert.equal(paymentAmount,250000);
    const calls = providerCalls;
    const repeated = await api("/payments/paystack/init",{email:`${prefix}@test.invalid`,amount:99999,checkout:input});
    assert.equal(repeated.body.reference,init.body.reference); assert.equal(providerCalls,calls);
    const changed = await api("/uc/orders",{...input,lineItems:[{productId:cart[0]!.productId,quantity:2}],paymentMethod:"paystack",paymentReference:init.body.reference});
    assert.equal(changed.status,422);
    const event = {event:"charge.success",data:{reference:init.body.reference,amount:250000,currency:"KES"}};
    const signature = createHmac("sha512","fixture-key").update(JSON.stringify(event)).digest("hex");
    const hook = await api("/payments/paystack/webhook",event,false,{"x-paystack-signature":signature});
    assert.equal(hook.status,200);
    const posts = remotePosts.length;
    const confirm = await api("/uc/orders",{...input,paymentMethod:"paystack",paymentReference:init.body.reference});
    assert.equal(confirm.status,200); assert.equal(confirm.body.total,"2500"); assert.equal(remotePosts.length,posts);
    const wrong = fixture();
    const row = await prepareCheckoutOrder(wrong as any,String(uid),"paystack");
    await bindCheckoutPayment(row.id,"wrong-amount",{reference:"wrong-amount"});
    paymentAmount=1;
    assert.equal((await api("/uc/orders",{...wrong,paymentMethod:"paystack",paymentReference:"wrong-amount"})).status,402);
    delete process.env.PAYSTACK_SECRET_KEY;
  });
  it("creates zero-payable app orders without a provider and confirms retries without retired Woo writes", async () => {
    const code = await promo("checkout_discount",2000);
    const free = await api("/uc/orders",{...fixture(randomUUID(),{promoCode:code}),paymentMethod:"free",paymentReference:""});
    assert.equal(free.status,200); assert.equal(free.body.total,"0");
    assert.equal((await api("/uc/orders",{...fixture(),paymentMethod:"free"})).status,422);
    const pending = await prepareCheckoutOrder(fixture() as any,String(uid),"cod");
    failRemote = true;
    const confirmed = await confirmCheckoutOrder(pending.id,"");
    assert.equal(confirmed.order.checkout_state,"confirmed");
    assert.notEqual(confirmed.reconciliationRequired,true);
    const calls = remotePosts.length;
    failRemote = false;
    const recovered = await confirmCheckoutOrder(pending.id,"");
    assert.equal(recovered.order.checkout_state,"confirmed"); assert.equal(remotePosts.length,calls);
    assert.equal(recovered.order.id,confirmed.order.id);
    assert.equal(remotePosts.length,0);
  });
  it("saves free-test entitlements atomically, replays safely and preserves ordinary bookings and notification jobs", async () => {
    const notifications: PhysicalTestNotification[] = [];
    setPhysicalTestNotificationSenderForTests(async input => { notifications.push(input); });
    async function assessment(userId: number) {
      const id = randomUUID(), ticket = randomUUID();
      await pool.query(`INSERT INTO instant_water_assessments
        (id,reference,customer_user_id,first_name,normalized_phone,consent_given,consent_version,country,area,source,concern,setting,raw_answers,rules_version,result,lifecycle_status,physical_request_state)
        VALUES($1,$2,$3,'Amina','+254712345678',true,'v1','Kenya','Nairobi','borehole','safety','home','{}','v1','{}','instant_result_ready','instant_result_ready')`,
        [id,`WT-${randomUUID()}`,String(userId)]);
      await pool.query("INSERT INTO instant_water_check_tickets(id,assessment_id,country,area,service_state) VALUES($1,$2,'Kenya','Nairobi','instant_result_ready')",[ticket,id]);
      return {assessmentId:id,userId:String(userId),serviceAddress:"Test address",preferredContactTime:"Morning",acknowledgement:true,idempotencyKey:randomUUID()};
    }
    const input = {...await assessment(uid),promoCode:codes.test};
    const replies = await Promise.all([requestPhysicalTest(input),requestPhysicalTest(input)]);
    assert.deepEqual(replies[0],replies[1]); assert.equal(replies[0].freeWaterTest,true);
    const ticket = await pool.query("SELECT free_water_test,promo_code FROM instant_water_check_tickets WHERE assessment_id=$1",[input.assessmentId]);
    assert.equal(ticket.rows[0].free_water_test,true); assert.equal(ticket.rows[0].promo_code,codes.test);
    const uses = await pool.query("SELECT count(*)::int AS n FROM uc_promotion_uses WHERE user_id=$1 AND operation='water_test'",[uid]);
    assert.equal(uses.rows[0].n,1);
    assert.equal(notifications.length,1); assert.equal(notifications[0].freeWaterTest,true);
    await assert.rejects(requestPhysicalTest({...await assessment(uid),promoCode:codes.test}),/inactive|expired|exhausted|ineligible/);
    const ordinary = await requestPhysicalTest(await assessment(otherId)); assert.equal(ordinary.freeWaterTest,false);
    assert.equal(notifications.length,2); assert.equal(notifications[1].freeWaterTest,false);
    setPhysicalTestNotificationSenderForTests();
  });
});