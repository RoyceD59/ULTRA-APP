import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { checkoutQuote, claimReferralBenefit, type Fulfillment } from "./checkout-pricing.js";
import { consumePromotionOnClient } from "./reward-promotions.js";
import { validateCodShipping, validatePhone } from "./order-validation.js";
import { validateCustomerContact } from "@workspace/api-zod/customer-contact";
import { orderEvidence } from "./order-evidence.js";
import { hasWCCredentials, wcFetchArray, wcCreateCheckoutOrder } from "../routes/uc.js";
import { orderReceiptSerial } from "@workspace/api-zod/order-receipt";
import { reserveCompanionInventory } from "./companion-catalogue.js";

export interface CheckoutInput {
  lineItems: { productId: number; quantity: number; variationId?: number; childSku?: string }[];
  fulfillment: Fulfillment;
  promoCode?: string;
  applyReferralDiscount?: boolean;
  shippingAddress: Record<string, string>;
  idempotencyKey: string;
  quotedTotal?: number;
}
function fingerprint(input: CheckoutInput, method: string) {
  return createHash("sha256").update(JSON.stringify({
    items: input.lineItems, fulfillment: input.fulfillment, code: input.promoCode?.trim().toUpperCase() || "",
    referral: input.applyReferralDiscount === true, address: input.shippingAddress, method,
  })).digest("hex");
}

/** A pending order and its benefit are created together BEFORE requesting money.
 * It is the immutable payment/recovery identity, not a new order on each retry. */
export async function prepareCheckoutOrder(input: CheckoutInput, userId: string, method: string) {
  if (Array.isArray(input?.lineItems) &&
      input.lineItems.some(line => line?.variationId !== undefined || line?.childSku !== undefined) &&
      input.fulfillment !== "collection" && input.fulfillment !== "delivery") {
    throw new Error("Refresh your cart and choose delivery or collection in the updated variant checkout.");
  }
  if (!input || typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim().length < 8 ||
      input.idempotencyKey.length > 200) throw new Error("A checkout retry key is required");
  const address = input.shippingAddress;
  const contact = validateCustomerContact({ phone: address?.phone, address: address?.address1, country: address?.country });
  if (!contact.ok) throw Object.assign(new Error(Object.values(contact.fields).join(" ")), {
    fields: { ...contact.fields, ...(contact.fields.address ? { address1: contact.fields.address } : {}) },
  });
  if (!address || typeof address.firstName !== "string" || !address.firstName.trim() ||
      typeof address.phone !== "string" || !validatePhone(address.phone, address.country).valid) throw new Error("A name and valid contact phone are required");
  if (input.fulfillment === "delivery" && (!address.address1?.trim() || !address.city?.trim())) throw new Error("Delivery address and city are required");
  if (method === "cod" && !validateCodShipping(address).ok) throw new Error("Please check your contact details");
  if (!["cod", "free", "paystack", "mpesa", "stripe"].includes(method)) throw new Error("Unsupported payment method");
  input = { ...input, shippingAddress: { ...address, address1: contact.address, phone: contact.phone! } };
  const hash = fingerprint(input, method);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [userId, input.idempotencyKey]);
    const retired = await client.query("SELECT id FROM uc_checkout_retirements WHERE user_id=$1 AND idempotency_key=$2", [userId, input.idempotencyKey]);
    if (retired.rows[0]) throw new Error("This checkout was safely retired; refresh your checkout before submitting.");
    await client.query("SELECT pg_advisory_xact_lock(862,hashtext($1))", [userId]);
    const prior = await client.query("SELECT * FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2", [userId, input.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].status === "cancelled") throw new Error("This checkout was cancelled; start a new checkout");
      if (prior.rows[0].checkout_snapshot?.hash !== hash) throw new Error("Checkout changed after payment began. Complete or resolve the original payment before starting another.");
      await client.query("COMMIT");
      return prior.rows[0];
    }
    const customerId = Number(userId);
    const account = Number.isInteger(customerId) && customerId > 0
      ? await client.query("SELECT email,phone,address FROM uc_users WHERE id=$1 AND deleted_at IS NULL", [customerId]) : null;
    if (account && !account.rows[0]) throw new Error("Customer account is unavailable");
    if (account && !validateCustomerContact(account.rows[0]).ok) throw new Error("Complete your account phone and contact address before checkout.");
    const pricing = await checkoutQuote({ ...input, code: input.promoCode }, Number.isInteger(customerId) && customerId > 0 ? customerId : undefined);
    if (input.quotedTotal !== undefined && (!Number.isFinite(input.quotedTotal) || Math.abs(input.quotedTotal - pricing.total) > 0.001)) {
      throw new Error("Prices changed; refresh your checkout total before paying");
    }
    if (!pricing.promotion && pricing.discountPercent && method === "cod") throw new Error("Referral discounts require a paid order");
    if (!pricing.promotion && pricing.discountPercent && !pricing.referralBenefitId) {
      const priorDiscount = await client.query(`SELECT id FROM uc_orders WHERE user_id=$1 AND discount_percent>0
        AND promo_code=$2 AND checkout_snapshot IS NOT NULL AND status NOT IN ('cancelled','failed','refunded') LIMIT 1`, [userId, input.promoCode]);
      if (priorDiscount.rows[0]) throw new Error("Your first-order referral discount is already attached to an order");
    }
    if (method === "free" && pricing.total !== 0) throw new Error("This order requires payment");
    if (method !== "cod" && method !== "free" && pricing.total === 0) throw new Error("No payment is needed; confirm the free order");
    if (method === "mpesa" && !Number.isInteger(pricing.total)) throw new Error("M-Pesa requires a whole-shilling total. Choose Paystack for this checkout.");
    const normalizedAddress = { ...input.shippingAddress,
      fulfillment: input.fulfillment, subtotal: String(pricing.subtotal), shippingAmount: String(pricing.delivery),
      discountAmount: String(pricing.discountAmount) };
    const inserted = await client.query(`INSERT INTO uc_orders
      (user_id,status,total,currency,payment_method,promo_code,discount_percent,discount_amount,
        shipping_address,checkout_idempotency_key,checkout_claim_id,checkout_state,checkout_snapshot,cod_collection_status)
      VALUES($1,'pending',$2,'KES',$3,$4,$5,$6,$7,$8,$9,'payment_pending',$10,$11) RETURNING *`,
    [userId, String(pricing.total), method, input.promoCode ?? "", pricing.discountPercent, pricing.discountAmount,
      JSON.stringify(normalizedAddress), input.idempotencyKey, randomUUID(),
       JSON.stringify({ hash, input, pricing, provider: null, accountEmail: account?.rows[0]?.email,
         paymentAttemptId: randomUUID(), paymentAttempts: [], paymentNotStarted: true }), method === "cod" ? "awaiting_collection" : null]);
    const order = inserted.rows[0];
    await reserveCompanionInventory(client, order.id, pricing.lines);
    for (const line of pricing.lines) await client.query(`INSERT INTO uc_order_items(order_id,product_id,name,quantity,total,variation_id,child_sku,variant_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [order.id, line.productId, line.name, line.quantity, String(line.subtotal), line.variationId ?? null, line.childSku ?? null, line.variantLabel ?? null]);
    if (pricing.promotion) await consumePromotionOnClient(client, { quote: pricing.promotion, userId: customerId,
      operation: "checkout", actor: `customer:${customerId}`, idempotencyKey: `checkout:${input.idempotencyKey}`, operationRef: String(order.id) });
    await claimReferralBenefit(client, pricing.referralBenefitId, customerId, order.id);
    await client.query("COMMIT");
    return order;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function bindCheckoutPayment(orderId: number, reference: string, provider: unknown) {
  const result = await pool.query(`UPDATE uc_orders SET payment_reference=$2,
    checkout_snapshot=jsonb_set(checkout_snapshot,'{provider}',$3::jsonb)
    WHERE id=$1 AND status<>'cancelled' AND checkout_state<>'cancelled'
      AND (payment_reference='' OR payment_reference IS NULL OR payment_reference=$2) RETURNING id`,
    [orderId, reference, JSON.stringify(provider)]);
  if (!result.rows[0]) throw new Error("This checkout already has a payment attempt. Resume that payment instead.");
}

export async function checkoutOrderResponse(order: any) {
  const items = await pool.query("SELECT * FROM uc_order_items WHERE order_id=$1 ORDER BY id", [order.id]);
  return { id: order.wc_order_id ?? order.id, status: order.status, total: order.total, currency: order.currency,
    ...orderEvidence({ status: order.status, paymentMethod: order.payment_method, checkoutState: order.checkout_state,
      paymentConfirmedAt: order.payment_confirmed_at, wcOrderId: order.wc_order_id, codCollectionStatus: order.cod_collection_status,
      shippingAddress: order.shipping_address }),
    dateCreated: order.date_created, paymentMethod: order.payment_method, shippingAddress: order.shipping_address,
    receiptSerial: orderReceiptSerial(order.wc_order_id ?? order.id, order.date_created),
    codCollectionStatus: order.cod_collection_status ?? null,
    paymentReference: order.payment_method === "cod" ? "" : order.mpesa_receipt || order.payment_reference || "",
    fulfillment: order.shipping_address?.fulfillment, shippingAmount: Number(order.shipping_address?.shippingAmount ?? 0),
    discountAmount: Number(order.discount_amount), promoCode: order.promo_code, mpesaReceipt: order.mpesa_receipt ?? "",
    lineItems: items.rows.map(i => ({ productId: i.product_id, variationId: i.variation_id, childSku: i.child_sku, variantLabel: i.variant_label,
      name: i.name, quantity: i.quantity, total: i.total })) };
}

/** Confirmation serializes by order; unknown remote attempts are reconciliation-only. */
export async function confirmCheckoutOrder(orderId: number, reference: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM uc_orders WHERE id=$1 FOR UPDATE", [orderId]);
    let order = result.rows[0];
    if (!order?.checkout_snapshot) throw new Error("Checkout snapshot is missing");
    if (order.status === "cancelled" || order.checkout_state === "cancelled") throw new Error("This checkout was cancelled; payment requires staff reconciliation");
    if (order.payment_method !== "cod" && order.payment_method !== "free" && order.payment_reference !== reference) throw new Error("Payment reference does not belong to this checkout");
    if (order.checkout_state === "confirmed") { await client.query("COMMIT"); return { order, repeated: true }; }
    const { pricing } = order.checkout_snapshot;
    if (hasWCCredentials() && !order.wc_order_id) {
      if (["remote_attempted", "remote_unknown"].includes(order.checkout_state)) {
        const candidates = await wcFetchArray("/orders", { per_page: "100", status: "any", orderby: "date", order: "desc" });
        const matches = candidates?.filter(o => Array.isArray(o.meta_data) && (o.meta_data as any[]).some(m => m.key === "uc_checkout_claim_id" && m.value === order.checkout_claim_id));
        const matched = matches?.length === 1 ? matches[0] : undefined;
        if (!matched) { await client.query("COMMIT"); return { order, repeated: true, reconciliationRequired: true }; }
        const meta = new Map((matched.meta_data as any[]).map(m => [m.key, String(m.value)]));
        const remoteLines = Array.isArray(matched.line_items) ? matched.line_items as any[] : [];
        const expectedLines = order.checkout_snapshot.pricing.lines as any[];
        const quantities = (lines: any[], remote: boolean) => lines.reduce((map, line) => {
          const id = `${remote ? line.product_id : line.productId}:${(remote ? line.variation_id : line.variationId) || 0}`;
          map.set(id, (map.get(id) ?? 0) + Number(line.quantity)); return map;
        }, new Map<string, number>());
        const expected = quantities(expectedLines, false), actual = quantities(remoteLines, true);
        if (!Number.isFinite(Number(matched.total)) || Math.abs(Number(matched.total) - Number(order.total)) > 0.01 ||
            String(matched.currency).toUpperCase() !== order.currency || matched.payment_method !== order.payment_method ||
            meta.get("uc_account_id") !== order.user_id || meta.get("payment_reference") !== reference ||
            ["failed", "cancelled", "refunded"].includes(String(matched.status)) ||
            expected.size !== actual.size || [...expected].some(([id, quantity]) => actual.get(id) !== quantity)) {
          await client.query("COMMIT"); return { order, repeated: true, reconciliationRequired: true };
        }
        order.wc_order_id = Number(matched.id);
      } else {
        await client.query("UPDATE uc_orders SET checkout_state='remote_attempted',remote_attempted_at=now() WHERE id=$1", [orderId]);
        // Commit the attempt marker before the remote call. An interrupted
        // process can reconcile the immutable claim, but must never POST twice.
        await client.query("COMMIT");
        const payload = {
          payment_method: order.payment_method, set_paid: order.payment_method !== "cod",
          shipping: { first_name: order.shipping_address.firstName, last_name: order.shipping_address.lastName,
            address_1: order.shipping_address.address1, address_2: order.shipping_address.address2 ?? "",
            city: order.shipping_address.city, country: order.shipping_address.country, phone: order.shipping_address.phone },
           billing: { email: order.checkout_snapshot.accountEmail, first_name: order.shipping_address.firstName, last_name: order.shipping_address.lastName,
            phone: order.shipping_address.phone, country: order.shipping_address.country,
            address_1: order.shipping_address.address1, city: order.shipping_address.city },
          line_items: pricing.lines.map((line: any) => ({ product_id: line.productId, variation_id: line.variationId || 0, quantity: line.quantity, subtotal: String(line.subtotal), total: String(line.subtotal) })),
          shipping_lines: [{ method_id: pricing.fulfillment === "collection" ? "local_pickup" : "flat_rate",
            method_title: pricing.fulfillment === "collection" ? "Free collection" : "Delivery", total: String(pricing.delivery) }],
          fee_lines: pricing.discountAmount ? [{ name: `Companion ${order.promo_code || "referral reward"}`, total: String(-pricing.discountAmount), taxable: false }] : [],
          coupon_lines: [],
          meta_data: [{ key: "uc_checkout_claim_id", value: order.checkout_claim_id }, { key: "payment_reference", value: reference },
            { key: "uc_account_id", value: order.user_id }, { key: "uc_fulfillment", value: pricing.fulfillment },
            { key: "uc_promo_code", value: order.promo_code }, { key: "uc_discount_amount", value: pricing.discountAmount }],
        };
        const remote = await wcCreateCheckoutOrder(payload);
        if (!remote) {
          await pool.query("UPDATE uc_orders SET checkout_state='remote_unknown' WHERE id=$1", [orderId]);
          return { order, repeated: false, reconciliationRequired: true };
        }
        await client.query("BEGIN");
        await client.query("SELECT id FROM uc_orders WHERE id=$1 FOR UPDATE", [orderId]);
        order.wc_order_id = Number(remote.id);
        if (!Number.isFinite(Number(remote.total)) || Math.abs(Number(remote.total) - Number(order.total)) > 0.01) {
          await client.query("UPDATE uc_orders SET wc_order_id=$2,checkout_state='remote_total_mismatch' WHERE id=$1", [orderId, order.wc_order_id]);
          await client.query("COMMIT");
          return { order, repeated: false, reconciliationRequired: true };
        }
      }
    }
    if (["remote_total_mismatch", "remote_attempted", "remote_unknown"].includes(order.checkout_state)) {
      await client.query("COMMIT"); return { order, repeated: true, reconciliationRequired: true };
    }
    const updated = await client.query(`UPDATE uc_orders SET status=$2,wc_order_id=$3,checkout_state='confirmed',
      payment_confirmed_at=CASE WHEN payment_method='cod' THEN payment_confirmed_at ELSE COALESCE(payment_confirmed_at,now()) END,
      webhook_recovery=false WHERE id=$1 RETURNING *`,
      [orderId, order.payment_method === "cod" ? "pending" : "processing", order.wc_order_id ?? null]);
    await client.query("COMMIT");
    return { order: updated.rows[0], repeated: false };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
