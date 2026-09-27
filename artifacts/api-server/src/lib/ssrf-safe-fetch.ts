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
import { isIPv4, isIPv6 } from "node:net";

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
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||                              // 0.0.0.0/8 — "this" network
    a === 10 ||                             // 10.0.0.0/8 — RFC1918
    (a === 100 && b >= 64 && b <= 127) ||   // 100.64.0.0/10 — shared address space
    a === 127 ||                            // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) ||             // 169.254.0.0/16 — link-local + IMDS
    (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12 — RFC1918
    (a === 192 && b === 0) ||               // 192.0.0.0/24 — IETF protocol assignments
    (a === 192 && b === 2) ||               // 192.0.2.0/24 — documentation
    (a === 192 && b === 31 && c === 196) || // AS112-v4 direct delegation
    (a === 192 && b === 52 && c === 193) || // AMT relay anycast
    (a === 192 && b === 88 && c === 99) ||  // deprecated 6to4 relay anycast
    (a === 192 && b === 168) ||             // 192.168.0.0/16 — RFC1918
    (a === 192 && b === 175 && c === 48) || // AS112-v4 direct delegation
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 — benchmarking
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 — documentation
    (a === 203 && b === 0 && c === 113) ||  // 203.0.113.0/24 — documentation
    a >= 224                                // 224+ — multicast / reserved
  );
}

function ipv6ToBigInt(ip: string): bigint | null {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!isIPv6(normalized)) return null;

  // Convert an optional dotted-quad tail to its two hextets first.
  const withHexTail = normalized.replace(
    /(\d{1,3}(?:\.\d{1,3}){3})$/,
    (dotted) => {
      const octets = dotted.split(".").map(Number);
      if (octets.some(octet => octet < 0 || octet > 255)) return dotted;
      return `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
    },
  );
  const halves = withHexTail.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function isIpv6InRange(ip: bigint, network: string, prefixLength: number): boolean {
  const networkValue = ipv6ToBigInt(network);
  if (networkValue === null) return true;
  const shift = 128n - BigInt(prefixLength);
  return (ip >> shift) === (networkValue >> shift);
}

const IPV6_SPECIAL_USE_RANGES: ReadonlyArray<readonly [network: string, prefixLength: number]> = [
  ["64:ff9b::", 96],       // IPv4/IPv6 translation
  ["64:ff9b:1::", 48],     // local-use IPv4/IPv6 translation
  ["2001::", 23],          // IETF protocol assignments (Teredo, benchmark, AMT, ORCHID)
  ["2001:db8::", 32],      // documentation
  ["2002::", 16],          // 6to4 (embedded IPv4 destination)
  ["2620:4f:8000::", 48],  // AS112-v6 direct delegation
  ["3fff::", 20],          // documentation
  ["5f00::", 16],          // Segment Routing (SRv6) SIDs
];

/**
 * Returns true unless an IPv6 address is a global-unicast address
 * (2000::/3). Default-denying every other IPv6 range blocks loopback, ULA,
 * link-local (the entire fe80::/10 range), unspecified, multicast,
 * documentation, IPv4-mapped, and any malformed value.
 */
export function isPrivateIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);
  if (value === null) return true;

  // The first 3 bits of a global-unicast address are 001 (2000::/3).
  // Parsing the first hextet correctly covers all compressed forms and the
  // whole fe80::/10 range (fe80 through febf), unlike string-prefix checks.
  const firstHextet = Number(value >> 112n);
  return (
    (firstHextet & 0xe000) !== 0x2000 ||
    IPV6_SPECIAL_USE_RANGES.some(([network, prefixLength]) =>
      isIpv6InRange(value, network, prefixLength),
    )
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
  const literal = hostname.replace(/^\[|\]$/g, "");

  // IP literals have no DNS record to resolve. Validate and return a pinned
  // address directly so a URL accepted at save-time can also be delivered at
  // request-time without calling resolve4/resolve6 (which returns ENOTFOUND
  // for a literal).
  if (isIPv4(literal)) {
    if (isPrivateIpv4(literal)) throw new SsrfBlockedError(literal);
    return [{ address: literal, family: 4 }];
  }
  if (isIPv6(literal)) {
    if (isPrivateIpv6(literal)) throw new SsrfBlockedError(literal);
    return [{ address: literal, family: 6 }];
  }

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

  // Bare IPv4 literals — checked immediately without DNS.
  if (isIPv4(hostname)) {
    return isPrivateIpv4(hostname)
      ? "Webhook URL must point to an external server (private/loopback IP not permitted)"
      : null; // Public IPv4 literal — OK
  }
  // URL.hostname preserves brackets around IPv6 literals.
  if (isIPv6(hostname.replace(/^\[|\]$/g, ""))) {
    return isPrivateIpv6(hostname)
      ? "Webhook URL must point to an external server (private/loopback IP not permitted)"
      : null; // Public IPv6 literal — OK
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
  const hostnameWithoutBrackets = hostname.replace(/^\[|\]$/g, "");
  const port = url.port ? parseInt(url.port, 10) : 443;
  const isIpLiteral = isIPv4(hostnameWithoutBrackets) || isIPv6(hostnameWithoutBrackets);

  // ── 1. Resolve ALL A/AAAA at request time — defeats DNS rebinding ──────────
  // Public IP literals are validated and returned directly by getAllAddresses.
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
          Host:             url.port ? url.host : hostname, // Virtual-host routing on n8n
          "Content-Type":   "application/json",
          "Content-Length": bodyBuf.byteLength,
        },
        // TLS SNI: cert is checked against the original hostname, not the raw IP.
        // IP literals do not have an SNI hostname; TLS will validate their IP SAN.
        servername: isIpLiteral ? undefined : hostnameWithoutBrackets,
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
