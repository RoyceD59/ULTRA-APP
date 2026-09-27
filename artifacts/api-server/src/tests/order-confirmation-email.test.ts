/**
 * Tests for the order-confirmation email path.
 *
 * Covers:
 *   (a) buildOrderReceiptEmail template — HTML contains order ID, at least one
 *       line item, total, and the "we'll notify you when it ships" note.
 *   (b) buildOrderReceiptEmail with discount — discount row and promo code appear.
 *   (c) sendViaResend success — correct payload shape is sent to the Resend API.
 *   (d) sendViaResend failure — returns false and logs a structured warning (no
 *       PII in the log message).
 *   (e) sendViaResend network error — returns false and logs the error message.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const SAMPLE_ORDER = {
  orderId:       "ORD-2026-001",
  firstName:     "Amina",
  email:         "amina@example.com",
  lineItems: [
    { name: "Hydra Flux",           quantity: 1, total: "3499" },
    { name: "Bottle Filter Cartridge", quantity: 2, total: "2198" },
  ],
  total:         "5697",
  currency:      "KES",
  paymentMethod: "mpesa",
  shippingAddress: {
    firstName: "Amina",
    lastName:  "Wanjiru",
    address1:  "12 Westlands Rd",
    city:      "Nairobi",
    country:   "Kenya",
    phone:     "+254712345678",
  },
};

// ─── (a) HTML template — required fields ─────────────────────────────────────

describe("buildOrderReceiptEmail — required fields", () => {
  it("subject contains the order ID", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { subject } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.ok(
      subject.includes("ORD-2026-001"),
      `Subject should mention order ID; got: "${subject}"`,
    );
  });

  it("HTML contains the order ID", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.ok(html.includes("ORD-2026-001"), "HTML must contain the order ID");
  });

  it("HTML contains at least one line-item name", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.ok(
      html.includes("Hydra Flux"),
      "HTML must contain at least one line-item name",
    );
  });

  it("HTML contains the order total", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail(SAMPLE_ORDER);
    // The template formats the total as "KES 5,697" — check both the currency
    // symbol and a fragment of the numeric value.
    assert.ok(html.includes("KES"), "HTML must include the currency");
    assert.ok(html.includes("5,697") || html.includes("5697"), "HTML must include the total amount");
  });

  it("HTML contains the 'we'll notify you when it ships' note", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.ok(
      html.toLowerCase().includes("shipped") || html.toLowerCase().includes("notify"),
      "HTML must contain the shipping-notification note",
    );
  });

  it("plain-text version contains all key fields", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { text } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.ok(text.includes("ORD-2026-001"),  "text must contain order ID");
    assert.ok(text.includes("Hydra Flux"),    "text must contain a line-item name");
    assert.ok(text.includes("5,697") || text.includes("5697"), "text must include the total");
    assert.ok(
      text.toLowerCase().includes("shipped") || text.toLowerCase().includes("notify"),
      "text must contain the shipping-notification note",
    );
  });

  it("HTML contains the shipping address city", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.ok(html.includes("Nairobi"), "HTML must contain the shipping city");
  });
});

// ─── (b) HTML template — discount row ────────────────────────────────────────

describe("buildOrderReceiptEmail — discount and promo code", () => {
  it("HTML includes a discount row when discountAmount > 0", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail({
      ...SAMPLE_ORDER,
      discountAmount: 500,
      promoCode:      "WELCOME10",
    });
    assert.ok(html.includes("WELCOME10"), "HTML must show the promo code");
    assert.ok(
      html.includes("Discount") || html.includes("discount"),
      "HTML must show a discount label",
    );
    // Green colour applied to the discount amount
    assert.ok(html.includes("#16a34a"), "Discount amount should use green colour");
  });

  it("HTML omits the discount row when discountAmount is 0 or absent", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail({ ...SAMPLE_ORDER, discountAmount: 0 });
    // No negative-sign discount row should appear
    assert.ok(!html.includes("#16a34a"), "No green discount colour when discount is 0");
  });
});

// ─── (b2) HTML template — missing/undefined line-item fields ─────────────────

describe("buildOrderReceiptEmail — missing line-item fields", () => {
  it("renders '—' for a missing name instead of 'undefined'", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html, text } = buildOrderReceiptEmail({
      ...SAMPLE_ORDER,
      lineItems: [{ quantity: 1, total: "3499" }],
    });
    assert.ok(!html.includes("undefined"), "HTML must not contain the word 'undefined'");
    assert.ok(!text.includes("undefined"), "text must not contain the word 'undefined'");
    assert.ok(html.includes("—"), "HTML must show fallback '—' for missing name");
    assert.ok(text.includes("—"), "text must show fallback '—' for missing name");
  });

  it("renders '—' for a missing total instead of 'undefined'", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html, text } = buildOrderReceiptEmail({
      ...SAMPLE_ORDER,
      lineItems: [{ name: "Hydra Flux", quantity: 1 }],
    });
    assert.ok(!html.includes("undefined"), "HTML must not contain 'undefined'");
    assert.ok(!text.includes("undefined"), "text must not contain 'undefined'");
    assert.ok(html.includes("—"), "HTML must show fallback '—' for missing total");
    assert.ok(text.includes("—"), "text must show fallback '—' for missing total");
  });

  it("renders '—' for a missing quantity instead of 'undefined'", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html, text } = buildOrderReceiptEmail({
      ...SAMPLE_ORDER,
      lineItems: [{ name: "Hydra Flux", total: "3499" }],
    });
    assert.ok(!html.includes("undefined"), "HTML must not contain 'undefined'");
    assert.ok(!text.includes("undefined"), "text must not contain 'undefined'");
  });

  it("renders '—' for all fields when an entirely empty line item is present", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html, text } = buildOrderReceiptEmail({
      ...SAMPLE_ORDER,
      lineItems: [{}],
    });
    assert.ok(!html.includes("undefined"), "HTML must not contain 'undefined'");
    assert.ok(!text.includes("undefined"), "text must not contain 'undefined'");
    // At least one '—' must appear in both outputs
    assert.ok(html.includes("—"), "HTML must use fallback '—'");
    assert.ok(text.includes("—"), "text must use fallback '—'");
  });

  it("still renders normally when all fields are present", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.ok(html.includes("Hydra Flux"),      "product name must appear");
    assert.ok(html.includes("3,499") || html.includes("3499"), "product total must appear");
    assert.ok(!html.includes("undefined"),       "must not contain 'undefined'");
  });
});

// ─── (b3) HTML template — empty lineItems array ───────────────────────────────

describe("buildOrderReceiptEmail — empty lineItems", () => {
  it("shows a fallback row instead of a blank tbody", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html, text } = buildOrderReceiptEmail({ ...SAMPLE_ORDER, lineItems: [] });

    // Must not contain an empty <tbody></tbody> — the fallback row must be present
    assert.ok(
      !html.includes("<tbody>\n                \n                "),
      "HTML must not render an empty item block",
    );
    assert.ok(
      html.toLowerCase().includes("no items listed"),
      `HTML must show the fallback text "No items listed"; got: ${html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>") + 8)}`,
    );
    assert.ok(
      text.toLowerCase().includes("no items listed"),
      'plain-text must include "No items listed"',
    );
  });
});

// ─── Receipt serial number & COD payment instructions ───────────────────────

describe("buildOrderReceiptEmail — receipt serial number", () => {
  it("serial is deterministic from order id + dateCreated and appears in HTML and text", async () => {
    const { buildOrderReceiptEmail, orderReceiptSerial } = await import("../lib/email.js");
    const dateCreated = "2026-08-14T10:00:00+03:00";
    const expected = orderReceiptSerial(SAMPLE_ORDER.orderId, dateCreated);
    assert.match(expected, /^UC-\d{8}-\d{6,}$/, "serial must follow UC-YYYYMMDD-NNNNNN");

    const { html, text } = buildOrderReceiptEmail({ ...SAMPLE_ORDER, dateCreated });
    assert.ok(html.includes(expected), "HTML must contain the receipt serial");
    assert.ok(text.includes(expected), "text must contain the receipt serial");

    // Deterministic: same inputs → same serial
    assert.equal(orderReceiptSerial(SAMPLE_ORDER.orderId, dateCreated), expected);
  });

  it("serial is generated even without dateCreated", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html } = buildOrderReceiptEmail(SAMPLE_ORDER);
    assert.match(html, /UC-\d{8}-\d{6,}/, "HTML must contain a generated serial");
  });
});

describe("buildOrderReceiptEmail — cash-on-delivery payment instructions", () => {
  it("COD receipt includes till, paybill, account, and the company phone", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html, text } = buildOrderReceiptEmail({ ...SAMPLE_ORDER, paymentMethod: "cod" });

    for (const body of [html, text]) {
      assert.ok(body.includes("568 0516"),  "must include the M-Pesa till number");
      assert.ok(body.includes("542 542"),   "must include the paybill number");
      assert.ok(body.includes("071908000"), "must include the paybill account");
      assert.ok(body.includes("0717774049"), "must include the company phone number");
    }
    assert.ok(
      html.toLowerCase().includes("cash on delivery"),
      "HTML must label the instructions as cash on delivery",
    );
  });

  it("non-COD receipts do not include the payment instructions", async () => {
    const { buildOrderReceiptEmail } = await import("../lib/email.js");
    const { html, text } = buildOrderReceiptEmail(SAMPLE_ORDER); // mpesa
    assert.ok(!html.includes("568 0516"), "paid receipts must not show the till number");
    assert.ok(!text.includes("568 0516"), "paid text receipts must not show the till number");
  });
});

// ─── (c) sendViaResend — success path ────────────────────────────────────────

describe("sendViaResend — success", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => { originalFetch = globalThis.fetch; });
  after(() => { globalThis.fetch = originalFetch; });

  it("posts a well-formed payload to the Resend API and returns true", async () => {
    const captured: { url: string; method: string; body: Record<string, unknown> }[] = [];

    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      captured.push({
        url:    String(url),
        method: init?.method ?? "GET",
        body:   JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ id: "re_abc123" }), { status: 200 });
    };

    // Point at the stub via env so the connector branch is skipped
    process.env["RESEND_BASE_URL"] = "https://api.resend.com";
    process.env["RESEND_API_KEY"]  = "re_test_key";

    try {
      const { sendViaResend } = await import("../lib/resend.js");
      const { buildOrderReceiptEmail } = await import("../lib/email.js");
      const receipt = buildOrderReceiptEmail(SAMPLE_ORDER);

      const ok = await sendViaResend({
        from:    "orders@contacts.ucfilters.com",
        to:      SAMPLE_ORDER.email,
        subject: receipt.subject,
        text:    receipt.text,
        html:    receipt.html,
      });

      assert.ok(ok, "sendViaResend should return true on a 200 response");
      assert.equal(captured.length, 1, "exactly one HTTP request should be made");

      const req = captured[0]!;
      assert.ok(req.url.includes("resend.com"), "should call the Resend API");
      assert.equal(req.method, "POST",           "should use POST");

      // Payload shape
      assert.equal(req.body["from"],    "orders@contacts.ucfilters.com", "from field");
      assert.equal(req.body["to"],      SAMPLE_ORDER.email,               "to field");
      assert.ok(
        (req.body["subject"] as string).includes("ORD-2026-001"),
        "subject should reference the order ID",
      );
      assert.ok(req.body["html"],  "payload must include html body");
      assert.ok(req.body["text"],  "payload must include text body");
    } finally {
      delete process.env["RESEND_BASE_URL"];
      delete process.env["RESEND_API_KEY"];
    }
  });
});

// ─── (d) sendViaResend — Resend API error ────────────────────────────────────

describe("sendViaResend — Resend API returns an error status", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalError: typeof console.error;

  before(() => {
    originalFetch = globalThis.fetch;
    originalError = console.error;
  });
  after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  });

  it("returns false and logs a structured warning (no PII)", async () => {
    const errorLogs: string[] = [];
    console.error = (...args: unknown[]) => errorLogs.push(args.map(String).join(" "));

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ name: "validation_error", message: "Invalid API key" }),
        { status: 403 },
      );

    process.env["RESEND_BASE_URL"] = "https://api.resend.com";
    process.env["RESEND_API_KEY"]  = "re_bad_key";

    try {
      const { sendViaResend } = await import("../lib/resend.js");
      const ok = await sendViaResend({
        from:    "orders@contacts.ucfilters.com",
        to:      "customer@example.com",
        subject: "Your Ultra Clear order #ORD-2026-001 is confirmed",
        text:    "Order confirmed.",
        html:    "<p>Order confirmed.</p>",
      });

      assert.equal(ok, false, "sendViaResend must return false on a non-2xx status");
      assert.ok(errorLogs.length > 0, "at least one error should be logged");

      // The log line must contain the status code and the Resend error name,
      // but MUST NOT contain the customer email address (PII).
      const logLine = errorLogs.join("\n");
      assert.ok(logLine.includes("403"),              "log must include the HTTP status code");
      assert.ok(logLine.includes("validation_error"), "log must include the Resend error name");
      assert.ok(
        !logLine.includes("customer@example.com"),
        "log must NOT include the recipient email address (PII)",
      );
    } finally {
      delete process.env["RESEND_BASE_URL"];
      delete process.env["RESEND_API_KEY"];
    }
  });
});

// ─── (e) sendViaResend — network / fetch error ───────────────────────────────

describe("sendViaResend — network error", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalError: typeof console.error;

  before(() => {
    originalFetch = globalThis.fetch;
    originalError = console.error;
  });
  after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  });

  it("returns false and logs the error message without throwing", async () => {
    const errorLogs: string[] = [];
    console.error = (...args: unknown[]) => errorLogs.push(args.map(String).join(" "));

    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED: connection refused");
    };

    process.env["RESEND_BASE_URL"] = "https://api.resend.com";
    process.env["RESEND_API_KEY"]  = "re_test_key";

    try {
      const { sendViaResend } = await import("../lib/resend.js");
      const ok = await sendViaResend({
        from:    "orders@contacts.ucfilters.com",
        to:      "customer@example.com",
        subject: "Your Ultra Clear order #ORD-2026-001 is confirmed",
        text:    "Order confirmed.",
        html:    "<p>Order confirmed.</p>",
      });

      assert.equal(ok, false, "sendViaResend must return false on a network error");
      assert.ok(errorLogs.length > 0, "error should be logged on network failure");
      const logLine = errorLogs.join("\n");
      assert.ok(
        logLine.includes("ECONNREFUSED") || logLine.includes("send failed"),
        "log should reference the error or 'send failed'",
      );
    } finally {
      delete process.env["RESEND_BASE_URL"];
      delete process.env["RESEND_API_KEY"];
    }
  });
});
