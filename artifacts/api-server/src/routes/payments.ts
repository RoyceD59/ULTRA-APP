import { Router, type Request, type Response } from "express";
import { createHmac, randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import { ucOrdersTable, mpesaStkInitiationsTable, teamSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptSecret } from "../lib/secret-crypto.js";
import type Stripe from "stripe";
import { sendViaResend } from "../lib/resend.js";
import { sendSms } from "../lib/sms.js";
import { buildOrderReceiptEmail } from "../lib/email.js";
import { paymentLimiter } from "../lib/rate-limiters.js";
import { enqueueReferralSettlement } from "./referrals.js";

async function enqueueReferralSettlementIfReady(order: { id: number; userId: string; webhookRecovery: boolean }): Promise<void> {
  // Provider recovery rows carry an email/phone placeholder until /uc/orders
  // validates account ownership and catalogue lines. Avoid an extra callback
  // query (and any lock wait); finalized app orders always use numeric account
  // IDs, while the maintenance scan independently verifies their item rows.
  const accountId = Number(order.userId);
  if (!order.webhookRecovery && Number.isInteger(accountId) && accountId > 0) {
    await enqueueReferralSettlement(order.id);
  }
}

/**
 * Send a recovery-order alert to the team via email (primary) and SMS (fallback).
 * The email is fire-and-forget; SMS fires unconditionally so the team is reached
 * even when Resend is temporarily unavailable.
 *
 * The team phone number is read from the DB (team_settings.team_alert_phone) first,
 * falling back to the TEAM_ALERT_PHONE env var so existing deployments are unaffected.
 * Changes made through the admin panel take effect immediately (60-second cache TTL).
 */
/** @internal Exported so unit tests can call it directly without an HTTP server. */
export function alertTeamRecoveryOrder(params: {
  subject:  string;
  body:     string;
  smsText:  string;
  template: string;
  orderId:  number;
}): void {
  const { subject, body, smsText, template, orderId } = params;

  // Primary: email
  sendViaResend({
    from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
    to:      "info@ucfilters.com",
    subject,
    text:    body,
    meta:    { template, orderId },
  }).catch(() => { /* already logged inside sendViaResend */ });

  // Fallback: SMS (fires regardless of email success so the team is reached
  // even when Resend is down). Phone is resolved from DB first, then env var.
  getTeamAlertPhone().then((teamPhone) => {
    if (teamPhone) {
      sendSms(teamPhone, smsText, { template, orderId }).catch(() => {});
    }
  }).catch(() => {});
}

// Exported so tests can import the live set instead of duplicating it.
// ResultCodes representing definitive user declines — showing "Try again" would
// be confusing or pointless for these outcomes.
//   "1"    → insufficient funds (customer must top up)
//   "1032" → customer cancelled / dismissed the prompt
//   "2001" → wrong PIN entered
export const NON_RETRIABLE_CODES = new Set(["1", "1032", "2001"]);

const router = Router();

// ─── M-Pesa webhook secret — DB-backed with env-var fallback ──────────────────
// The secret is read at request time so admins can rotate it from the admin
// panel without restarting the server. A short in-process cache (60 s TTL) keeps
// the per-request DB cost negligible.

interface SecretCache {
  value: string | null;
  expiresAt: number;
}
let _mpesaSecretCache: SecretCache | null = null;

export async function getMpesaWebhookSecret(): Promise<string | null> {
  const now = Date.now();
  if (_mpesaSecretCache && _mpesaSecretCache.expiresAt > now) {
    return _mpesaSecretCache.value;
  }

  let value: string | null = null;

  try {
    const [row] = await db
      .select({ mpesaWebhookSecretEnc: teamSettingsTable.mpesaWebhookSecretEnc })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    if (row?.mpesaWebhookSecretEnc) {
      value = decryptSecret(row.mpesaWebhookSecretEnc);
      if (value === null) {
        console.error(
          "[M-Pesa] Failed to decrypt DB webhook secret — falling back to env var"
        );
      }
    }
  } catch (err) {
    console.error("[M-Pesa] DB read for webhook secret failed — falling back to env var:", err);
  }

  // Env-var fallback (backwards-compat for existing deployments)
  if (value === null) {
    value = process.env["MPESA_WEBHOOK_SECRET"] ?? null;
  }

  // Cache for 60 seconds
  _mpesaSecretCache = { value, expiresAt: now + 60_000 };
  return value;
}

// Expose a cache-bust helper so the admin settings route can invalidate after a rotation.
export function invalidateMpesaSecretCache(): void {
  _mpesaSecretCache = null;
}

// ─── Team alert phone — DB-backed with env-var fallback ───────────────────────
// Read at alert time so admins can update the number from the admin panel without
// restarting the server. A short in-process cache (60 s TTL) keeps DB cost negligible.

let _teamAlertPhoneCache: SecretCache | null = null;

export async function getTeamAlertPhone(): Promise<string | null> {
  const now = Date.now();
  if (_teamAlertPhoneCache && _teamAlertPhoneCache.expiresAt > now) {
    return _teamAlertPhoneCache.value;
  }

  let value: string | null = null;

  try {
    const [row] = await db
      .select({ teamAlertPhone: teamSettingsTable.teamAlertPhone })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    if (row?.teamAlertPhone) {
      value = row.teamAlertPhone;
    }
  } catch (err) {
    console.error("[payments] DB read for team alert phone failed — falling back to env var:", err);
  }

  // Env-var fallback (backwards-compat for existing deployments)
  if (value === null) {
    value = process.env["TEAM_ALERT_PHONE"] ?? null;
  }

  // Cache for 60 seconds
  _teamAlertPhoneCache = { value, expiresAt: now + 60_000 };
  return value;
}

export function invalidateTeamAlertPhoneCache(): void {
  _teamAlertPhoneCache = null;
}

// ─── Stripe feature flag ──────────────────────────────────────────────────────
// Card payments are switchable without deleting the secret key: set
// STRIPE_ENABLED=false to hide the option in the app and reject session
// creation server-side. The team asked for Stripe to stay off until their
// Stripe account is connected to the WooCommerce store.
export function stripeEnabled(): boolean {
  return process.env["STRIPE_ENABLED"] !== "false";
}

// Lazy Stripe — only when STRIPE_SECRET_KEY is present
let _stripe: Stripe | null = null;
async function getStripe(): Promise<Stripe | null> {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  if (!_stripe) {
    const StripeSDK = await import("stripe");
    _stripe = new StripeSDK.default(key);
  }
  return _stripe;
}

// ─── M-Pesa credential validation ─────────────────────────────────────────────
// Daraja shortcodes are numeric (Paybill/Till numbers, e.g. sandbox 174379).
// Placeholder values like "NA" must route checkout to demo mode instead of
// sending doomed STK pushes to Safaricom that fail with "Invalid BusinessShortCode".
export function getMpesaShortcode(): string | null {
  const sc = process.env["MPESA_SHORTCODE"]?.trim();
  return sc && /^\d{4,10}$/.test(sc) ? sc : null;
}

// ─── Payment method availability ──────────────────────────────────────────────
// Server-driven config so the mobile app only shows methods that can actually
// process a payment. M-Pesa stays visible even in demo mode (mock flow works);
// Stripe is hidden entirely when deactivated.
router.get("/payments/config", (_req: Request, res: Response): void => {
  res.json({
    methods: {
      paystack: true,
      mpesa: true,
      stripe: stripeEnabled() && !!process.env["STRIPE_SECRET_KEY"],
      cod: true,
    },
    mpesaMode: getMpesaShortcode() && process.env["MPESA_PASSKEY"] ? "live" : "demo",
  });
});

// ─── M-Pesa Daraja ────────────────────────────────────────────────────────────
async function getMpesaToken(): Promise<string | null> {
  const key = process.env["MPESA_CONSUMER_KEY"];
  const secret = process.env["MPESA_CONSUMER_SECRET"];
  if (!key || !secret) return null;
  try {
    const creds = Buffer.from(`${key}:${secret}`).toString("base64");
    const env = process.env["MPESA_ENV"] === "production" ? "api" : "sandbox";
    const res = await fetch(
      `https://${env}.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${creds}` } }
    );
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

router.post("/payments/mpesa", paymentLimiter, async (req: Request, res: Response): Promise<void> => {
  const { phone, amount, orderId } = req.body as {
    phone: string;
    amount: number;
    orderId: string;
  };
  if (!phone || !amount) {
    res.status(400).json({ error: "phone and amount required" });
    return;
  }

    const shortcode = getMpesaShortcode();
    const passkey = process.env["MPESA_PASSKEY"];
    const token = shortcode && passkey ? await getMpesaToken() : null;

  const normalizedPhone = phone.replace(/^\+/, "").replace(/^0/, "254");
  const expectedAmount  = Math.ceil(amount);
  const expiresAt       = new Date(Date.now() + 15 * 60 * 1000); // 15-minute window

  if (!token || !shortcode || !passkey) {
    // Sandbox / demo mode — generate a mock CheckoutRequestID.
    // Use randomUUID so two concurrent demo-mode initiations in the same
    // millisecond never collide on the checkoutRequestId unique index.
    const mockCheckoutRequestId = `ws_CO_${randomUUID()}`;
    const mockCallbackToken = randomUUID();

    // Persist the initiation record BEFORE issuing the CheckoutRequestID.
    // If this fails, we must NOT return a CheckoutRequestID — without the record
    // the callback cannot verify ownership and any payment would be unrecoverable.
    try {
      await db.insert(mpesaStkInitiationsTable).values({
        checkoutRequestId: mockCheckoutRequestId,
        expectedAmount,
        phone: normalizedPhone,
        callbackToken: mockCallbackToken,
        expiresAt,
      }).onConflictDoNothing();
    } catch (err) {
      console.error("[M-Pesa] Failed to persist initiation record — cannot issue STK push:", err);
      res.status(500).json({
        error: "Checkout temporarily unavailable — please try again",
        retryable: true,
      });
      return;
    }

    res.json({
      checkoutRequestId: mockCheckoutRequestId,
      merchantRequestId: `MR-${Date.now()}`,
      responseCode: "0",
      responseDescription: "Success. Request accepted for processing",
      customerMessage: `Please check your phone (${phone}) and enter your M-Pesa PIN to complete payment of KES ${amount.toLocaleString()}.`,
    });
    return;
  }

  try {
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
      const env = process.env["MPESA_ENV"] === "production" ? "api" : "sandbox";

    // Generate a per-push callback token (UUID).  This is embedded in the
    // CallBackURL as ?token=<callbackToken> and stored in the initiation record.
    // Using a per-push token instead of the long-lived shared secret limits
    // exposure: each token is tied to exactly one STK push and expires with the
    // initiation record, so a token captured in access logs cannot be reused
    // across pushes or after the 15-minute window.
    const callbackToken = randomUUID();

    const apiBase =
      process.env["API_BASE_URL"] ??
      (process.env["REPLIT_DEV_DOMAIN"]
        ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
        : "https://team-horizon--jerryaroyce.replit.app");
    // NOTE: Safaricom echoes the CallBackURL verbatim and does not support
    // custom request headers, so the token must be a query parameter.
    const callbackUrl = `${apiBase}/api/payments/mpesa/callback?token=${encodeURIComponent(callbackToken)}`;

    const stkRes = await fetch(
      `https://${env}.safaricom.co.ke/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: expectedAmount,
          PartyA: normalizedPhone,
          PartyB: shortcode,
          PhoneNumber: normalizedPhone,
          CallBackURL: callbackUrl,
          AccountReference: `Order-${orderId}`,
          TransactionDesc: "UC Filter Purchase",
        }),
      }
    );
    const stkData = (await stkRes.json()) as Record<string, string>;
    const checkoutRequestId = stkData["CheckoutRequestID"];

    if (!checkoutRequestId) {
      console.error("[M-Pesa] STK push failed — Safaricom response:", JSON.stringify(stkData), "HTTP status:", stkRes.status);
      res.status(500).json({ error: "M-Pesa request failed — no checkout reference", retryable: true });
      return;
    }

    // Persist the initiation record immediately.
    // If this fails, do NOT return the CheckoutRequestID — without the record the
    // callback cannot verify ownership and any payment made on this push would be
    // unrecoverable.  The client should retry; the next attempt will succeed if the
    // DB is healthy.  The team is alerted so the (expired) push can be monitored.
    try {
      await db.insert(mpesaStkInitiationsTable).values({
        checkoutRequestId,
        expectedAmount,
        phone: normalizedPhone,
        callbackToken,
        expiresAt,
      }).onConflictDoNothing();
    } catch (err) {
      console.error(
        `[M-Pesa] CRITICAL: STK push sent (ref=${checkoutRequestId}) but initiation record failed to persist:`,
        err,
      );
      // Alert team — the push was sent but can't be recovered by the callback.
      sendViaResend({
        from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
        to:      "info@ucfilters.com",
        subject: `⚠️ M-Pesa push ${checkoutRequestId} sent but NOT tracked — manual check needed`,
        text: [
          "An M-Pesa STK push was accepted by Safaricom but the correlation record",
          "could not be saved to the database (database error).",
          "If the customer pays, the callback will reject it as unrecognised.",
          "",
          `Checkout Ref: ${checkoutRequestId}`,
          `Amount:       KES ${expectedAmount}`,
          `Phone:        ${normalizedPhone}`,
          "",
          "Action: check M-Pesa Business Console and fulfil manually if payment received.",
        ].join("\n"),
        meta: { template: "mpesa_tracking_alert" },
      }).catch(() => {});
      res.status(500).json({ error: "Checkout error — please try again", retryable: true });
      return;
    }

    res.json({
      checkoutRequestId,
      merchantRequestId: stkData["MerchantRequestID"],
      responseCode: stkData["ResponseCode"],
      responseDescription: stkData["ResponseDescription"],
      customerMessage: stkData["CustomerMessage"],
    });
  } catch {
    res.status(500).json({ error: "M-Pesa request failed", retryable: true });
  }
});

router.get(
  "/payments/mpesa/status/:checkoutRequestId",
  async (req: Request, res: Response): Promise<void> => {
    const shortcode = getMpesaShortcode();
    const passkey = process.env["MPESA_PASSKEY"];
    const token = shortcode && passkey ? await getMpesaToken() : null;

    if (!token || !shortcode || !passkey) {
      res.json({ status: Math.random() > 0.4 ? "success" : "pending" });
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
      const env = process.env["MPESA_ENV"] === "production" ? "api" : "sandbox";

      const qRes = await fetch(
        `https://${env}.safaricom.co.ke/mpesa/stkpushquery/v1/query`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: req.params["checkoutRequestId"],
          }),
        }
      );
      const qData = (await qRes.json()) as Record<string, string>;

      // Safaricom returns an error response (HTTP 4xx, no ResultCode) while the
      // STK push is still being processed by the customer. Only a completed
      // transaction includes a ResultCode in the body.
      //
      // ResultCode "0"    → paid successfully
      // ResultCode "1"    → insufficient funds — permanent (customer must top up)
      // ResultCode "1032" → customer cancelled / dismissed the prompt — deliberate action
      // ResultCode "2001" → wrong PIN entered — permanent (hint: use Safaricom app)
      // ResultCode "1037" → DS Timeout (network couldn't reach the handset) — transient, retryable
      // Any other code    → treat as transient/retryable unless we know better
      // No ResultCode     → still in progress (pending)
      //
      // IMPORTANT: Only mark retriable=false for codes that represent a definitive
      // user action or hard decline.  Transient network codes should stay retriable=true
      // so the client offers "Try again" rather than a silent dead end.
      const resultCode = qData["ResultCode"];
      if (!resultCode) {
        // Transaction still in progress — keep polling
        res.json({ status: "pending", resultDesc: qData["errorMessage"] ?? "Processing" });
        return;
      }
      if (resultCode === "0") {
        res.json({ status: "success", resultDesc: qData["ResultDesc"] });
        return;
      }
      res.json({
        status: "failed",
        resultDesc: qData["ResultDesc"],
        // retriable=true → transient error (network timeout, unknown code) — show "Try again / COD"
        // retriable=false → definitive decline (wrong PIN, user cancelled) — show dismissal + hint
        retriable: !NON_RETRIABLE_CODES.has(resultCode),
      });
    } catch {
      res.json({ status: "pending" });
    }
  }
);

// ─── Stripe — Checkout Session (PCI-safe: Stripe hosts the card form) ─────────
// Frontend opens the sessionUrl in expo-web-browser; Stripe handles all card data.
router.post(
  "/payments/stripe/session",
  paymentLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { amount, currency = "kes", orderId, returnUrl } = req.body as {
      amount: number;
      currency: string;
      orderId: string;
      returnUrl?: string;
    };
    if (!amount) {
      res.status(400).json({ error: "amount required" });
      return;
    }

    if (!stripeEnabled()) {
      res.status(503).json({ error: "Card payments are currently unavailable. Please use Paystack, M-Pesa, or Cash on Delivery." });
      return;
    }

    const stripe = await getStripe();
    if (!stripe) {
      // Mock: return a fake hosted-checkout URL for demo
      res.json({
        sessionId: `cs_mock_${Date.now()}`,
        sessionUrl: `https://checkout.stripe.com/mock?amount=${amount}&currency=${currency}`,
        amount,
      });
      return;
    }

    try {
      const appBase =
        returnUrl ?? process.env["WC_BASE_URL"] ?? "https://www.ucfilters.com";
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency,
              unit_amount: Math.round(amount * 100),
              product_data: { name: `UC Filters Order ${orderId}` },
            },
            quantity: 1,
          },
        ],
        success_url: `${appBase}/stripe/success?session_id={CHECKOUT_SESSION_ID}&order=${orderId}`,
        cancel_url: `${appBase}/stripe/cancel?order=${orderId}`,
      });
      res.json({ sessionId: session.id, sessionUrl: session.url, amount });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message, retryable: true });
    }
  }
);

router.get(
  "/payments/stripe/session/:sessionId",
  async (req: Request, res: Response): Promise<void> => {
    const stripe = await getStripe();
    if (!stripe) {
      res.json({ status: "paid", paymentStatus: "paid" });
      return;
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(String(req.params["sessionId"]));
      res.json({ status: session.status, paymentStatus: session.payment_status });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

// ─── Paystack ─────────────────────────────────────────────────────────────────
router.post(
  "/payments/paystack/init",
  paymentLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { email, amount, callbackUrl } = req.body as {
      email: string;
      amount: number;
      callbackUrl?: string;
    };
    if (!email || !amount) {
      res.status(400).json({ error: "email and amount required" });
      return;
    }

    // Use the deep-link redirect the client sent (e.g. uc-companion://paystack/callback)
    // so expo-web-browser can auto-close after Paystack redirects back.
    const resolvedCallback =
      callbackUrl ??
      `${process.env["WC_BASE_URL"] ?? "https://www.ucfilters.com"}/paystack/callback`;

    const secretKey = process.env["PAYSTACK_SECRET_KEY"];
    if (!secretKey) {
      const ref = `PS_MOCK_${Date.now()}`;
      res.json({
        authorizationUrl: `https://checkout.paystack.com/mock`,
        accessCode: `mock_access_${Date.now()}`,
        reference: ref,
      });
      return;
    }

    try {
      const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: Math.round(amount * 100),
          currency: "KES",
          callback_url: resolvedCallback,
        }),
      });
      // Treat upstream 5xx / 429 as a transient outage — Paystack blips commonly
      // manifest as a non-2xx HTTP response rather than a thrown exception.
      if (!psRes.ok) {
        const isTransient = psRes.status >= 500 || psRes.status === 429;
        const status = isTransient ? 500 : 400;
        res.status(status).json({
          error: "Paystack is temporarily unavailable. Please try again.",
          ...(isTransient ? { retryable: true } : {}),
        });
        return;
      }
      const psData = (await psRes.json()) as {
        status: boolean;
        data: { authorization_url: string; access_code: string; reference: string };
      };
      if (!psData.status) {
        res.status(400).json({ error: "Paystack initialization failed" });
        return;
      }
      res.json({
        authorizationUrl: psData.data.authorization_url,
        accessCode: psData.data.access_code,
        reference: psData.data.reference,
      });
    } catch {
      res.status(500).json({ error: "Paystack is temporarily unavailable. Please try again.", retryable: true });
    }
  }
);

router.get(
  "/payments/paystack/verify/:reference",
  async (req: Request, res: Response): Promise<void> => {
    const secretKey = process.env["PAYSTACK_SECRET_KEY"];
    if (!secretKey) {
      res.json({ success: true, status: "success" });
      return;
    }
    try {
      const vRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(String(req.params["reference"]))}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      // Treat upstream 5xx / 429 as a transient outage so the client can retry
      // rather than showing "Payment Declined" for a temporary Paystack blip.
      if (!vRes.ok) {
        const isTransient = vRes.status >= 500 || vRes.status === 429;
        const status = isTransient ? 500 : 400;
        res.status(status).json({
          error: "Verification failed. Please try again.",
          ...(isTransient ? { retryable: true } : {}),
        });
        return;
      }
      const vData = (await vRes.json()) as { status: boolean; data: { status: string } };
      res.json({ success: vData.status && vData.data.status === "success", status: vData.data?.status });
    } catch {
      res.status(500).json({ error: "Verification failed. Please try again.", retryable: true });
    }
  }
);

// ─── Paystack webhook ─────────────────────────────────────────────────────────
// Paystack sends a POST with an HMAC-SHA512 signature in x-paystack-signature.
// We verify the signature before touching any data, then handle charge.success
// events idempotently so duplicate deliveries are safely ignored.
router.post(
  "/payments/paystack/webhook",
  async (req: Request, res: Response): Promise<void> => {
    const secretKey = process.env["PAYSTACK_SECRET_KEY"];

    // ── Signature verification ───────────────────────────────────────────────
    const signature = String(req.headers["x-paystack-signature"] ?? "");
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (!secretKey) {
      // Hard-reject when the secret key is not configured — processing unverified
      // events would allow any caller to forge charge.success payloads.
      console.error(
        "[Paystack webhook] PAYSTACK_SECRET_KEY is not set — rejecting request. " +
          "Configure the secret key to enable webhook processing."
      );
      res.status(503).json({
        error: "Webhook processing is not available: payment secret key is not configured.",
      });
      return;
    }

    if (!rawBody) {
      // Raw body was not captured — reject to avoid processing unverified events.
      res.status(400).json({ error: "Raw body unavailable for signature check" });
      return;
    }

    const expected = createHmac("sha512", secretKey)
      .update(rawBody)
      .digest("hex");
    if (signature !== expected) {
      // Return 401 so Paystack knows the payload was rejected; never 200 here.
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // ── Event dispatch ───────────────────────────────────────────────────────
    const event = req.body as {
      event?: string;
      data?: {
        reference?: string;
        status?: string;
        amount?: number;      // in kobo
        currency?: string;
        customer?: { email?: string };
      };
    };

    if (event.event !== "charge.success") {
      // Acknowledge events we do not act on so Paystack stops retrying them.
      res.json({ received: true });
      return;
    }

    const reference = event.data?.reference ?? "";
    const amountKobo = event.data?.amount ?? 0;
    const currency = event.data?.currency ?? "KES";
    const customerEmail = event.data?.customer?.email ?? null;

    if (!reference) {
      res.status(400).json({ error: "Missing reference in webhook payload" });
      return;
    }

    try {
      // ── Idempotency: look up existing order by payment reference ──────────
      const existing = await db
        .select()
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, reference))
        .limit(1);

      if (existing.length > 0) {
        const order = existing[0]!;

        if (order.status === "pending") {
          // Payment confirmed — advance status to processing
          await db
            .update(ucOrdersTable)
            .set({ status: "processing" })
            .where(eq(ucOrdersTable.id, order.id));
          await pool.query("UPDATE uc_orders SET payment_confirmed_at=COALESCE(payment_confirmed_at,now()) WHERE id=$1", [order.id]);
          console.info(
            `[Paystack webhook] Order ${order.id} (ref ${reference}) advanced to processing`
          );
          // The verified webhook is a paid-order boundary.  Qualification is
          // idempotent and refuses recovery/unqualified orders without items.
          await enqueueReferralSettlementIfReady(order);
        } else if (["processing", "completed", "paid"].includes(order.status)) {
          await enqueueReferralSettlementIfReady(order);
        } else {
          // Already processed — safe no-op (duplicate event)
          console.info(
            `[Paystack webhook] Duplicate event for ref ${reference} — order ${order.id} already ${order.status}`
          );
        }

        res.json({ received: true, orderId: order.id });
        return;
      }

      // ── No order found — create a recovery record ─────────────────────────
      // The app lost connectivity after payment but before createOrder fired.
      const totalKes = Math.round(amountKobo / 100);

      const [recovered] = await db
        .insert(ucOrdersTable)
        .values({
          userId:           customerEmail || "paystack-webhook-recovery",
          status:           "processing",
          total:            String(totalKes),
          currency:         currency,
          paymentMethod:    "paystack",
          paymentReference: reference,
          promoCode:        "",
          discountPercent:  0,
          discountAmount:   0,
          shippingAddress:  {},
          webhookRecovery:  true,
        })
        .returning();
      await pool.query("UPDATE uc_orders SET payment_confirmed_at=COALESCE(payment_confirmed_at,now()) WHERE id=$1", [recovered!.id]);

      console.info(
        `[Paystack webhook] Recovery order ${recovered!.id} created for ref ${reference} (${currency} ${totalKes})`
      );

      alertTeamRecoveryOrder({
        subject:  `⚠️ Webhook recovery order #${recovered!.id} needs fulfilment`,
        body: [
          "A Paystack webhook recovery order was created automatically.",
          "The customer paid but the app lost connectivity before the order was recorded.",
          "",
          `Order ID:   ${recovered!.id}`,
          `Reference:  ${reference}`,
          `Amount:     ${currency} ${totalKes.toLocaleString()}`,
          `Customer:   ${customerEmail || "(email not provided)"}`,
          "",
          "Action required:",
          "  1. Find the customer and confirm their delivery address and items.",
          "  2. Update the order with the correct line items.",
          "  3. Dispatch as normal once complete.",
          "",
          "This order is flagged as 'Webhook recovery' in the orders list.",
        ].join("\n"),
        smsText:  `UCFilters: Paystack recovery order #${recovered!.id} needs fulfilment. Ref: ${reference}. Customer: ${customerEmail || "unknown"}. Check admin panel.`,
        template: "payment_recovery_alert",
        orderId:  recovered!.id,
      });

      res.json({ received: true, orderId: recovered!.id, recovered: true });
    } catch (err) {
      // ── Unique-constraint violation: concurrent webhook retry ─────────────
      // Two retries can both miss the existing-order lookup and race to insert.
      // The loser gets Postgres error 23505.  Re-read the winner's row and
      // return 200 so Paystack stops retrying rather than getting a 500.
      // DrizzleQueryError wraps the pg error in `.cause`; check both locations.
      const _pgCode =
        (err as { code?: string }).code ??
        (err as { cause?: { code?: string } }).cause?.code;
      if (_pgCode === "23505") {
        try {
          const [winner] = await db
            .select()
            .from(ucOrdersTable)
            .where(eq(ucOrdersTable.paymentReference, reference))
            .limit(1);
          if (winner) {
            console.info(
              `[Paystack webhook] Concurrent duplicate resolved — existing recovery order ${winner.id}`
            );
            res.json({ received: true, orderId: winner.id, recovered: true });
            return;
          }
        } catch (rerr) {
          console.error("[Paystack webhook] Failed to re-read order after unique-constraint conflict:", rerr);
        }
      }
      console.error("[Paystack webhook] DB error:", err);
      // Return 500 so Paystack will retry — better to retry than to lose the event.
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// ─── M-Pesa STK-push callback (Safaricom posts here after the customer pays) ──
// Safaricom POSTs to CallBackURL with ResultCode 0 on success.
// If the app closed during the STK-push wait the polling loop never resolved,
// so this callback is the only recovery path for orders where the customer paid
// but the app did not see the result.
//
// Security: Safaricom does not sign callbacks with HMAC.  To prevent any
// internet client from forging a "paid" callback (triggering fulfilment without
// an actual payment), we independently query the Daraja STK query API to
// confirm payment before touching the database.
//   - Daraja confirms ResultCode 0  → proceed.
//   - Daraja returns non-0 / unknown → log + ack without any DB action.
//   - Daraja unavailable (network / token failure) → log warning + fall through
//     (we cannot silently drop a potentially valid payment in a transient outage).
//   - Daraja credentials absent (sandbox / dev) → fall through without verify.
//
// Strategy (mirrors the Paystack webhook):
//   1. ResultCode from Safaricom !== 0 → log and ack; no order action.
//   2. Daraja verification → reject if Daraja does not confirm payment.
//   3. Existing order found by paymentReference (CheckoutRequestID):
//        - Atomic UPDATE WHERE status='pending' wins race → send customer email.
//        - UPDATE matched 0 rows → already advanced; ack silently.
//   4. No existing order → create a recovery record + alert the team.
//   5. Unique-constraint race on insert → ack (concurrent callback handled).
//   Always respond with { ResultCode: 0, ResultDesc: "Accepted" } — Safaricom
//   does not retry cleanly on non-200 or error-ResultCode responses.

/**
 * Independently verify a completed M-Pesa STK payment via the Daraja query API.
 * Returns:
 *   "confirmed"   — Daraja says ResultCode 0 (payment succeeded).
 *   "rejected"    — Daraja returned non-0 or unrecognized reference.
 *   "unavailable" — credentials missing or API call failed (transient).
 */
export async function verifyMpesaPaymentOnDaraja(
  checkoutRequestId: string
): Promise<"confirmed" | "rejected" | "unavailable"> {
  const token     = await getMpesaToken();
  const shortcode = process.env["MPESA_SHORTCODE"];
  const passkey   = process.env["MPESA_PASSKEY"];

  if (!token || !shortcode || !passkey) return "unavailable";

  try {
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password  = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const env       = process.env["MPESA_ENV"] === "production" ? "api" : "sandbox";

    const qRes = await fetch(
      `https://${env}.safaricom.co.ke/mpesa/stkpushquery/v1/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password:          password,
          Timestamp:         timestamp,
          CheckoutRequestID: checkoutRequestId,
        }),
      }
    );
    const qData = (await qRes.json()) as Record<string, string>;
    return qData["ResultCode"] === "0" ? "confirmed" : "rejected";
  } catch {
    return "unavailable";
  }
}

router.post("/payments/mpesa/callback", async (req: Request, res: Response): Promise<void> => {
  // Always ack — Safaricom retries are unreliable on non-200 responses.
  const ack = (extra?: Record<string, unknown>) =>
    res.json({ ResultCode: 0, ResultDesc: "Accepted", ...extra });

  // ── Callback-token verification ─────────────────────────────────────────
  // Safaricom does not sign callbacks with HMAC, but it echoes the exact
  // CallBackURL verbatim (query params included).  We embed a per-push UUID
  // (callbackToken, stored in mpesa_stk_initiations) as ?token=<uuid> when
  // initiating the push, then validate it here against the stored value.
  // Using a per-push token instead of the long-lived shared secret limits
  // exposure: each token is valid for one STK push only and expires with the
  // initiation record.
  // An Authorization: Bearer <token> header is also accepted for curl/Postman.
  // Legacy rows (no callbackToken in DB) fall back to the shared secret.
  {
    const authHeader  = String(req.headers["authorization"] ?? "");
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : String(req.query["token"] ?? "");

    // Peek at the body (already parsed by express.json) to get the
    // CheckoutRequestID so we can look up the per-push token.
    const peekId = (req.body as {
      Body?: { stkCallback?: { CheckoutRequestID?: string } };
    })?.Body?.stkCallback?.CheckoutRequestID;

    // Fail-closed in production when no secret is configured at all.
    const webhookSecret = await getMpesaWebhookSecret();
    const requireSignature =
      process.env["MPESA_WEBHOOK_REQUIRED_SIGNATURE"] === "true" ||
      (process.env["NODE_ENV"] === "production" && !webhookSecret);

    if (peekId) {
      // We have a CheckoutRequestID — verify against the per-push token stored
      // in the initiation record (primary path for all new-style pushes).
      const [initRow] = await db
        .select({ callbackToken: mpesaStkInitiationsTable.callbackToken })
        .from(mpesaStkInitiationsTable)
        .where(eq(mpesaStkInitiationsTable.checkoutRequestId, peekId))
        .limit(1);

      const perPushToken = initRow?.callbackToken ?? null;

      if (perPushToken !== null) {
        // Per-push token path: the token must match exactly.
        if (bearerToken !== perPushToken) {
          console.warn(
            `[M-Pesa callback] ⚠️  Invalid per-push callback token for ref ${peekId} — request rejected.`
          );
          res.status(401).json({ error: "Invalid signature" });
          return;
        }
      } else if (webhookSecret) {
        // Legacy row (created before callbackToken column) — fall back to
        // shared-secret comparison so existing rows still work after the upgrade.
        if (bearerToken !== webhookSecret) {
          console.warn(
            "[M-Pesa callback] ⚠️  Invalid bearer token (legacy shared-secret path) — request rejected."
          );
          res.status(401).json({ error: "Invalid signature" });
          return;
        }
      } else {
        // No initiation record token AND no shared secret configured.
        console.warn(
          "[M-Pesa callback] ⚠️  SECURITY WARNING: no callback token and no shared secret — verification DISABLED."
        );
        if (requireSignature) {
          res.status(403).json({
            error: "Webhook signature verification is required but no secret key is configured.",
          });
          return;
        }
      }
    } else if (webhookSecret) {
      // No CheckoutRequestID in body (malformed request) — fall back to the
      // shared secret so the handler can still reject outright bad requests.
      if (bearerToken !== webhookSecret) {
        console.warn(
          "[M-Pesa callback] ⚠️  Invalid or missing bearer token — request rejected."
        );
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    } else {
      // No CheckoutRequestID and no shared secret — open endpoint.
      console.warn(
        "[M-Pesa callback] ⚠️  SECURITY WARNING: M-Pesa webhook secret is not set. " +
          "Callback token verification is DISABLED. " +
          "Set it in Admin → Payment Settings or via MPESA_WEBHOOK_SECRET to enable it."
      );
      if (requireSignature) {
        res.status(403).json({
          error: "Webhook signature verification is required but no secret key is configured.",
        });
        return;
      }
    }
  }

  try {
    const body = req.body as {
      Body?: {
        stkCallback?: {
          ResultCode?: number;
          ResultDesc?: string;
          CheckoutRequestID?: string;
          MerchantRequestID?: string;
          CallbackMetadata?: {
            Item?: Array<{ Name: string; Value?: string | number }>;
          };
        };
      };
    };

    const cb = body?.Body?.stkCallback;
    if (!cb) { ack(); return; }

    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = cb;

    // ── Step 1: only act on payments Safaricom reports as successful ─────────
    if (ResultCode !== 0) {
      console.warn(`[M-Pesa callback] Payment not successful: ${ResultDesc} (${CheckoutRequestID})`);
      ack();
      return;
    }

    if (!CheckoutRequestID) {
      console.error("[M-Pesa callback] ResultCode 0 but no CheckoutRequestID — cannot process");
      ack();
      return;
    }

    // ── Step 2: Daraja verification — reject unrecognized / forged callbacks ─
    const darajaResult = await verifyMpesaPaymentOnDaraja(CheckoutRequestID);

    if (darajaResult === "rejected") {
      // Daraja does not recognise this reference as a successful payment.
      // This is the expected response for a forged or replayed callback.
      console.warn(
        `[M-Pesa callback] Daraja verification rejected ref ${CheckoutRequestID} — callback not actioned`
      );
      ack();
      return;
    }

    // ── Step 3: extract metadata items (amount, receipt, phone) ──────────────
    const metaItems = CallbackMetadata?.Item ?? [];
    const getMeta = (name: string) => metaItems.find((i) => i.Name === name)?.Value;
    const paidAmount = Number(getMeta("Amount") ?? 0);
    const receiptNum = String(getMeta("MpesaReceiptNumber") ?? "");
    const phoneMeta  = getMeta("PhoneNumber");
    const phone      = phoneMeta ? String(phoneMeta) : "";

    // Use CheckoutRequestID as the payment reference — it is the same value the
    // client stores when it creates the pending order after initiating the STK push.
    const paymentReference = CheckoutRequestID;

    // ── Step 4: idempotency — look up existing order ─────────────────────────
    const existing = await db
      .select()
      .from(ucOrdersTable)
      .where(eq(ucOrdersTable.paymentReference, paymentReference))
      .limit(1);

    // ── Step 5: Daraja unavailable — store unverified record; do NOT fulfil ──
    // Safaricom sent a ResultCode 0 but we cannot independently confirm it.
    // Creating a "processing" order here would allow an attacker to trigger
    // fulfilment during any Daraja outage by posting a forged callback.
    // Instead we persist a "pending" (non-fulfillable) record and alert the team
    // to verify manually — this preserves the payment data without fraud risk.
    if (darajaResult === "unavailable") {
      console.warn(
        `[M-Pesa callback] Daraja verification unavailable for ref ${CheckoutRequestID} — storing as unverified, manual verification required`
      );

      if (existing.length > 0) {
        // An order already exists.  Leave it in its current state — do NOT
        // advance it to "processing" without Daraja confirmation.
      const order = existing[0]!;
        console.warn(
          `[M-Pesa callback] Existing order ${order.id} (status=${order.status}) left unchanged — Daraja unavailable`
        );
        ack({ orderId: order.id, unverified: true });
        return;
      }

      // No existing order — require an initiation record to prove we sent this push.
      const initiationRow = await db
        .select()
        .from(mpesaStkInitiationsTable)
        .where(eq(mpesaStkInitiationsTable.checkoutRequestId, paymentReference))
        .limit(1);

      if (initiationRow.length === 0 || initiationRow[0]!.expiresAt < new Date()) {
        // This CheckoutRequestID was not initiated by our server, or the
        // validity window has passed.  Reject without creating any record.
        console.warn(
          `[M-Pesa callback] (unavailable) No valid initiation record for ref ${paymentReference} — rejecting`
        );
        ack();
        return;
      }

      const initiation = initiationRow[0]!;
      // Use our stored expected values, not the unauthenticated callback metadata.
      const verifiedAmount = initiation.expectedAmount;
      const verifiedPhone  = initiation.phone;

      // Persist with "pending" status so it is visible to the team but cannot
      // be dispatched without an explicit manual upgrade.
      const [unverified] = await db
        .insert(ucOrdersTable)
        .values({
          userId:           verifiedPhone || "mpesa-unverified-callback",
          status:           "pending",          // NOT "processing" — must be verified first
          total:            String(verifiedAmount),
          currency:         "KES",
          paymentMethod:    "mpesa",
          paymentReference: paymentReference,
          // Deliberately NOT storing the callback's claimed MpesaReceiptNumber:
          // mpesa_receipt is the canonical, bookkeeping-grade field and this
          // callback is unverified. The claimed code goes in the team alert
          // below for the manual check; the field stays empty until verified.
          promoCode:        "",
          discountPercent:  0,
          discountAmount:   0,
          shippingAddress:  {},
          webhookRecovery:  true,
        })
        .returning();

      console.warn(
        `[M-Pesa callback] Unverified order ${unverified!.id} stored as pending — ref=${paymentReference} amount=KES ${verifiedAmount} phone=${verifiedPhone}`
      );

      // Alert team that VERIFICATION IS REQUIRED before fulfilling (email + SMS fallback).
      alertTeamRecoveryOrder({
        subject:  `🔍 Unverified M-Pesa callback #${unverified!.id} — VERIFY BEFORE FULFILLING`,
        body: [
          "An M-Pesa callback was received but Daraja verification was unavailable.",
          "This order is stored as PENDING and must NOT be fulfilled until manually verified.",
          "",
          `Order ID:       ${unverified!.id}`,
          `Checkout Ref:   ${paymentReference}`,
          `M-Pesa Receipt: ${receiptNum || "(not provided)"} (CLAIMED — verify against M-Pesa Business)`,
          `Amount:         KES ${verifiedAmount.toLocaleString()} (from our initiation record)`,
          `Phone:          ${verifiedPhone}`,
          "",
          "Required action BEFORE fulfilling:",
          "  1. Log into M-Pesa Business (pay.pesaflow.com / Business Mgr) and confirm",
          `     that a payment matching ${paymentReference} was actually received.`,
          "  2. If confirmed: update the order status to 'processing' and proceed.",
          "  3. If not confirmed: delete this order — it may be a forged callback.",
          "",
          "This order is flagged as 'Webhook recovery' in the orders list.",
          "Status: PENDING (not fulfilled until verified).",
        ].join("\n"),
        smsText:  `UCFilters: UNVERIFIED M-Pesa order #${unverified!.id} (PENDING). Daraja down — verify before fulfilling. Ref: ${paymentReference}. Phone: ${verifiedPhone}.`,
        template: "mpesa_unverified_alert",
        orderId:  unverified!.id,
      });

      ack({ orderId: unverified!.id, recovered: true, unverified: true });
      return;
    }

    // ── darajaResult === "confirmed" from here ────────────────────────────────
    console.info(
      `[M-Pesa callback] Daraja confirmed payment — ref=${CheckoutRequestID} amount=${paidAmount} receipt=${receiptNum}`
    );

    if (existing.length > 0) {
      const order = existing[0]!;

      // Persist the M-Pesa confirmation code for bookkeeping/statement
      // reconciliation. Fill-once (only where empty) so a duplicate or forged
      // later callback can never overwrite a stored code. Runs regardless of
      // who advances the status — polling may already have set "processing".
      if (receiptNum) {
        await db
          .update(ucOrdersTable)
          .set({ mpesaReceipt: receiptNum })
          .where(and(eq(ucOrdersTable.id, order.id), eq(ucOrdersTable.mpesaReceipt, "")))
          .catch(() => { /* bookkeeping metadata must never block the ack */ });
      }

      // Atomic transition: only the request that wins the WHERE status='pending'
      // guard sends the customer email.  Concurrent callbacks both read the row
      // but only one UPDATE affects it; the other gets 0 rows back and is a no-op.
      const advanced = await db
        .update(ucOrdersTable)
        .set({ status: "processing" })
        .where(and(eq(ucOrdersTable.id, order.id), eq(ucOrdersTable.status, "pending")))
        .returning();

      if (advanced.length > 0) {
        await pool.query("UPDATE uc_orders SET payment_confirmed_at=COALESCE(payment_confirmed_at,now()) WHERE id=$1", [order.id]);
        // We won the race — app closed during the wait, polling stopped.
        console.info(
          `[M-Pesa callback] Order ${order.id} (ref ${paymentReference}) advanced to processing`
        );
        await enqueueReferralSettlementIfReady(order);
        const customerEmail = order.userId?.includes("@") ? order.userId : null;
        if (customerEmail) {
          const shippingAddr = (order.shippingAddress ?? {}) as Record<string, string>;
          const receipt = buildOrderReceiptEmail({
            orderId: String(order.id),
            firstName: shippingAddr["firstName"] ?? "Customer",
            email: customerEmail,
            lineItems: [{ name: "M-Pesa Payment", quantity: 1, total: String(order.total) }],
            total: String(order.total),
            currency: order.currency,
            paymentMethod: "mpesa",
            shippingAddress: shippingAddr,
            discountAmount: order.discountAmount,
            promoCode: order.promoCode ?? undefined,
            dateCreated: order.dateCreated,
            paymentReference: receiptNum || paymentReference,
          });
          sendViaResend({
            from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
            to: customerEmail, subject: receipt.subject, html: receipt.html, text: receipt.text,
            meta: { template: "order_receipt", orderId: order.id },
          }).catch(() => {});
        }
        // Acknowledge immediately after the durable status/outbox boundary.
        // Customer communications are handled by the normal order finalization
        // path and must never hold a provider callback open.
        ack({ orderId: order.id });
        return;
      } else if (["processing", "completed", "paid"].includes(order.status)) {
        await enqueueReferralSettlementIfReady(order);

        // Send customer confirmation email when we have an email address.
        // userId is set to the customer's email when the app creates the order.
        const customerEmail = order.userId?.includes("@") ? order.userId : null;
        if (customerEmail) {
          const shippingAddr = (order.shippingAddress ?? {}) as Record<string, string>;
          const firstName = shippingAddr["firstName"] ?? "Customer";
          const receipt = buildOrderReceiptEmail({
            orderId:         String(order.id),
            firstName,
            email:           customerEmail,
            // Use a single summary line: individual items live in ucOrderItemsTable.
            lineItems:       [{ name: "M-Pesa Payment", quantity: 1, total: String(order.total) }],
            total:           String(order.total),
            currency:        order.currency,
            paymentMethod:   "mpesa",
            shippingAddress: shippingAddr,
            discountAmount:  order.discountAmount,
            promoCode:       order.promoCode ?? undefined,
            dateCreated:     order.dateCreated,
            // The customer-recognisable M-Pesa code from this very callback.
            paymentReference: receiptNum || paymentReference,
          });
          sendViaResend({
            from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
            to:      customerEmail,
            subject: receipt.subject,
            html:    receipt.html,
            text:    receipt.text,
            meta:    { template: "order_receipt", orderId: order.id },
          }).catch(() => { /* already logged inside sendViaResend */ });
        }

        ack({ orderId: order.id });
      } else {
        // UPDATE matched 0 rows — another concurrent callback or polling loop
        // already advanced this order.  Safe no-op.
        console.info(
          `[M-Pesa callback] Duplicate callback for ref ${paymentReference} — order ${order.id} already ${order.status}`
        );
        ack({ orderId: order.id });
      }

      return;
    }

    // ── Step 6: Daraja confirmed, no existing order — verify initiation + recover ─
    // Require an initiation record to prove we sent this push and to obtain the
    // canonical amount.  Without it any party with a valid CheckoutRequestID
    // (for any payment to our shortcode) could trigger recovery order creation.
    const initiationForRecovery = await db
      .select()
      .from(mpesaStkInitiationsTable)
      .where(eq(mpesaStkInitiationsTable.checkoutRequestId, paymentReference))
      .limit(1);

    if (initiationForRecovery.length === 0 || initiationForRecovery[0]!.expiresAt < new Date()) {
      console.warn(
        `[M-Pesa callback] (confirmed) No valid initiation record for ref ${paymentReference} — rejecting recovery creation`
      );
      ack();
      return;
    }

    const recoveryInitiation = initiationForRecovery[0]!;
    // Use our stored expected values — never the unauthenticated callback metadata.
    const recoveryAmount = recoveryInitiation.expectedAmount;
    const recoveryPhone  = recoveryInitiation.phone;

    if (Math.abs(paidAmount - recoveryAmount) > 1) {
      // Amount in callback differs from what we initiated — log for reconciliation
      // but proceed with our stored amount (the authoritative value).
      console.warn(
        `[M-Pesa callback] Amount mismatch ref=${paymentReference}: initiated=${recoveryAmount} callback=${paidAmount} — using initiated amount`
      );
    }

    const [recovered] = await db
      .insert(ucOrdersTable)
      .values({
        userId:           recoveryPhone || "mpesa-webhook-recovery",
        status:           "processing",
        total:            String(recoveryAmount),
        currency:         "KES",
        paymentMethod:    "mpesa",
        paymentReference: paymentReference,
        mpesaReceipt:     receiptNum,
        promoCode:        "",
        discountPercent:  0,
        discountAmount:   0,
        shippingAddress:  {},
        webhookRecovery:  true,
      })
      .returning();
    await pool.query("UPDATE uc_orders SET payment_confirmed_at=COALESCE(payment_confirmed_at,now()) WHERE id=$1", [recovered!.id]);

    console.info(
      `[M-Pesa callback] Recovery order ${recovered!.id} created — ref=${paymentReference} receipt=${receiptNum} amount=KES ${recoveryAmount} phone=${recoveryPhone}`
    );

    // Alert the team (email + SMS fallback — must never block the ack response).
    alertTeamRecoveryOrder({
      subject:  `⚠️ M-Pesa webhook recovery order #${recovered!.id} needs fulfilment`,
      body: [
        "An M-Pesa webhook recovery order was created automatically.",
        "Payment independently verified with Daraja and matched to our STK initiation — safe to fulfil.",
        "The customer paid but the app closed before the order was recorded.",
        "",
        `Order ID:       ${recovered!.id}`,
        `Checkout Ref:   ${paymentReference}`,
        `M-Pesa Receipt: ${receiptNum || "(not provided)"}`,
        `Amount:         KES ${recoveryAmount.toLocaleString()} (from our initiation record)`,
        `Phone:          ${recoveryPhone}`,
        "",
        "Action required:",
        "  1. Contact the customer and confirm their delivery address and items.",
        "  2. Update the order with the correct line items.",
        "  3. Dispatch as normal once complete.",
        "",
        "This order is flagged as 'Webhook recovery' in the orders list.",
      ].join("\n"),
      smsText:  `UCFilters: M-Pesa recovery order #${recovered!.id} needs fulfilment. KES ${recoveryAmount.toLocaleString()}. Phone: ${recoveryPhone}. Receipt: ${receiptNum || "N/A"}.`,
      template: "payment_recovery_alert",
      orderId:  recovered!.id,
    });

    ack({ orderId: recovered!.id, recovered: true });
  } catch (err) {
    // ── Unique-constraint violation: two concurrent callbacks raced to insert ─
    if (
      typeof err === "object" && err !== null &&
      "code" in err && (err as { code: string }).code === "23505"
    ) {
      console.info("[M-Pesa callback] Concurrent duplicate — unique constraint hit, recovery order already exists");
      ack();
      return;
    }
    console.error("[M-Pesa callback] Unexpected error:", err);
    // Still ack — returning an error status causes Safaricom to retry with
    // unpredictable timing, which can create duplicate recovery orders.
    ack();
  }
});

// ─── Generic verify ───────────────────────────────────────────────────────────
router.post(
  "/payments/verify",
  async (req: Request, res: Response): Promise<void> => {
    const { reference, method } = req.body as { reference: string; method: string };
    if (!reference) {
      res.status(400).json({ error: "reference required" });
      return;
    }
    res.json({ success: true, message: `Payment ${reference} verified via ${method}` });
  }
);

export default router;
