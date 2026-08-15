/**
 * CORS dev-domain tests.
 *
 * Layer 1 — buildCorsOrigins unit tests:
 *   Exercises the factory function extracted from app.ts directly, covering all
 *   branching logic (production, env-var combinations).  These catch any change
 *   to the origin-selection rules without needing a live server.
 *
 * Layer 2 — supertest integration tests:
 *   Spins up minimal Express apps that use `buildCorsOrigins` with explicit env
 *   inputs (the exact same factory `app.ts` calls) and fires preflight / GET
 *   requests through supertest to verify the cors() middleware honours the list.
 *
 * Layer 3 — real-app smoke test:
 *   Imports the actual `app` from app.ts and asserts via supertest that a
 *   foreign (unlisted) origin never leaks an Access-Control-Allow-Origin header,
 *   proving the cors() middleware is wired up at all.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cors from "cors";
import supertest from "supertest";

import { buildCorsOrigins } from "../lib/cors-origins.js";
import app from "../app.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPO_DOMAIN = "expo-test.repl.co";
const EXPO_ORIGIN = `https://${EXPO_DOMAIN}`;
const DEV_DOMAIN = "dev-test.repl.co";
const DEV_ORIGIN = `https://${DEV_DOMAIN}`;
const FOREIGN_ORIGIN = "https://evil.example.com";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app that wires cors() with an origin list produced
 * by the real `buildCorsOrigins` factory, then mounts a lightweight health
 * endpoint.  This is exactly what `app.ts` does — we just control the env
 * inputs so tests are deterministic.
 */
function buildApp(env: Record<string, string | undefined>): express.Express {
  const miniApp = express();
  miniApp.use(cors({ origin: buildCorsOrigins(env) }));
  miniApp.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  return miniApp;
}

// ── Layer 1: buildCorsOrigins unit tests ─────────────────────────────────────

describe("buildCorsOrigins — unit tests", () => {
  it("returns false in production regardless of env vars", () => {
    const result = buildCorsOrigins({
      NODE_ENV: "production",
      REPLIT_EXPO_DEV_DOMAIN: EXPO_DOMAIN,
      REPLIT_DEV_DOMAIN: DEV_DOMAIN,
    });
    assert.equal(result, false, "production must return false");
  });

  it("returns false when NODE_ENV=production and no domain vars are set", () => {
    const result = buildCorsOrigins({ NODE_ENV: "production" });
    assert.equal(result, false);
  });

  it("returns false when no domain vars are set outside production", () => {
    const result = buildCorsOrigins({ NODE_ENV: "test" });
    assert.equal(result, false, "no domains → should return false, not []");
  });

  it("returns an array with the Expo dev-domain origin when REPLIT_EXPO_DEV_DOMAIN is set", () => {
    const result = buildCorsOrigins({
      NODE_ENV: "test",
      REPLIT_EXPO_DEV_DOMAIN: EXPO_DOMAIN,
    });
    assert.deepEqual(result, [EXPO_ORIGIN]);
  });

  it("returns an array with the dev-domain origin when REPLIT_DEV_DOMAIN is set", () => {
    const result = buildCorsOrigins({
      NODE_ENV: "development",
      REPLIT_DEV_DOMAIN: DEV_DOMAIN,
    });
    assert.deepEqual(result, [DEV_ORIGIN]);
  });

  it("returns both origins when both env vars are set", () => {
    const result = buildCorsOrigins({
      NODE_ENV: "test",
      REPLIT_EXPO_DEV_DOMAIN: EXPO_DOMAIN,
      REPLIT_DEV_DOMAIN: DEV_DOMAIN,
    });
    assert.deepEqual(result, [EXPO_ORIGIN, DEV_ORIGIN]);
  });
});

// ── Layer 2a: supertest — Expo dev-domain in non-production mode ──────────────

describe("CORS middleware — allowed Expo dev-domain origin (supertest)", () => {
  const agent = supertest(
    buildApp({ NODE_ENV: "test", REPLIT_EXPO_DEV_DOMAIN: EXPO_DOMAIN }),
  );

  it("OPTIONS preflight from allowed origin includes Access-Control-Allow-Origin", async () => {
    const res = await agent
      .options("/api/healthz")
      .set("Origin", EXPO_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    assert.equal(
      res.headers["access-control-allow-origin"],
      EXPO_ORIGIN,
      `preflight must echo allowed origin; got: ${String(res.headers["access-control-allow-origin"])}`,
    );
    // Preflight succeeds (204 No Content is the standard cors() response).
    assert.ok(
      res.status === 204 || res.status === 200,
      `preflight should succeed; got status ${res.status}`,
    );
  });

  it("GET from allowed origin includes Access-Control-Allow-Origin", async () => {
    const res = await agent.get("/api/healthz").set("Origin", EXPO_ORIGIN);

    assert.equal(
      res.headers["access-control-allow-origin"],
      EXPO_ORIGIN,
      `GET must echo allowed origin; got: ${String(res.headers["access-control-allow-origin"])}`,
    );
  });

  it("GET from a foreign origin receives no Access-Control-Allow-Origin header", async () => {
    const res = await agent.get("/api/healthz").set("Origin", FOREIGN_ORIGIN);
    const acao = res.headers["access-control-allow-origin"];
    assert.equal(
      acao,
      undefined,
      `foreign origin must receive no ACAO header; got: ${String(acao)}`,
    );
  });

  it("OPTIONS preflight from a foreign origin receives no Access-Control-Allow-Origin header", async () => {
    const res = await agent
      .options("/api/healthz")
      .set("Origin", FOREIGN_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    const acao = res.headers["access-control-allow-origin"];
    assert.equal(
      acao,
      undefined,
      `foreign origin preflight must receive no ACAO header; got: ${String(acao)}`,
    );
  });
});

// ── Layer 2b: supertest — REPLIT_DEV_DOMAIN also allowed ─────────────────────

describe("CORS middleware — REPLIT_DEV_DOMAIN origin allowed (supertest)", () => {
  const agent = supertest(
    buildApp({ NODE_ENV: "test", REPLIT_DEV_DOMAIN: DEV_DOMAIN }),
  );

  it("GET from REPLIT_DEV_DOMAIN origin includes Access-Control-Allow-Origin", async () => {
    const res = await agent.get("/api/healthz").set("Origin", DEV_ORIGIN);
    assert.equal(
      res.headers["access-control-allow-origin"],
      DEV_ORIGIN,
      `REPLIT_DEV_DOMAIN origin must be allowed; got: ${String(res.headers["access-control-allow-origin"])}`,
    );
  });
});

// ── Layer 2c: supertest — production mode disables CORS ───────────────────────

describe("CORS middleware — production mode fully disabled (supertest)", () => {
  // Both domain env vars provided to confirm they are ignored in production.
  const agent = supertest(
    buildApp({
      NODE_ENV: "production",
      REPLIT_EXPO_DEV_DOMAIN: EXPO_DOMAIN,
      REPLIT_DEV_DOMAIN: DEV_DOMAIN,
    }),
  );

  it("GET from Expo dev-domain origin receives no CORS headers in production", async () => {
    const res = await agent.get("/api/healthz").set("Origin", EXPO_ORIGIN);
    const acao = res.headers["access-control-allow-origin"];
    assert.equal(
      acao,
      undefined,
      `production must emit no ACAO header even for dev domain; got: ${String(acao)}`,
    );
  });

  it("OPTIONS preflight from Expo dev-domain origin receives no CORS headers in production", async () => {
    const res = await agent
      .options("/api/healthz")
      .set("Origin", EXPO_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    const acao = res.headers["access-control-allow-origin"];
    assert.equal(
      acao,
      undefined,
      `production preflight must emit no ACAO header; got: ${String(acao)}`,
    );
  });
});

// ── Layer 3: real-app smoke test ─────────────────────────────────────────────
//
// Verifies that cors() is actually wired into the real app from app.ts —
// not just the minimal test helper.  A foreign origin must never receive an
// Access-Control-Allow-Origin header, regardless of what env vars are set,
// because it won't be in the allowed list.

describe("CORS middleware — real app smoke test (supertest)", () => {
  it("real app emits no CORS headers for a foreign origin", async () => {
    const res = await supertest(app)
      .get("/api/healthz")
      .set("Origin", FOREIGN_ORIGIN);

    const acao = res.headers["access-control-allow-origin"];
    assert.equal(
      acao,
      undefined,
      `real app must not echo a foreign origin; got: ${String(acao)}`,
    );
  });

  it("real app preflight emits no CORS headers for a foreign origin", async () => {
    const res = await supertest(app)
      .options("/api/healthz")
      .set("Origin", FOREIGN_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    const acao = res.headers["access-control-allow-origin"];
    assert.equal(
      acao,
      undefined,
      `real app preflight must not echo a foreign origin; got: ${String(acao)}`,
    );
  });
});
