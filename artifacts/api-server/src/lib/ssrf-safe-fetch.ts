/**
 * SSRF-safe outbound HTTPS POST utility for admin-configured webhook URLs.
 *
 * Threat model
 * ────────────
 *  • DNS rebinding: a hostname that resolves to a public IP at save-time can
 *    rebind to a private/loopback address before a later request.
 *  • Split-brain DNS: some DNS answers may be public, others private.
 *  • Redirect-based SSRF: an n8n endpoint could return 3xx → internal service.
 *
 * Mitigations applied here
 * ────────────────────────
 *  • validateWebhookDestination: save-time UX guard (immediate feedback to admin).
 *  • ssrfSafePost: enforcement at every request:
 *      1. Resolves ALL A and AAAA records via dns.resolve4/resolve6 (not just one).
 *      2. Rejects ANY private/loopback/link-local/cloud-metadata answer.
 *      3. Pins the TCP connection to the first validated IP via https.request's
 *         `lookup` callback — the OS cannot re-resolve after our check.
 *      4. Preserves TLS SNI (`servername`) so the certificate is validated
 *         against the original hostname, not the raw IP.
 *      5. Sets `Host` header to the original hostname (virtual-host routing).
 *      6. https.request does not follow redirects automatically; any 3xx is
 *         returned as-is and the caller treats it as non-OK.
 */

import { resolve4, resolve6 } from "node:dns/promises";
import https from "node:https";
import { isIPv4 } from "node:net";

// ─── Private / reserved IP detection ─────────────────────────────────────────

/**
 * Returns true for any IPv4 address that must never be used as a webhook
 * destination: loopback, RFC1918, link-local (incl. cloud metadata endpoint),
 * "this" network, multicast, and reserved ranges.
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false; // Malformed — not a valid IPv4 at all
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||                              // 0.0.0.0/8 — "this" network
    a === 10 ||                             // 10.0.0.0/8 — RFC1918
    a === 127 ||                            // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) ||             // 169.254.0.0/16 — link-local + IMDS
    (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12 — RFC1918
    (a === 192 && b === 168) ||             // 192.168.0.0/16 — RFC1918
    a >= 224                                // 224+ — multicast / reserved
  );
}

/**
 * Returns true for any IPv6 address that must never be used as a webhook
 * destination: loopback, ULA (fc00::/7), link-local (fe80::/10), and
 * IPv4-mapped addresses (which are re-blocked via the IPv4 path anyway).
 */
export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    lower === "::1" ||               // loopback
    lower.startsWith("fc") ||        // ULA fc00::/7
    lower.startsWith("fd") ||
    lower.startsWith("fe80:") ||     // link-local fe80::/10
    lower.startsWith("::ffff:")      // IPv4-mapped — caller should re-check as IPv4
  );
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class SsrfBlockedError extends Error {
  constructor(public readonly address: string) {
    super(
      `Webhook URL blocked: hostname resolves to a private/loopback address (${address}). ` +
        "Webhook URLs must point to an external HTTPS server.",
    );
    this.name = "SsrfBlockedError";
  }
}

// ─── Blocked hostnames ────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "metadata.google.internal",
  "169.254.169.254",
]);

// ─── DNS resolution + validation ─────────────────────────────────────────────

/**
 * Resolves ALL A and AAAA records for hostname via dns.resolve4/resolve6
 * (not dns.lookup, which returns one answer and may use /etc/hosts tricks).
 *
 * Throws SsrfBlockedError if ANY resolved address is private/reserved.
 * Throws a plain Error if no addresses could be resolved.
 * Returns validated addresses (IPv4 first) on success.
 */
export async function getAllAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const [v4Result, v6Result] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);

  const validated: Array<{ address: string; family: 4 | 6 }> = [];

  if (v4Result.status === "fulfilled") {
    for (const ip of v4Result.value) {
      if (isPrivateIpv4(ip)) throw new SsrfBlockedError(ip);
      validated.push({ address: ip, family: 4 });
    }
  }

  if (v6Result.status === "fulfilled") {
    for (const ip of v6Result.value) {
      if (isPrivateIpv6(ip)) throw new SsrfBlockedError(ip);
      validated.push({ address: ip, family: 6 });
    }
  }

  if (validated.length === 0) {
    throw new Error(
      "Cannot resolve webhook URL hostname — verify the n8n domain is correct and reachable",
    );
  }

  return validated;
}

// ─── Save-time UX validation ──────────────────────────────────────────────────

/**
 * Validates a raw URL string before storing it. Returns null when the URL is
 * acceptable, or an error string to return to the admin.
 *
 * This is a save-time UX guard that provides immediate feedback. The actual
 * SSRF enforcement happens at request time inside ssrfSafePost — the two are
 * complementary, not alternatives.
 */
export async function validateWebhookDestination(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "Invalid URL — must be a fully-qualified https:// address";
  }

  if (url.protocol !== "https:") {
    return "Webhook URL must use HTTPS (https://)";
  }

  const hostname = url.hostname.toLowerCase();

  // Bare IPv4 literals — checked immediately without DNS
  if (isIPv4(hostname)) {
    return isPrivateIpv4(hostname)
      ? "Webhook URL must point to an external server (private/loopback IP not permitted)"
      : null; // Public IPv4 literal — OK
  }

  // Known-dangerous hostnames (also caught by DNS, but blocked first for speed)
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return "Webhook URL must point to an external HTTPS server";
  }

  // Resolve via DNS and validate all answers
  try {
    await getAllAddresses(hostname);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return "Webhook URL must point to an external server (hostname resolves to a private/loopback address)";
    }
    return "Cannot resolve webhook URL hostname — verify the n8n domain is correct and reachable";
  }

  return null; // All checks passed
}

// ─── Request-time SSRF-safe POST ─────────────────────────────────────────────

/**
 * Performs a HTTPS POST to `webhookUrl` with full SSRF enforcement at request
 * time. See module-level doc for the complete mitigation list.
 *
 * Returns the HTTP status code (caller decides whether it's ok).
 * Throws SsrfBlockedError, AbortError (name === "AbortError"), or a network Error.
 */
export async function ssrfSafePost(
  webhookUrl: string,
  body: string,
  signal: AbortSignal,
): Promise<number> {
  const url = new URL(webhookUrl);
  const hostname = url.hostname;
  const port = url.port ? parseInt(url.port, 10) : 443;

  // ── 1. Resolve ALL A/AAAA at request time — defeats DNS rebinding ──────────
  const addresses = await getAllAddresses(hostname);
  const pinned = addresses[0]!; // First validated address

  // ── 2. Make the connection pinned to the validated IP ──────────────────────
  return new Promise<number>((resolve, reject) => {
    const bodyBuf = Buffer.from(body, "utf8");

    const req = https.request(
      {
        // Connecting to the pre-validated IP prevents the OS from re-resolving.
        host: pinned.address,
        port,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          Host:             hostname,       // Virtual-host routing on n8n
          "Content-Type":   "application/json",
          "Content-Length": bodyBuf.byteLength,
        },
        // TLS SNI: cert is checked against the original hostname, not the raw IP.
        servername: hostname,
        // Custom lookup always returns our pre-validated pinned IP.
        // This is an extra guard: even if Node internals re-resolve (e.g. for
        // proxies), our callback intercepts and returns only the validated IP.
        lookup: (
          _host: string,
          _opts: { all?: boolean; family?: number },
          cb: (
            err: Error | null,
            addr: string | Array<{ address: string; family: number }>,
            fam?: number,
          ) => void,
        ) => {
          // Some callers pass { all: true } and expect an array back.
          if ((_opts as { all?: boolean }).all) {
            cb(null, [{ address: pinned.address, family: pinned.family }]);
          } else {
            cb(null, pinned.address, pinned.family);
          }
        },
        // https.request does NOT follow redirects — any 3xx is returned as-is.
      },
      (res) => {
        res.resume(); // Drain and discard response body
        resolve(res.statusCode ?? 0);
      },
    );

    // Wire up AbortSignal
    const onAbort = () => {
      req.destroy();
      reject(Object.assign(new Error("n8n webhook timed out"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal.removeEventListener("abort", onAbort));
    req.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    req.write(bodyBuf);
    req.end();
  });
}
