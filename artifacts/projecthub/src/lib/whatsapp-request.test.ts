import { afterEach, describe, expect, it, vi } from "vitest";
import { whatsappRequest } from "./whatsapp-request";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded WhatsApp requests", () => {
  it("returns successful status and disables caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: "qr" })));
    vi.stubGlobal("fetch", fetcher);
    await expect(whatsappRequest("/api/whatsapp/status", {}, "timeout")).resolves.toEqual({ state: "qr" });
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
  });

  it("shows the safe cleanup failure returned by the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Retry Disconnect before pairing." }), { status: 503 }),
    ));
    await expect(whatsappRequest("/api/whatsapp/disconnect", {}, "timeout")).rejects.toThrow("Retry Disconnect");
  });

  it("bounds a stalled fetch", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = whatsappRequest("/api/whatsapp/connect", {}, "Pairing timed out", 100);
    const assertion = expect(pending).rejects.toThrow("Pairing timed out");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("also bounds a response whose body never finishes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    })));
    const pending = whatsappRequest("/api/whatsapp/connect", {}, "Body timed out", 100);
    const assertion = expect(pending).rejects.toThrow("Body timed out");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("reports expired authentication rather than retrying automatically", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(whatsappRequest("/api/whatsapp/status", {}, "timeout")).rejects.toThrow("Session expired");
  });
});