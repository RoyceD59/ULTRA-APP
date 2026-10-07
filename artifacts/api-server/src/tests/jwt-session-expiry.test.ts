import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it, before, after } from "node:test";
import { CUSTOMER_SESSION_TTL_SECONDS, issueToken, verifyToken } from "../lib/jwt.js";

const originalSecret = process.env["SESSION_SECRET"];
before(() => { process.env["SESSION_SECRET"] = "session-expiry-test-only"; });
after(() => {
  if (originalSecret === undefined) delete process.env["SESSION_SECRET"];
  else process.env["SESSION_SECRET"] = originalSecret;
});

// Sign legacy/malformed fixtures without the issuance helper repairing exp.
function signedClaims(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const signature = createHmac("sha256", process.env["SESSION_SECRET"]!).update(unsigned).digest("base64url");
  return `Bearer ${unsigned}.${signature}`;
}

describe("bounded server-issued sessions", () => {
  it("adds an eight-hour expiry while preserving customer identity/provenance", () => {
    for (const payload of [
      { id: 1, email: "password@example.invalid", credentialVersion: 2 },
      { id: 2, email: "woo@example.invalid", src: "woo" },
      { id: 3, email: "social@example.invalid" },
      { id: 1_000_000_001, email: "mock@example.invalid" },
      { id: 4, email: "temporary@example.invalid", mustChangePassword: true },
    ]) {
      const started = Math.floor(Date.now() / 1000);
      const claims = verifyToken(`Bearer ${issueToken(payload)}`);
      assert.ok(claims);
      assert.ok(claims.exp! >= started + CUSTOMER_SESSION_TTL_SECONDS);
      assert.ok(claims.exp! <= Math.floor(Date.now() / 1000) + CUSTOMER_SESSION_TTL_SECONDS);
      const { exp, ...identity } = claims;
      assert.deepEqual(identity, payload);
    }
  });

  it("preserves an explicitly bounded team-session expiry", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const claims = verifyToken(`Bearer ${issueToken({ id: "team-user", email: "team@example.invalid", type: "team-session", exp })}`);
    assert.equal(claims?.exp, exp);
  });

  it("rejects a normally issued customer token after its full lifetime", (t) => {
    const issuedAt = 1_800_000_000;
    const clock = t.mock.method(Date, "now", () => issuedAt * 1000);
    const bearer = `Bearer ${issueToken({ id: 1, email: "customer@example.invalid" })}`;
    assert.ok(verifyToken(bearer));
    clock.mock.mockImplementation(() => (issuedAt + CUSTOMER_SESSION_TTL_SECONDS - 1) * 1000);
    assert.ok(verifyToken(bearer));
    clock.mock.mockImplementation(() => (issuedAt + CUSTOMER_SESSION_TTL_SECONDS) * 1000);
    assert.equal(verifyToken(bearer), null);
    clock.mock.restore();
  });

  it("rejects expired sessions and the exact expiry boundary", () => {
    const now = Math.floor(Date.now() / 1000);
    for (const exp of [now - 1, now]) {
      assert.equal(verifyToken(signedClaims({ id: 1, email: "expired@example.invalid", exp })), null);
    }
    assert.ok(verifyToken(signedClaims({ id: 1, email: "valid@example.invalid", exp: now + 60 })));
  });

  it("rejects signed legacy tokens and malformed expiry claims", () => {
    for (const exp of [undefined, null, "9999999999", false, {}, [], 9999999999.5]) {
      assert.equal(verifyToken(signedClaims({ id: 1, email: "legacy@example.invalid", exp })), null);
    }
  });

  it("still rejects tampered and malformed tokens", () => {
    const token = issueToken({ id: 1, email: "signed@example.invalid" });
    const [header, , signature] = token.split(".");
    const body = Buffer.from(JSON.stringify({ id: 2, exp: 9999999999 })).toString("base64url");
    assert.equal(verifyToken(`Bearer ${header}.${body}.${signature}`), null);
    assert.equal(verifyToken("Bearer invalid"), null);
    assert.equal(verifyToken(undefined), null);
  });
});
