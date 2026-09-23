/**
 * Tests that the water-chat endpoint returns a 502 with a user-friendly
 * message when the Anthropic AI service is unavailable.
 *
 * Strategy:
 *   The route exports `_aiClient` — a thin shim around anthropic.messages.create
 *   that tests can replace on the fly (the same injection pattern used by
 *   checkAdminAuth).  We swap in a stub that always throws, start a minimal
 *   Express server, make a real HTTP request, and assert on the response.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { issueToken } from "../lib/jwt.js";
import { _aiClient } from "../routes/uc-water-chat.js";

// ─── Minimal test app (no DB connections, no cron jobs) ──────────────────────
// Import the router *after* the shim is available so the same module instance
// is shared between the test and the route handler.
const { default: waterChatRouter } = await import("../routes/uc-water-chat.js");

const testApp = express();
testApp.use(express.json());
testApp.use("/api", waterChatRouter);

// ─── Helper: one-shot JSON HTTP request ──────────────────────────────────────
function jsonRequest(
  server: http.Server,
  method: string,
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as AddressInfo).port;
    const json = JSON.stringify(body);
    const req  = http.request(
      {
        hostname : "127.0.0.1",
        port,
        path,
        method,
        headers  : {
          "Content-Type"   : "application/json",
          "Content-Length" : Buffer.byteLength(json),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as unknown });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("water-chat — Anthropic service-down handling", () => {
  let server: http.Server;
  let savedSecret: string | undefined;

  // Save and restore the original shim so these tests cannot affect other suites
  const originalCreate = _aiClient.create;

  before(
    () =>
      new Promise<void>((resolve, reject) => {
        savedSecret                   = process.env["SESSION_SECRET"];
        process.env["SESSION_SECRET"] = "test-secret-for-ai-error";
        server = http.createServer(testApp);
        server.listen(0, "127.0.0.1", () => resolve());
        server.on("error", reject);
      }),
  );

  after(
    () =>
      new Promise<void>((resolve) => {
        if (savedSecret !== undefined) {
          process.env["SESSION_SECRET"] = savedSecret;
        } else {
          delete process.env["SESSION_SECRET"];
        }
        server.close(() => resolve());
      }),
  );

  // Install the "Anthropic is down" stub before each test, restore after
  beforeEach(() => {
    _aiClient.create = async () => {
      throw new Error("anthropic: 529 Overloaded");
    };
  });

  afterEach(() => {
    _aiClient.create = originalCreate;
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function bearerFor(userId: number, email = "user@example.com"): string {
    return `Bearer ${issueToken({ id: userId, email })}`;
  }

  const VALID_BODY = {
    messages: [{ role: "user", content: "Hello" }],
    conversationId: "conversation-test-0001",
    turnId: "turn-test-00000001",
  };

  // ── test cases ───────────────────────────────────────────────────────────

  it("responds HTTP 502 when Anthropic throws", async () => {
    const res = await jsonRequest(
      server,
      "POST",
      "/api/uc/ai/water-chat",
      VALID_BODY,
      { Authorization: bearerFor(1) },
    );

    assert.equal(
      res.status,
      502,
      `Expected HTTP 502 but got ${res.status}. Body: ${JSON.stringify(res.body)}`,
    );
  });

  it("returns a user-friendly error string (not a stack trace) when Anthropic throws", async () => {
    const res = await jsonRequest(
      server,
      "POST",
      "/api/uc/ai/water-chat",
      VALID_BODY,
      { Authorization: bearerFor(2) },
    );

    assert.equal(res.status, 502);

    const body = res.body as Record<string, unknown>;

    // Must have an 'error' field that is a non-empty string
    assert.ok(
      typeof body["error"] === "string" && (body["error"] as string).length > 0,
      `Response body must contain an 'error' string. Got: ${JSON.stringify(body)}`,
    );

    const msg = body["error"] as string;

    // Must include the support phone number — confirms friendly copy
    assert.ok(
      msg.includes("0717774049"),
      `Error must include support number 0717774049. Got: ${msg}`,
    );

    // Must not leak raw upstream error details
    assert.ok(
      !msg.includes("529"),
      `Error must not expose raw upstream status codes. Got: ${msg}`,
    );

    // Must not expose a Node.js stack trace
    assert.ok(
      !msg.toLowerCase().includes("    at "),
      `Error must not contain stack-trace frames. Got: ${msg}`,
    );
  });

  it("returns a JSON object (not plain text or HTML) when Anthropic throws", async () => {
    const res = await jsonRequest(
      server,
      "POST",
      "/api/uc/ai/water-chat",
      VALID_BODY,
      { Authorization: bearerFor(3) },
    );

    assert.equal(res.status, 502);

    // jsonRequest returns a string when JSON.parse fails; object means valid JSON
    assert.ok(
      typeof res.body === "object" && res.body !== null,
      `502 body must parse as a JSON object. Got: ${JSON.stringify(res.body)}`,
    );
  });
});
