/**
 * Temporary, development-only ingress for the explicitly approved synthetic
 * payment fixture. Never forwards to the normal API router or a dynamic host.
 */
import type { RequestHandler } from "express";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FIXTURE_PREFIX = "/api/guest-pay-fixture";
const LOCAL = "http://127.0.0.1:39761";
const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff",
};
interface Control {
  pid: number; database: string; port: number; mode: string;
  instance: string; publicOrigin: string; basePath: string;
}
export function publicFixtureOrigin(env: NodeJS.ProcessEnv): string | null {
  if (env.NODE_ENV !== "development" || (env.REPLIT_DEPLOYMENT &&
      !["false", "0"].includes(env.REPLIT_DEPLOYMENT))) return null;
  try {
    const url = new URL(`https://${env.REPLIT_DEV_DOMAIN}`);
    return url.hostname.endsWith(".replit.dev") && !url.port && !url.username &&
      !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
export function fixtureRoute(route: string, method: string, mpesa: boolean): string | null {
  if (route === "/status" && method === "GET") return "status";
  if (/^\/pay(?:\/[A-Za-z0-9._~-]{1,512})?\/?$/.test(route) && ["GET", "HEAD"].includes(method)) return "document";
  if (/^\/guest-pay\/(summary|initialize|reconcile)$/.test(route) && method === "POST") return "private_proxy";
  if (route === "/api/payments/mpesa/callback" && method === "POST" && mpesa) return "mpesa_callback";
  return null;
}
async function ownedControl(origin: string): Promise<Control | null> {
  const matches: Control[] = [];
  for (const name of await readdir(os.tmpdir())) {
    if (!/^guestpay-fixture-[A-Za-z0-9]+$/.test(name)) continue;
    try {
      const dir = path.join(os.tmpdir(), name);
      const info = await lstat(dir), file = await lstat(path.join(dir, "control.json"));
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 ||
          !file.isFile() || file.isSymbolicLink() || (file.mode & 0o777) !== 0o600 ||
          file.size > 4096 || info.uid !== process.getuid!() || file.uid !== process.getuid!()) continue;
      const control = JSON.parse(await readFile(path.join(dir, "control.json"), "utf8")) as Control;
      if (!Number.isInteger(control.pid) || control.pid < 2 ||
          !/^guestpay_fixture_\d{13}_\d+$/.test(control.database) ||
          !control.database.endsWith("_" + control.pid) || control.port !== 39761 ||
          !["https-preparation", "mpesa-sandbox"].includes(control.mode) ||
          !/^[a-f0-9-]{36}$/.test(control.instance) || control.publicOrigin !== origin ||
          control.basePath !== FIXTURE_PREFIX) continue;
      process.kill(control.pid, 0);
      const cwd = await readlink(`/proc/${control.pid}/cwd`);
      const args = (await readFile(`/proc/${control.pid}/cmdline`, "utf8")).split("\0");
      if (!args.some(arg => path.resolve(cwd, arg).endsWith("/api-server/scripts/guest-pay-fixture.cjs")) ||
          !args.includes(control.mode === "mpesa-sandbox" ? "--serve-mpesa" : "--serve-https")) continue;
      matches.push(control);
    } catch { /* Dead, incomplete or untrusted fixture: never select it. */ }
  }
  return matches.length === 1 ? matches[0]! : null;
}
interface Options {
  env?: NodeJS.ProcessEnv;
  getControl?: (origin: string) => Promise<Control | null>;
  fetchImpl?: typeof fetch;
  record?: (fields: { family: string; status: number }) => void;
}
export function createDevelopmentFixtureProxy(options: Options = {}): RequestHandler {
  const { env = process.env, getControl = ownedControl, fetchImpl = fetch, record = () => {} } = options;
  return async (req, res) => {
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) res.setHeader(key, value);
    let family = "blocked";
    res.on("finish", () => record({ family, status: res.statusCode }));
    const fail = (status: number) => { res.status(status).json({ error: "Test fixture unavailable" }); };
    const origin = publicFixtureOrigin(env);
    if (!origin) { fail(404); return; }
    if (req.headers.origin && req.headers.origin !== origin) { fail(403); return; }
    try {
      // req.url is relative to the namespace mount. Reject encoded/dot traversal
      // before URL normalization, never re-dispatch unknown paths to the API.
      const route = req.url.split(/[?#]/, 1)[0] || "";
      if (route.includes("%") || route.includes("..") || route.includes("\\")) { fail(404); return; }
      const control = await getControl(origin);
      if (!control) { fail(503); return; }
      const allowed = fixtureRoute(route, req.method, control.mode === "mpesa-sandbox");
      if (!allowed) { fail(404); return; }
      family = allowed;
      const probe = await fetchImpl(LOCAL + "/_fixture/health", {
        redirect: "error", signal: AbortSignal.timeout(2500),
      });
      if (!probe.ok) { fail(503); return; }
      const value = await probe.json();
      if (!value || typeof value !== "object") { fail(503); return; }
      const health = value as Record<string, unknown>;
      if (health.instance !== control.instance || health.mode !== control.mode ||
          health.publicOrigin !== origin || health.basePath !== FIXTURE_PREFIX ||
          health.isolated !== true || health.syntheticData !== true ||
          health.originalBuyerRetained !== true || health.orders !== 1 || health.buyers !== 1 ||
          health.providersEnabled !== (control.mode === "mpesa-sandbox") ||
          health.simulationsEnabled !== false || health.notificationsEnabled !== false ||
          health.analyticsEnabled !== false) { fail(503); return; }
      if (allowed === "status") {
        res.json({ ready: true, sandboxOnly: true, syntheticData: true,
          paymentsEnabled: health.paymentsEnabled === true });
        return;
      }
      let body: Buffer | undefined;
      if (req.method === "POST") {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) { fail(400); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        const timer = setTimeout(() => req.destroy(), 5000);
        try {
          for await (const chunk of req) {
            size += Buffer.byteLength(chunk);
            if (size > 8192) { fail(413); req.resume(); return; }
            chunks.push(Buffer.from(chunk));
          }
        } finally { clearTimeout(timer); }
        body = Buffer.concat(chunks);
        try { JSON.parse(body.toString("utf8")); } catch { fail(400); return; }
      }
      const response = await fetchImpl(LOCAL + req.url, {
        method: req.method, redirect: "error",
        headers: { ...(body ? { "content-type": "application/json" } : {}),
          ...(req.headers.origin ? { origin } : {}) },
        ...(body ? { body: new Uint8Array(body) } : {}),
        signal: AbortSignal.timeout(40000),
      });
      for (const name of ["content-type", "content-security-policy"]) {
        const value = response.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      // Do not forward redirects, cookies, provider/debug headers or raw errors.
      if (response.status >= 300 && response.status < 400) { fail(503); return; }
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 128 * 1024) { fail(503); return; }
      res.status(response.status).end(req.method === "HEAD" ? undefined : data);
    } catch {
      if (!res.headersSent) fail(503); else res.end();
    }
  };
}
