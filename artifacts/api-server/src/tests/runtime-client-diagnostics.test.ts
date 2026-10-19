import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRuntimeReporter, diagnosticRoute, sanitizedFrames, installNativeRuntimeDiagnostics, installWebRuntimeDiagnostics, setRuntimeReadReporter } from "../../../../lib/api-client-react/src/runtime-diagnostics.js";
import { customFetch, setAuthTokenGetter, setBaseUrl, setErrorResponseHandler } from "../../../../lib/api-client-react/src/custom-fetch.js";

const settle = () => new Promise(resolve => setTimeout(resolve, 15));
const context = () => ({ app: "companion" as const, environment: "development" as const, platform: "web" as const, browser: "chrome" as const, release: "development", routeClass: diagnosticRoute("/orders/private-id?token=credential") });

describe("client diagnostic isolation", () => {
  it("sends only reconstructed operational fields, no credentials/content/identity/URL or raw stack", async () => {
    const sent: Array<{ init: RequestInit; body: Record<string, unknown> }> = [];
    const reporter = createRuntimeReporter({ endpoint: "/api/diagnostics", context, fetcher: (async (_url, init) => {
      sent.push({ init: init!, body: JSON.parse(String(init?.body)) }); return new Response("", { status: 202 });
    }) as typeof fetch });
    const error = new Error("Entered email customer@example.com and token abc123");
    error.stack = "Error: customer@example.com\n at CustomerName (https://site.invalid/customer-id?token=abc123:12:8)";
    reporter("render", error);
    await settle();
    const serialized = JSON.stringify(sent.map(s => s.body));
    for (const secret of ["customer@example.com", "abc123", "CustomerName", "customer-id", "https://site.invalid", "credential", "Authorization"]) assert.ok(!serialized.includes(secret));
    assert.deepEqual(sent[0]!.body.frames, [{ asset: "bundle", line: 12, column: 8 }]);
    assert.equal(sent[0]!.body.routeClass, "orders");
    assert.equal(sent[0]!.init.credentials, "omit");
    assert.equal(sent[0]!.init.referrer, "");
    assert.equal(sent[0]!.init.referrerPolicy, "no-referrer");
    assert.ok(!("timestamp" in sent[0]!.body));
  });
  it("deduplicates and bounds reports and never retries, persists or propagates transport failure", async () => {
    let now = 1000; let calls = 0;
    const reporter = createRuntimeReporter({ endpoint: "/api/diagnostics", context, now: () => now,
      fetcher: (async () => { calls++; throw new Error("collector down"); }) as typeof fetch });
    assert.doesNotThrow(() => reporter("render", new Error("private")));
    await settle();
    reporter("render"); reporter("unhandled_error"); reporter("api_read_failed");
    await settle(); assert.equal(calls, 1);
    now += 61000; reporter("render"); await settle(); assert.equal(calls, 2);
    const goodCalls: unknown[] = [];
    const good = createRuntimeReporter({ endpoint: "/api/diagnostics", context, fetcher: (async (_url, init) => { goodCalls.push(init); return new Response("", { status: 202 }); }) as typeof fetch });
    for (let i=0;i<12;i++) {
      const error = new Error(); error.stack = `Error\n at bundle:${i}:1`;
      good("render", error); await settle();
    }
    assert.equal(goodCalls.length, 10);
  });
  it("captures supported web errors/rejections and restores listeners", async () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const reporter = ((category: string) => { calls.push(category); }) as ReturnType<typeof createRuntimeReporter>;
    const remove = installWebRuntimeDiagnostics(reporter, target as unknown as Window);
    target.dispatchEvent(new Event("error")); target.dispatchEvent(new Event("unhandledrejection"));
    assert.deepEqual(calls, ["unhandled_error", "unhandled_rejection"]);
    remove(); target.dispatchEvent(new Event("error")); assert.equal(calls.length, 2);
  });
  it("preserves native fatal handling, captures exposed production Hermes rejections and tolerates missing APIs", () => {
    let previousCalls = 0; const categories: string[] = [];
    const previous = () => { previousCalls++; };
    let handler: (error: Error, fatal?: boolean) => void = previous;
    let tracker: { onUnhandled(id: number, error: unknown): void } | undefined;
    const remove = installNativeRuntimeDiagnostics(((category: string) => { categories.push(category); }) as ReturnType<typeof createRuntimeReporter>, {
      errorUtils: { getGlobalHandler: () => handler, setGlobalHandler: next => { handler = next; } },
      rejectionTracker: { enablePromiseRejectionTracker: options => { tracker = options; } },
    });
    handler(new Error("private native content"), true);
    tracker!.onUnhandled(99, new Error("private rejection"));
    assert.equal(previousCalls, 1); assert.deepEqual(categories, ["unhandled_error", "unhandled_rejection"]);
    remove(); assert.equal(handler, previous);
    assert.doesNotThrow(() => installNativeRuntimeDiagnostics(() => {}, {}));
  });
  it("keeps frames and routes bounded, including adversarial stack getters", () => {
    const error = new Error(); Object.defineProperty(error, "stack", { get() { throw new Error("getter"); } });
    assert.deepEqual(sanitizedFrames(error), []);
    assert.equal(diagnosticRoute("/product/secret-id?phone=personal"), "product");
    assert.equal(diagnosticRoute("/uc-companion/auth/reset-password?token=secret"), "auth");
    assert.equal(diagnosticRoute("/other-secret-id"), "other");
    const privateMessage = new Error(); privateMessage.stack = "Error: customer phone:123:456\n at bundle:7:8";
    assert.deepEqual(sanitizedFrames(privateMessage), [{ asset: "bundle", line: 7, column: 8 }]);
  });
  it("reports generated API reads only, preserving auth recovery and never replaying writes", async () => {
    const original = globalThis.fetch;
    const categories: string[] = [];
    const remove = setRuntimeReadReporter(((category: string) => { categories.push(category); }) as ReturnType<typeof createRuntimeReporter>);
    let recovered = 0; let calls = 0;
    const clearHandler = setErrorResponseHandler(async () => { recovered++; });
    setBaseUrl(null); setAuthTokenGetter(() => "test-token-not-for-telemetry");
    try {
      globalThis.fetch = (async () => { calls++; return new Response('{"error":"private"}', { status: 401, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;
      await assert.rejects(customFetch("/api/uc/customer"));
      assert.equal(recovered, 1); assert.equal(categories.length, 0);
      globalThis.fetch = (async () => { calls++; throw new Error("network"); }) as typeof fetch;
      await assert.rejects(customFetch("/api/uc/orders", { method: "POST", body: "{}" }));
      assert.equal(categories.length, 0); assert.equal(calls, 2);
      await assert.rejects(customFetch("/api/uc/orders"));
      assert.deepEqual(categories, ["api_read_failed"]); assert.equal(calls, 3);
    } finally { globalThis.fetch = original; remove(); clearHandler(); setAuthTokenGetter(null); }
  });
});