import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { OAuth2Client } from "google-auth-library";
import express from "express";
import request from "supertest";
import contactsSyncRouter from "../routes/contacts-sync.js";
import { issueToken } from "../lib/jwt.js";
import { getValidAccessToken, generateOAuthState } from "../lib/google-auth.js";
import { runDailyContactsSync } from "../lib/scheduler.js";
import {
  needsGoogleReconnect, GOOGLE_RECONNECT_MESSAGE, buildSheetSyncFailureEmail,
} from "../lib/google-reconnect.js";

afterEach(() => mock.restoreAll());

function stubDatabase() {
  const updates: Array<Record<string, unknown>> = [];
  mock.method(db, "select", () => ({
    from: () => ({
      orderBy: () => ({
        limit: async () => [{
          id: 1, sheetUrl: "https://docs.google.com/spreadsheets/d/test#gid=7",
          sheetLabel: "Team contacts", refreshToken: "fake-refresh-token",
          expiresAt: new Date(0),
        }],
      }),
    }),
  }));
  mock.method(db, "update", () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => { updates.push(values); },
    }),
  }));
  return updates;
}

describe("Google reconnect classification and failure email", () => {
  it("recognizes structured Google errors, revoked-token text and stored markers", () => {
    for (const error of [
      { response: { data: { error: "invalid_grant" } } },
      new Error("invalid_grant: Token has been expired or revoked."),
      "Token revoked", "Refresh token is invalid", GOOGLE_RECONNECT_MESSAGE,
    ]) assert.equal(needsGoogleReconnect(error), true);
  });

  it("does not label network, sheet permissions or configuration errors as revoked access", () => {
    for (const error of [null, "403 Forbidden", "invalid_client", "ETIMEDOUT",
      new Error("Sheet not found"), { response: { data: { error: "server_error" } } },
    ]) assert.equal(needsGoogleReconnect(error), false);
  });

  it("includes a reconnect deep link and readable explanation instead of public-sheet advice", () => {
    const email = buildSheetSyncFailureEmail({
      sheetLabel: "Private sheet", errorMessage: "invalid_grant",
      errorAt: new Date("2026-10-04T06:00:00Z"), contactsUrl: "https://team.example/contacts",
    });
    assert.match(email.subject, /Reconnect Google account/);
    assert.match(email.text, /Your Google account needs to be reconnected/);
    assert.match(email.text, /https:\/\/team.example\/contacts\?reconnectGoogle=1/);
    assert.doesNotMatch(email.text, /still published|invalid_grant/);
  });

  it("keeps generic failures separate", () => {
    const email = buildSheetSyncFailureEmail({
      sheetLabel: "Sheet", errorMessage: "Sheet not found",
      errorAt: new Date(0), contactsUrl: "https://team.example/contacts",
    });
    assert.match(email.subject, /sync failed/);
    assert.match(email.text, /Sheet not found/);
    assert.doesNotMatch(email.text, /reconnectGoogle/);
  });
});

describe("daily contacts sync", () => {
  it("records revoked authorization and notifies without trying public access", async () => {
    const updates = stubDatabase();
    let notified = "";
    let runCalls = 0;
    await runDailyContactsSync({
      getToken: async () => { throw new Error(GOOGLE_RECONNECT_MESSAGE); },
      runSync: async () => { runCalls++; throw new Error("should not run"); },
      notifyFailure: async (failure) => { notified = failure.errorMessage; },
    });
    assert.equal(runCalls, 0);
    assert.equal(updates[0]?.lastError, GOOGLE_RECONNECT_MESSAGE);
    assert.ok(updates[0]?.lastErrorAt instanceof Date);
    assert.equal(notified, GOOGLE_RECONNECT_MESSAGE);
  });

  it("still permits public mode without a credential and clears errors after success", async () => {
    const updates = stubDatabase();
    await runDailyContactsSync({
      getToken: async () => null,
      runSync: async (_url, gid, token) => {
        assert.equal(gid, "7");
        assert.equal(token, null);
        return { created: 0, updated: 0, skipped: 0, failed: 0 };
      },
      notifyFailure: async () => { assert.fail("successful sync must not notify"); },
    });
    assert.equal(updates[0]?.lastError, null);
    assert.ok(updates[0]?.lastSyncedAt instanceof Date);
  });

  it("keeps other sheet failures generic", async () => {
    const updates = stubDatabase();
    let notified = "";
    await runDailyContactsSync({
      getToken: async () => null,
      runSync: async () => { throw new Error("Sheet not found"); },
      notifyFailure: async (failure) => { notified = failure.errorMessage; },
    });
    assert.equal(updates[0]?.lastError, "Sheet not found");
    assert.equal(notified, "Sheet not found");
    assert.equal(needsGoogleReconnect(notified), false);
  });
});

describe("OAuth refresh", () => {
  it("normalizes invalid_grant but preserves transient errors", async () => {
    stubDatabase();
    // Fake config used only to construct a client; refresh is always intercepted.
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_REDIRECT_URI = "https://team.example/api/contacts/sync/google/callback";
    try {
      const refresh = mock.method(OAuth2Client.prototype, "refreshAccessToken", async () => {
        throw { response: { data: { error: "invalid_grant" } } };
      });
      await assert.rejects(getValidAccessToken(), { message: GOOGLE_RECONNECT_MESSAGE });
      const timeout = new Error("ETIMEDOUT");
      refresh.mock.mockImplementation(async () => { throw timeout; });
      await assert.rejects(getValidAccessToken(), (err) => err === timeout);
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_REDIRECT_URI;
    }
  });
});

describe("contacts sync routes", () => {
  const app = express().use(express.json()).use("/api", contactsSyncRouter);

  it("marks legacy invalid_grant errors as requiring reconnect in the status response", async () => {
    mock.method(db, "select", () => ({
      from: () => ({ orderBy: () => ({ limit: async () => [{
        id: 1, sheetUrl: "https://docs.google.com/spreadsheets/d/test",
        lastError: "invalid_grant", lastErrorAt: new Date(),
      }] }) }),
    }));
    const result = await request(app).get("/api/contacts/sync/sheets");
    assert.equal(result.status, 200);
    assert.equal(result.body.reconnectRequired, true);
  });

  it("manual sync records the reconnect failure without attempting a sheet request", async () => {
    const updates = stubDatabase();
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_REDIRECT_URI = "https://team.example/api/contacts/sync/google/callback";
    mock.method(OAuth2Client.prototype, "refreshAccessToken", async () => {
      throw { response: { data: { error: "invalid_grant" } } };
    });
    const fetchStub = mock.method(globalThis, "fetch", async () => {
      assert.fail("a revoked grant must not fall back to public sheet access");
    });
    try {
      const token = issueToken({ id: 1, email: "team@example.com", type: "team-session" });
      const result = await request(app).post("/api/contacts/sync/sheets/run")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(result.status, 502);
      assert.equal(result.body.error, GOOGLE_RECONNECT_MESSAGE);
      assert.equal(updates[0]?.lastError, GOOGLE_RECONNECT_MESSAGE);
      assert.equal(fetchStub.mock.callCount(), 0);
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_REDIRECT_URI;
    }
  });

  it("reauthorization clears only saved Google authorization errors", async () => {
    const updates = stubDatabase();
    mock.method(db, "select", () => ({ from: async () => [
      { id: 1, lastError: GOOGLE_RECONNECT_MESSAGE },
      { id: 2, lastError: "Sheet not found" },
    ] }));
    mock.method(db, "delete", async () => {});
    mock.method(db, "insert", () => ({ values: async () => {} }));
    mock.method(OAuth2Client.prototype, "getToken", async () => ({
      tokens: { refresh_token: "new-fake-refresh", access_token: "new-fake-access" },
    }));
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_REDIRECT_URI = "https://team.example/api/contacts/sync/google/callback";
    try {
      const result = await request(app).get("/api/contacts/sync/google/callback")
        .query({ code: "fake-code", state: generateOAuthState() });
      assert.equal(result.status, 200);
      assert.equal(updates.length, 1);
      assert.deepEqual(updates[0], { lastError: null, lastErrorAt: null });
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_REDIRECT_URI;
    }
  });
});