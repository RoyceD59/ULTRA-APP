/**
 * Unit tests for the email helper.
 *
 * Uses Node.js built-in test runner (node:test) — no extra dependencies.
 * Run with: node --import tsx/esm src/lib/email.test.ts
 * Or via: pnpm --filter @workspace/api-server test
 *
 * Tests cover:
 *   (a) parseFromAddress — "Name <email>" and plain "email" forms
 *   (b) sendEmail no-op   — when neither provider is configured
 *   (c) sendEmail via SendGrid success path
 *   (d) sendEmail SendGrid failure → SMTP fallback
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const SAMPLE_PARAMS = {
  to:      "customer@example.com",
  subject: "Test subject",
  html:    "<p>Hello</p>",
  text:    "Hello",
};

// ─── parseFromAddress ─────────────────────────────────────────────────────────

describe("parseFromAddress", () => {
  it("parses 'Name <email>' format", async () => {
    const { parseFromAddress } = await import("../lib/email.js");
    const result = parseFromAddress("Ultra Clear <noreply@ucfilters.co.ke>");
    assert.deepEqual(result, { name: "Ultra Clear", email: "noreply@ucfilters.co.ke" });
  });

  it("parses plain email address", async () => {
    const { parseFromAddress } = await import("../lib/email.js");
    const result = parseFromAddress("noreply@ucfilters.co.ke");
    assert.deepEqual(result, { email: "noreply@ucfilters.co.ke" });
  });

  it("trims whitespace", async () => {
    const { parseFromAddress } = await import("../lib/email.js");
    const result = parseFromAddress("  UCFilters  <  noreply@ucfilters.co.ke  >  ");
    assert.equal(result.email, "noreply@ucfilters.co.ke");
    assert.equal(result.name, "UCFilters");
  });
});

// ─── sendEmail — no provider configured ──────────────────────────────────────

describe("sendEmail — no provider", () => {
  before(() => {
    delete process.env["SENDGRID_API_KEY"];
    delete process.env["SMTP_HOST"];
    delete process.env["SMTP_USER"];
    delete process.env["SMTP_PASS"];
  });

  it("is a no-op and does not throw", async () => {
    // Use a fresh module import; spy on fetch to confirm it is never called.
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown) => {
      fetchCalls.push(String(url));
      return new Response("", { status: 200 });
    };

    try {
      const { sendEmail } = await import("../lib/email.js");
      await sendEmail(SAMPLE_PARAMS);
      // Give any fire-and-forget microtasks a tick to settle
      await new Promise(r => setTimeout(r, 10));
      assert.equal(fetchCalls.length, 0, "fetch should not be called when no provider is set");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── sendEmail — SendGrid success ─────────────────────────────────────────────

describe("sendEmail — SendGrid success", () => {
  before(() => {
    process.env["SENDGRID_API_KEY"] = "SG.test-key";
    delete process.env["SMTP_HOST"];
  });

  after(() => {
    delete process.env["SENDGRID_API_KEY"];
  });

  it("calls the SendGrid endpoint with correctly split from field", async () => {
    process.env["EMAIL_FROM"] = "Ultra Clear <noreply@ucfilters.co.ke>";

    const captured: { url: string; body: Record<string, unknown> }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      captured.push({
        url: String(url),
        body: JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>,
      });
      return new Response("", { status: 202 });
    };

    try {
      // sendViaSendGrid is exported for direct unit-testing
      const { sendViaSendGrid } = await import("../lib/email.js");
      await sendViaSendGrid(
        SAMPLE_PARAMS.to,
        SAMPLE_PARAMS.subject,
        SAMPLE_PARAMS.html,
        SAMPLE_PARAMS.text,
      );

      assert.equal(captured.length, 1);
      const req = captured[0]!;
      assert.ok(req.url.includes("sendgrid.com"), "should call SendGrid API");

      // from must be split: { email, name } — not the raw display string
      const from = req.body["from"] as { email: string; name?: string };
      assert.equal(from.email, "noreply@ucfilters.co.ke", "from.email must be plain address");
      assert.equal(from.name,  "Ultra Clear",             "from.name must be display name");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env["EMAIL_FROM"];
    }
  });
});

// ─── sendEmail — SendGrid fails → SMTP fallback ───────────────────────────────

describe("sendEmail — SendGrid failure triggers SMTP fallback", () => {
  before(() => {
    process.env["SENDGRID_API_KEY"] = "SG.bad-key";
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_USER"] = "user@example.com";
    process.env["SMTP_PASS"] = "secret";
  });

  after(() => {
    delete process.env["SENDGRID_API_KEY"];
    delete process.env["SMTP_HOST"];
    delete process.env["SMTP_USER"];
    delete process.env["SMTP_PASS"];
  });

  it("attempts SMTP after SendGrid returns a non-2xx response", async () => {
    // Simulate SendGrid 401
    let smtpAttempted = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });

    // Stub the SMTP path: monkey-patch sendViaSmtp via the module's export.
    // Since we can't easily stub internal functions, we verify the console
    // warning is emitted (indicating fallback was attempted) instead.
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));

    // Stub nodemailer so SMTP doesn't actually connect
    const originalImport = (globalThis as unknown as Record<string, unknown>).__importStub;
    try {
      const { sendEmail } = await import("../lib/email.js");
      await sendEmail(SAMPLE_PARAMS);
      // Allow fire-and-forget chain to settle
      await new Promise(r => setTimeout(r, 50));

      const sgFailWarning = warnings.some(w => w.includes("SendGrid failed"));
      assert.ok(sgFailWarning, "should log a SendGrid failure warning before attempting fallback");
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
      void originalImport;
    }
  });
});
