/**
 * Email helper for Ultra-Clear Companion.
 *
 * Supports two providers (checked in order of priority):
 *   1. SendGrid API   — set SENDGRID_API_KEY
 *   2. SMTP relay     — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *
 * All sends are fire-and-forget. When no credentials are present the
 * function is a silent no-op, so the order/booking flow is never blocked.
 *
 * Every send attempt (success or failure) is written to uc_notification_log
 * non-blocking; a DB write error never propagates to the caller.
 *
 * FROM address: EMAIL_FROM env var, defaults to noreply@ucfilters.co.ke
 */

import { db, ucNotificationLogTable } from "@workspace/db";

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

// ─── From-address helper ──────────────────────────────────────────────────────

/**
 * Parse EMAIL_FROM into the `{ email, name? }` object SendGrid requires.
 * Accepts both "Name <addr@domain>" and plain "addr@domain" formats.
 */
export function parseFromAddress(raw: string): { email: string; name?: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { email: trimmed };
}

function fromAddress(): { email: string; name?: string } {
  return parseFromAddress(
    process.env["EMAIL_FROM"] ?? "Ultra Clear <noreply@ucfilters.co.ke>",
  );
}

// ─── Provider detection ───────────────────────────────────────────────────────

function hasSendGrid(): boolean {
  return !!process.env["SENDGRID_API_KEY"];
}

function hasSmtp(): boolean {
  return !!(process.env["SMTP_HOST"] && process.env["SMTP_USER"] && process.env["SMTP_PASS"]);
}

// ─── Notification log helper ──────────────────────────────────────────────────

/** Write a send-attempt row to uc_notification_log. Never throws. */
function logEmailAttempt(params: {
  provider:     string;  // 'sendgrid' | 'smtp' | 'resend' | 'none'
  recipient:    string;
  template:     string;
  messageBody:  string;
  orderId?:     number | string;
  ticketId?:    string;
  testId?:      string;
  status:       "sent" | "failed";
  errorMessage?: string;
}): void {
  db.insert(ucNotificationLogTable)
    .values({
      channel:      "email",
      provider:     params.provider,
      recipient:    params.recipient,
      template:     params.template,
      messageBody:  params.messageBody,
      orderId:      params.orderId != null ? Number(params.orderId) : undefined,
      ticketId:     params.ticketId,
      testId:       params.testId,
      status:       params.status,
      errorMessage: params.errorMessage,
    })
    .catch((err: unknown) => {
      console.error("[email] notification log write failed:", err);
    });
}

// ─── SendGrid send ────────────────────────────────────────────────────────────

export async function sendViaSendGrid(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  const res = await fetch(SENDGRID_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env["SENDGRID_API_KEY"]}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from:    fromAddress(),          // correctly split name + email
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html",  value: html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`SendGrid ${res.status}: ${body}`);
  }
}

// ─── SMTP send (via fetch to a simple relay, or nodemailer-compatible) ────────
// We use a minimal raw SMTP-over-HTTP approach via smtp2go / mailgun SMTP proxy.
// For production, replace this block with nodemailer if added to dependencies.

/**
 * Optional transport factory injected by unit tests.
 * When set, `sendViaSmtp` calls this instead of creating a real nodemailer
 * transporter — allows testing the SendGrid-failure/SMTP-success and
 * SendGrid-failure/SMTP-failure paths without a live SMTP server.
 *
 * @internal — test use only. Never set this in production code.
 */
export let _testSmtpTransport: { sendMail: (opts: unknown) => Promise<void> } | null = null;
export function _testSetSmtpTransport(
  t: { sendMail: (opts: unknown) => Promise<void> } | null,
): void {
  _testSmtpTransport = t;
}

async function sendViaSmtp(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  // If a test-injected transport is present, use it directly.
  if (_testSmtpTransport) {
    const f = fromAddress();
    const fromStr = f.name ? `${f.name} <${f.email}>` : f.email;
    await _testSmtpTransport.sendMail({ from: fromStr, to, subject, text, html });
    return;
  }

  // Dynamically import nodemailer only if it is installed, to avoid a hard
  // dependency. The indirection through a variable prevents TypeScript from
  // statically checking whether the module exists at compile time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodemailer: any = null;
  try {
    // @ts-ignore — nodemailer is an optional runtime dependency
    nodemailer = await import("nodemailer");
  } catch {
    throw new Error("nodemailer not installed — SMTP delivery unavailable");
  }
  if (!nodemailer) {
    throw new Error("nodemailer failed to load — SMTP delivery unavailable");
  }

  const port = Number(process.env["SMTP_PORT"] ?? 587);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const transporter = (nodemailer.default ?? nodemailer).createTransport({
    host:   process.env["SMTP_HOST"]!,
    port,
    secure: port === 465,
    auth: {
      user: process.env["SMTP_USER"]!,
      pass: process.env["SMTP_PASS"]!,
    },
  });

  const f = fromAddress();
  const fromStr = f.name ? `${f.name} <${f.email}>` : f.email;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await transporter.sendMail({ from: fromStr, to, subject, text, html });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send an email (fire-and-forget).
 * Tries SendGrid first; falls back to SMTP if SendGrid fails or is unconfigured.
 * Silently skips when neither provider is configured.
 *
 * Every attempt is written non-blocking to uc_notification_log.
 */
export async function sendEmail(params: {
  to:       string;
  subject:  string;
  html:     string;
  text:     string;
  /** Optional metadata for the notification log */
  template?: string;
  orderId?:  number | string;
  ticketId?: string;
  testId?:   string;
}): Promise<void> {
  if (!hasSendGrid() && !hasSmtp()) {
    console.log("[email] No provider configured — skipping email to", params.to);
    logEmailAttempt({
      provider:     "none",
      recipient:    params.to,
      template:     params.template ?? "",
      messageBody:  params.text,
      orderId:      params.orderId,
      ticketId:     params.ticketId,
      testId:       params.testId,
      status:       "failed",
      errorMessage: "No email provider configured (SENDGRID_API_KEY or SMTP_HOST required)",
    });
    return;
  }

  // Store the full plain-text body so retries can reconstruct a useful message.
  const logBase = {
    recipient:   params.to,
    template:    params.template ?? "",
    messageBody: params.text,
    orderId:     params.orderId,
    ticketId:    params.ticketId,
    testId:      params.testId,
  };

  // Kick off the delivery chain asynchronously — never blocks the caller.
  (async () => {
    if (hasSendGrid()) {
      try {
        await sendViaSendGrid(params.to, params.subject, params.html, params.text);
        console.log("[email] sent via SendGrid to", params.to);
        logEmailAttempt({ ...logBase, provider: "sendgrid", status: "sent" });
        return; // success — done
      } catch (sgErr: unknown) {
        const errMsg = sgErr instanceof Error ? sgErr.message : String(sgErr);
        console.warn("[email] SendGrid failed:", errMsg);
        // Log the SendGrid failure immediately — every provider attempt is recorded
        // regardless of whether a fallback provider later succeeds.
        logEmailAttempt({ ...logBase, provider: "sendgrid", status: "failed", errorMessage: errMsg });
        if (!hasSmtp()) {
          console.error("[email] No SMTP fallback configured — email not delivered to", params.to);
          return;
        }
        console.log("[email] Trying SMTP fallback for", params.to);
      }
    }
    // Either SendGrid was not configured, or it failed and SMTP is available.
    // This attempt is logged separately so the log captures every provider tried.
    try {
      await sendViaSmtp(params.to, params.subject, params.html, params.text);
      console.log("[email] sent via SMTP to", params.to);
      logEmailAttempt({ ...logBase, provider: "smtp", status: "sent" });
    } catch (smtpErr: unknown) {
      const errMsg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
      console.error("[email] SMTP also failed:", errMsg);
      logEmailAttempt({ ...logBase, provider: "smtp", status: "failed", errorMessage: errMsg });
    }
  })();
}

// ─── Booking confirmation templates ──────────────────────────────────────────

export function buildTicketConfirmationEmail(params: {
  ticketId:    string;
  firstName:   string;
  email:       string;
  productModel: string;
  issueDescription: string;
}): { subject: string; html: string; text: string } {
  const { ticketId, firstName, productModel, issueDescription } = params;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Maintenance Ticket ${ticketId}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;">
        <tr><td style="background:#0D4FA8;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;">Ultra Clear Filters</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Certified clean water for every Kenyan</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:18px;">Maintenance Ticket Submitted 🔧</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hi ${firstName}, we've received your maintenance request and our team will contact you within 24–48 hours.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#f3f4f6;"><td colspan="2" style="padding:12px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Ticket Details</td></tr>
            <tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:40%;">Reference</td><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#111827;font-size:13px;font-weight:700;">${ticketId}</td></tr>
            <tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Product</td><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#111827;font-size:13px;">${productModel}</td></tr>
            <tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;vertical-align:top;">Issue</td><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#111827;font-size:13px;">${issueDescription}</td></tr>
          </table>
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">For urgent help call <a href="tel:+254717774049" style="color:#0D4FA8;">0717774049</a> or email <a href="mailto:support@ucfilters.co.ke" style="color:#0D4FA8;">support@ucfilters.co.ke</a>.</p>
        </td></tr>
        <tr><td style="background:#f3f4f6;padding:20px 32px;text-align:center;"><p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 UCFilters Ltd · Nairobi, Kenya · <a href="https://ucfilters.co.ke" style="color:#6b7280;">ucfilters.co.ke</a></p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    `Ultra Clear Maintenance Ticket — ${ticketId}`,
    `Hi ${firstName}, we've received your maintenance request.`,
    "",
    `Ticket: ${ticketId}`,
    `Product: ${productModel}`,
    `Issue: ${issueDescription}`,
    "",
    "Our team will contact you within 24–48 hours.",
    "Urgent? Call 0717774049 or email support@ucfilters.co.ke",
  ].join("\n");
  return { subject: `Your Ultra Clear maintenance ticket ${ticketId} is submitted`, html, text };
}

export function buildWaterTestConfirmationEmail(params: {
  testId:    string;
  firstName: string;
  email:     string;
  address:   string;
  waterSource: string;
  concerns:  string;
}): { subject: string; html: string; text: string } {
  const { testId, firstName, address, waterSource, concerns } = params;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Water Test Booking ${testId}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;">
        <tr><td style="background:#0D4FA8;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;">Ultra Clear Filters</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Certified clean water for every Kenyan</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:18px;">Free Water Test Booked 💧</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hi ${firstName}, your free water quality test is booked! We'll call you to confirm the appointment time.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#f3f4f6;"><td colspan="2" style="padding:12px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Booking Details</td></tr>
            <tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:40%;">Reference</td><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#111827;font-size:13px;font-weight:700;">${testId}</td></tr>
            <tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Address</td><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#111827;font-size:13px;">${address}</td></tr>
            <tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Water source</td><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#111827;font-size:13px;">${waterSource}</td></tr>
            ${concerns ? `<tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;vertical-align:top;">Concerns</td><td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#111827;font-size:13px;">${concerns}</td></tr>` : ""}
          </table>
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">Questions? Call <a href="tel:+254717774049" style="color:#0D4FA8;">0717774049</a> or email <a href="mailto:support@ucfilters.co.ke" style="color:#0D4FA8;">support@ucfilters.co.ke</a>.</p>
        </td></tr>
        <tr><td style="background:#f3f4f6;padding:20px 32px;text-align:center;"><p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 UCFilters Ltd · Nairobi, Kenya · <a href="https://ucfilters.co.ke" style="color:#6b7280;">ucfilters.co.ke</a></p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    `Ultra Clear Free Water Test — ${testId}`,
    `Hi ${firstName}, your free water quality test is booked!`,
    "",
    `Reference: ${testId}`,
    `Address: ${address}`,
    `Water source: ${waterSource}`,
    ...(concerns ? [`Concerns: ${concerns}`] : []),
    "",
    "We'll call you to confirm the appointment time.",
    "Questions? Call 0717774049 or email support@ucfilters.co.ke",
  ].join("\n");
  return { subject: `Your Ultra Clear water test booking ${testId} is confirmed`, html, text };
}

// ─── HTML receipt template ────────────────────────────────────────────────────

export function buildOrderReceiptEmail(params: {
  orderId:   string | number;
  firstName: string;
  email:     string;
  lineItems: Array<{ name?: string; quantity?: number; total?: string }>;
  total:     string;
  currency:  string;
  paymentMethod: string;
  shippingAddress?: {
    firstName?: string;
    lastName?:  string;
    address1?:  string;
    city?:      string;
    country?:   string;
    phone?:     string;
  };
  discountAmount?: number;
  promoCode?:      string;
}): { subject: string; html: string; text: string } {
  const {
    orderId, firstName, lineItems, total, currency,
    paymentMethod, shippingAddress, discountAmount, promoCode,
  } = params;

  const fmt = (n: string | number) =>
    `${currency} ${Number(n).toLocaleString("en-KE")}`;

  const payLabels: Record<string, string> = {
    mpesa:       "M-Pesa",
    stripe:      "Card (Stripe)",
    paystack:    "Card (Paystack)",
    cod:         "Cash on Delivery",
  };
  const payLabel = payLabels[paymentMethod] ?? paymentMethod;

  const addr = shippingAddress;
  const addrText = addr
    ? [addr.address1, addr.city, addr.country].filter(Boolean).join(", ")
    : "To be confirmed";

  const itemsHtml = lineItems
    .map(
      (i) => {
        const safeName  = i.name     != null && i.name     !== "" ? i.name               : "—";
        const safeQty   = i.quantity != null                      ? String(i.quantity)   : "—";
        const safeTotal = i.total    != null && i.total    !== "" ? fmt(i.total)         : "—";
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${safeName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${safeQty}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${safeTotal}</td>
        </tr>`;
      }
    )
    .join("\n");

  const discountRow =
    discountAmount && discountAmount > 0
      ? `<tr>
          <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
            Discount${promoCode ? ` (${promoCode})` : ""}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#16a34a;">
            -${fmt(discountAmount)}
          </td>
        </tr>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Your Ultra Clear Order #${orderId}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;">

        <!-- Header -->
        <tr>
          <td style="background:#0D4FA8;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;">Ultra Clear Filters</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Certified clean water for every Kenyan</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;color:#111827;font-size:18px;">Order Confirmed ✅</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">
              Hi ${firstName}, thank you for your order! Here's your receipt.
            </p>

            <!-- Order meta -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Order number</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:bold;text-align:right;">#${orderId}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Payment</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;text-align:right;">${payLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Delivery to</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;text-align:right;">${addrText}</td>
              </tr>
            </table>

            <!-- Items table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">ITEM</th>
                  <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">QTY</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600;">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
                ${discountRow}
                <tr style="background:#f9fafb;">
                  <td colspan="2" style="padding:12px;font-weight:700;color:#111827;">Total</td>
                  <td style="padding:12px;font-weight:700;color:#0D4FA8;text-align:right;font-size:16px;">${fmt(total)}</td>
                </tr>
              </tbody>
            </table>

            <p style="margin:0 0 16px;color:#0D4FA8;font-size:14px;font-weight:600;background:#eff6ff;border-left:3px solid #0D4FA8;padding:12px 16px;border-radius:4px;">
              📦 We'll notify you as soon as your order has shipped.
            </p>
            <p style="margin:0 0 24px;color:#6b7280;font-size:13px;line-height:1.6;">
              Questions about your order? Contact us at
              <a href="mailto:support@ucfilters.co.ke" style="color:#0D4FA8;">support@ucfilters.co.ke</a>
              or call <a href="tel:+254717774049" style="color:#0D4FA8;">0717774049</a>.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f3f4f6;padding:20px 32px;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">
              © 2026 UCFilters Ltd · Nairobi, Kenya ·
              <a href="https://ucfilters.co.ke" style="color:#6b7280;">ucfilters.co.ke</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Ultra Clear Order Confirmation — #${orderId}`,
    `Hi ${firstName}, thank you for your order!`,
    "",
    `Payment: ${payLabel}`,
    `Delivery to: ${addrText}`,
    "",
    "Items:",
    ...lineItems.map((i) => {
      const safeName  = i.name     != null && i.name     !== "" ? i.name           : "—";
      const safeQty   = i.quantity != null                      ? `x${i.quantity}` : "x—";
      const safeTotal = i.total    != null && i.total    !== "" ? fmt(i.total)     : "—";
      return `  ${safeName} ${safeQty} — ${safeTotal}`;
    }),
    ...(discountAmount && discountAmount > 0
      ? [`  Discount${promoCode ? ` (${promoCode})` : ""}: -${fmt(discountAmount)}`]
      : []),
    `  Total: ${fmt(total)}`,
    "",
    "We'll notify you as soon as your order has shipped.",
    "",
    "Questions? Email support@ucfilters.co.ke or call 0717774049.",
    "ucfilters.co.ke",
  ].join("\n");

  return {
    subject: `Your Ultra Clear order #${orderId} is confirmed`,
    html,
    text,
  };
}
export function buildWhatsAppAlertEmail(params: {
  reason: "qr" | "disconnected";
  qrPageUrl: string;
}): { subject: string; html: string; text: string } {
  const { reason, qrPageUrl } = params;

  const heading =
    reason === "qr"
      ? "WhatsApp session requires QR scan 📱"
      : "WhatsApp session has been disconnected ⚠️";

  const body =
    reason === "qr"
      ? "The WhatsApp session has ended and is now waiting for a QR code scan. Messages cannot be sent until the session is re-authenticated."
      : "The WhatsApp session has been disconnected for more than 5 minutes and has not recovered automatically. Messages cannot be sent until the session is restored.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>WhatsApp Alert</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;">
        <tr><td style="background:#0D4FA8;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;">Ultra Clear Filters</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Internal system alert</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${heading}</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">${body}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td>
              <a href="${qrPageUrl}"
                 style="display:inline-block;background:#0D4FA8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
                Open QR Scan Page →
              </a>
            </td></tr>
          </table>
          <p style="margin:0;color:#9ca3af;font-size:12px;">
            This is an automated alert from the Ultra Clear API server.
            The QR scan page is at: <a href="${qrPageUrl}" style="color:#0D4FA8;">${qrPageUrl}</a>
          </p>
        </td></tr>
        <tr><td style="background:#f3f4f6;padding:20px 32px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 UCFilters Ltd · Nairobi, Kenya</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    heading,
    "",
    body,
    "",
    `Re-authenticate here: ${qrPageUrl}`,
    "",
    "This is an automated alert from the Ultra Clear API server.",
  ].join("\n");

  const subjectMap: Record<string, string> = {
    qr: "ACTION REQUIRED: WhatsApp session needs QR scan",
    disconnected: "ALERT: WhatsApp session disconnected for >5 minutes",
  };

  return { subject: subjectMap[reason] ?? "WhatsApp session alert", html, text };
}

