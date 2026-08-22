/**
 * Unit tests for ucApiBaseUrl — the function that determines the base URL
 * embedded in password-reset email links.
 *
 * These tests guard against the production failure where REPLIT_DOMAINS is
 * absent (e.g. if the env var is renamed or unavailable) and customers receive
 * a localhost URL that they cannot reach.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ucApiBaseUrl } from "../lib/uc-reset-url.js";

describe("ucApiBaseUrl — reset-link domain resolution", () => {
  it("returns UC_RESET_BASE_URL verbatim (with trailing slash stripped) when set", () => {
    const url = ucApiBaseUrl({ UC_RESET_BASE_URL: "https://api.ucfilters.com/" });
    assert.equal(url, "https://api.ucfilters.com");
  });

  it("uses the first REPLIT_DOMAINS entry in a deployed environment", () => {
    const url = ucApiBaseUrl({ REPLIT_DOMAINS: "myapp.replit.app,myapp-dev.replit.app" });
    assert.equal(url, "https://myapp.replit.app/api");
  });

  it("trims whitespace from REPLIT_DOMAINS entries", () => {
    const url = ucApiBaseUrl({ REPLIT_DOMAINS: " myapp.replit.app , alt.replit.app " });
    assert.equal(url, "https://myapp.replit.app/api");
  });

  it("falls back to REPLIT_DEV_DOMAIN when REPLIT_DOMAINS is absent", () => {
    const url = ucApiBaseUrl({ REPLIT_DEV_DOMAIN: "abc123.replit.dev" });
    assert.equal(url, "https://abc123.replit.dev/api");
  });

  it("UC_RESET_BASE_URL takes priority over REPLIT_DOMAINS", () => {
    const url = ucApiBaseUrl({
      UC_RESET_BASE_URL: "https://custom.example.com",
      REPLIT_DOMAINS: "myapp.replit.app",
    });
    assert.equal(url, "https://custom.example.com");
  });

  it("uses a validated HTTPS explicit URL in production", () => {
    const url = ucApiBaseUrl({
      NODE_ENV: "production",
      UC_RESET_BASE_URL: "https://accounts.ucfilters.com/api",
    });
    assert.equal(url, "https://accounts.ucfilters.com/api");
  });

  it("rejects a localhost explicit URL in production", () => {
    assert.throws(
      () => ucApiBaseUrl({ NODE_ENV: "production", UC_RESET_BASE_URL: "http://localhost:8080/api" }),
      /HTTPS public URL/,
    );
  });

  it("rejects a non-HTTPS explicit URL in production", () => {
    assert.throws(
      () => ucApiBaseUrl({ NODE_ENV: "production", UC_RESET_BASE_URL: "http://accounts.ucfilters.com/api" }),
      /HTTPS public URL/,
    );
  });

  it("REPLIT_DOMAINS takes priority over REPLIT_DEV_DOMAIN", () => {
    const url = ucApiBaseUrl({
      REPLIT_DOMAINS: "deployed.replit.app",
      REPLIT_DEV_DOMAIN: "workspace.replit.dev",
    });
    assert.equal(url, "https://deployed.replit.app/api");
  });

  it("never returns a localhost URL when REPLIT_DOMAINS is set", () => {
    const url = ucApiBaseUrl({ REPLIT_DOMAINS: "production.replit.app" });
    assert.ok(
      !url.includes("localhost"),
      `URL must not contain localhost when REPLIT_DOMAINS is set, got: ${url}`,
    );
    assert.ok(url.startsWith("https://"), "URL must use HTTPS in a deployed environment");
  });

  it("never returns a localhost URL when REPLIT_DEV_DOMAIN is set", () => {
    const url = ucApiBaseUrl({ REPLIT_DEV_DOMAIN: "dev.replit.dev" });
    assert.ok(
      !url.includes("localhost"),
      `URL must not contain localhost when REPLIT_DEV_DOMAIN is set, got: ${url}`,
    );
  });

  it("rejects REPLIT_DEV_DOMAIN-only configuration in production", () => {
    assert.throws(
      () => ucApiBaseUrl({ NODE_ENV: "production", REPLIT_DEV_DOMAIN: "preview.replit.dev" }),
      /set UC_RESET_BASE_URL or REPLIT_DOMAINS/,
    );
  });

  it("localhost fallback is only used when no domain env var is set in local development", () => {
    const url = ucApiBaseUrl({ NODE_ENV: "development" });
    assert.ok(
      url.startsWith("http://localhost"),
      `Expected localhost fallback when no domain env var is set, got: ${url}`,
    );
  });

  it("throws instead of generating an unusable localhost link in production", () => {
    assert.throws(
      () => ucApiBaseUrl({ NODE_ENV: "production" }),
      /set UC_RESET_BASE_URL or REPLIT_DOMAINS/,
    );
  });
});
