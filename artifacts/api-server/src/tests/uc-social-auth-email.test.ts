/**
 * Social sign-in email safety tests.
 *
 * The route must issue the Companion JWT independently of Resend. These tests
 * use the real social-auth router and Resend helper against the isolated test
 * database, while replacing only Clerk's user lookup and the outbound HTTP
 * transport.
 */

import express, { type Request } from "express";
import { describe, it, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  ucNotificationLogTable,
  ucUsersTable,
} from "@workspace/db";
import socialAuthRouter from "../routes/uc-social-auth.js";
import rewardsRouter from "../routes/uc-rewards.js";
import { assertRewardsQrIdentity } from "./helpers/assert-rewards-qr.js";
import { verifyToken } from "../lib/jwt.js";
import ucRouter from "../routes/uc.js";
import { authLimiter } from "../lib/rate-limiters.js";
import { ipKeyGenerator } from "express-rate-limit";

type ClerkUserFixture = {
  id: string;
  emailAddresses: Array<{
    id: string;
    emailAddress: string;
    verification: { status: string };
  }>;
  primaryEmailAddressId: string;
  firstName: string | null;
  lastName: string | null;
};

type EmailPayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type ResendMode = "success" | "reject" | "throw" | "defer";

const SOCIAL_PASSWORD_SENTINEL = "!social-login-no-password";
const originalFetch = globalThis.fetch;
const originalResendBaseUrl = process.env["RESEND_BASE_URL"];
const originalResendApiKey = process.env["RESEND_API_KEY"];
const originalWcBaseUrl = process.env["WC_BASE_URL"];
const wooBaseUrl = "https://woo-social-boundary.test";
let wooRequests = 0;

let currentClerkUser: ClerkUserFixture;
let clerkUsers = new Map<string, ClerkUserFixture>();
let resendMode: ResendMode = "success";
let capturedEmails: EmailPayload[] = [];
let releaseDeferredResend: (() => void) | undefined;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const requestedClerkUserId = req.header("x-test-clerk-user-id");
  const clerkUserId = requestedClerkUserId ?? currentClerkUser.id;
  const authHandler = Object.assign(
    () => ({
      tokenType: "session_token",
      sessionClaims: {},
      sessionId: "test-session",
      sessionStatus: "active",
      userId: clerkUserId,
      actor: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
      orgPermissions: null,
      factorVerificationAge: null,
      getToken: async () => "test-session-token",
      has: () => false,
      debug: () => ({}),
      isAuthenticated: true,
    }),
    { [Symbol.for("@clerk/express.auth")]: true },
  );
  (req as Request & { auth: typeof authHandler }).auth = authHandler;
  next();
});
app.use(socialAuthRouter);
app.use("/api", rewardsRouter);
app.use("/api", ucRouter);

const clerkLookupMock = mock.method(
  clerkClient.users,
  "getUser",
  async (userId: string) =>
    (clerkUsers.get(userId) ?? currentClerkUser) as Awaited<
      ReturnType<typeof clerkClient.users.getUser>
    >,
);

function fixture(
  provider: "google" | "apple",
  email: string,
): ClerkUserFixture {
  const id = `${provider}_user_${email.split("@")[0]}`;
  return {
    id,
    emailAddresses: [{
      id: `${id}_email`,
      emailAddress: email,
      verification: { status: "verified" },
    }],
    primaryEmailAddressId: `${id}_email`,
    firstName: provider === "google" ? "Amina" : "Brian",
    lastName: "Social",
  };
}

function registerClerkUser(user: ClerkUserFixture): ClerkUserFixture {
  clerkUsers.set(user.id, user);
  currentClerkUser = user;
  return user;
}

function installResendStub(): void {
  process.env["RESEND_BASE_URL"] = "https://api.resend.com";
  process.env["RESEND_API_KEY"] = "re_test_social_auth";
  globalThis.fetch = async (url: unknown, init?: RequestInit) => {
    if (String(url) === `${wooBaseUrl}/wp-json/jwt-auth/v1/token`) {
      wooRequests += 1;
      const body = JSON.parse(String(init?.body)) as { username: string };
      return new Response(JSON.stringify({
        token: "verified-woo-token",
        user_email: body.username,
        user_display_name: "Woo Customer",
      }), { status: 200 });
    }
    assert.equal(String(url), "https://api.resend.com/emails", "unexpected outbound request");
    capturedEmails.push(
      JSON.parse(String(init?.body ?? "{}")) as EmailPayload,
    );

    if (resendMode === "reject") {
      return new Response(
        JSON.stringify({ name: "temporarily_unavailable" }),
        { status: 503 },
      );
    }
    if (resendMode === "throw") {
      throw new Error("Resend network outage");
    }
    if (resendMode === "defer") {
      await new Promise<void>((resolve) => {
        releaseDeferredResend = resolve;
      });
    }
    return new Response(JSON.stringify({ id: "re_social_test" }), { status: 200 });
  };
}

async function insertSocialUser(user: ClerkUserFixture): Promise<number> {
  const [row] = await db.insert(ucUsersTable).values({
    email: user.emailAddresses[0]!.emailAddress.toLowerCase(),
    passwordHash: SOCIAL_PASSWORD_SENTINEL,
    firstName: user.firstName ?? "Customer",
    lastName: user.lastName ?? "",
    clerkUserId: user.id,
    authProvider: "social",
  }).returning({ id: ucUsersTable.id });
  assert.ok(row, "test social user should be inserted");
  return row.id;
}

async function waitForLog(
  email: string,
  template: string,
): Promise<typeof ucNotificationLogTable.$inferSelect> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [row] = await db.select()
      .from(ucNotificationLogTable)
      .where(and(
        eq(ucNotificationLogTable.recipient, email),
        eq(ucNotificationLogTable.template, template),
      ))
      .limit(1);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${template} audit row for ${email}`);
}

function assertNoCredentialsOrResetTokens(emails: EmailPayload[]): void {
  assert.ok(emails.length > 0, "expected a social email to be sent");
  for (const email of emails) {
    const body = `${email.subject}\n${email.text}\n${email.html ?? ""}`.toLowerCase();
    assert.ok(!body.includes(SOCIAL_PASSWORD_SENTINEL), "social email must not expose the password sentinel");
    assert.ok(!body.includes("password"), "social email must not contain credentials");
    assert.ok(!body.includes("reset token"), "social email must not contain a reset token");
    assert.ok(!body.includes("resettoken"), "social email must not contain a reset token");
  }
}

before(() => {
  process.env["SESSION_SECRET"] ??= "test-social-auth-email-secret";
  process.env["WC_BASE_URL"] = wooBaseUrl;
  installResendStub();
});

beforeEach(() => {
  authLimiter.resetKey(ipKeyGenerator("::ffff:127.0.0.1"));
  authLimiter.resetKey("127.0.0.1");
  wooRequests = 0;
});

after(() => {
  globalThis.fetch = originalFetch;
  clerkLookupMock.mock.restore();
  if (originalResendBaseUrl === undefined) delete process.env["RESEND_BASE_URL"];
  else process.env["RESEND_BASE_URL"] = originalResendBaseUrl;
  if (originalResendApiKey === undefined) delete process.env["RESEND_API_KEY"];
  else process.env["RESEND_API_KEY"] = originalResendApiKey;
  if (originalWcBaseUrl === undefined) delete process.env["WC_BASE_URL"];
  else process.env["WC_BASE_URL"] = originalWcBaseUrl;
});

afterEach(async () => {
  releaseDeferredResend?.();
  releaseDeferredResend = undefined;
  capturedEmails = [];
  resendMode = "success";
  const usersToClean = clerkUsers.size > 0
    ? [...clerkUsers.values()]
    : currentClerkUser
      ? [currentClerkUser]
      : [];
  for (const user of usersToClean) {
    const email = user.emailAddresses[0]!.emailAddress.toLowerCase();
    await db.delete(ucNotificationLogTable)
      .where(eq(ucNotificationLogTable.recipient, email));
    await db.delete(ucUsersTable)
      .where(eq(ucUsersTable.email, email));
  }
  clerkUsers = new Map();
});

describe("social sign-in email delivery", () => {
  for (const provider of ["google", "apple"] as const) {
    it(`does not let Woo claim a ${provider}-linked customer by email alone`, async () => {
      const socialUser = registerClerkUser(
        fixture(provider, `social-woo-${provider}-${Date.now()}-${process.pid}@test.internal`),
      );
      const email = socialUser.emailAddresses[0]!.emailAddress;
      const social = await supertest(app).post("/uc/auth/social").send({});
      assert.equal(social.status, 200);
      await waitForLog(email, "uc-social-welcome");
      const [original] = await db.select().from(ucUsersTable)
        .where(eq(ucUsersTable.email, email));
      assert.ok(original);
      assert.equal(original.clerkUserId, socialUser.id);
      assert.equal(original.authProvider, "social");
      await assertRewardsQrIdentity(app, social.body.token, original.id);
      const originalRewards = await supertest(app).get("/api/uc/customer/rewards")
        .set("Authorization", `Bearer ${social.body.token}`);
      assert.equal(originalRewards.status, 200);
      assert.match(originalRewards.body.qrToken, /^[A-Za-z0-9_-]{43}$/);
      const [protectedAccount] = await db.select().from(ucUsersTable)
        .where(eq(ucUsersTable.id, original.id));

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const denied = await supertest(app).post("/api/uc/auth/login")
          .send({ email, password: "woo-account-password" });
        assert.equal(denied.status, 401);
        assert.equal(denied.body.token, undefined);
      }
      assert.equal(wooRequests, 0, "social accounts must not fall back to Woo");
      const rows = await db.select().from(ucUsersTable)
        .where(eq(ucUsersTable.email, email));
      assert.deepEqual(rows, [protectedAccount], "Woo attempts must not claim, duplicate, or modify the social account");

      const repeated = await supertest(app).post("/uc/auth/social").send({});
      assert.equal(repeated.status, 200);
      assert.equal(repeated.body.user.id, original.id);
      assert.equal(verifyToken(`Bearer ${repeated.body.token}`)?.id, original.id);
      const rewards = await supertest(app).get("/api/uc/customer/rewards")
        .set("Authorization", `Bearer ${repeated.body.token}`);
      assert.equal(rewards.status, 200);
      assert.equal(rewards.body.qrToken, originalRewards.body.qrToken);
      await waitForLog(email, "uc-social-sign-in");
    });
  }

  it("creates a Google account, sends the welcome template, and audits the accepted send", async () => {
    currentClerkUser = registerClerkUser(fixture("google", `social-welcome-${Date.now()}@test.internal`));
    resendMode = "defer";

    const responsePromise = supertest(app)
      .post("/uc/auth/social")
      .send({});
    const response = await responsePromise;

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, currentClerkUser.emailAddresses[0]!.emailAddress);
    assert.equal(typeof response.body.token, "string");
    await assertRewardsQrIdentity(app, response.body.token, response.body.user.id);
    assert.equal(capturedEmails.length, 1, "welcome email should be dispatched");
    assert.equal(capturedEmails[0]!.subject, "Welcome to Ultra-Clear");
    assert.match(capturedEmails[0]!.text, /Welcome to Ultra-Clear/);
    assertNoCredentialsOrResetTokens(capturedEmails);

    releaseDeferredResend?.();
    releaseDeferredResend = undefined;
    const log = await waitForLog(
      currentClerkUser.emailAddresses[0]!.emailAddress,
      "uc-social-welcome",
    );
    assert.equal(log.status, "sent");
    assert.equal(log.provider, "resend");
    assert.equal(log.messageBody, capturedEmails[0]!.text);
  });

  it("sends the sign-in notification template for a later Apple login", async () => {
    currentClerkUser = registerClerkUser(fixture("apple", `social-login-${Date.now()}@test.internal`));
    await insertSocialUser(currentClerkUser);

    const response = await supertest(app)
      .post("/uc/auth/social")
      .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, currentClerkUser.emailAddresses[0]!.emailAddress);
    assert.equal(capturedEmails.length, 1);
    assert.equal(capturedEmails[0]!.subject, "New sign-in to your Ultra-Clear account");
    await assertRewardsQrIdentity(app, response.body.token, response.body.user.id);
    assert.match(capturedEmails[0]!.text, /Google or Apple/);
    assertNoCredentialsOrResetTokens(capturedEmails);

    const log = await waitForLog(
      currentClerkUser.emailAddresses[0]!.emailAddress,
      "uc-social-sign-in",
    );
    assert.equal(log.status, "sent");
    assert.equal(log.messageBody, capturedEmails[0]!.text);
  });

  it("returns the app JWT and user when Resend rejects the welcome email", async () => {
    currentClerkUser = registerClerkUser(fixture("google", `social-reject-${Date.now()}@test.internal`));
    resendMode = "reject";

    const response = await supertest(app)
      .post("/uc/auth/social")
      .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, currentClerkUser.emailAddresses[0]!.emailAddress);
    assert.equal(typeof response.body.token, "string");
    assertNoCredentialsOrResetTokens(capturedEmails);

    const log = await waitForLog(
      currentClerkUser.emailAddresses[0]!.emailAddress,
      "uc-social-welcome",
    );
    assert.equal(log.status, "failed");
    assert.match(log.errorMessage ?? "", /Resend 503/);
  });

  it("returns the app JWT and user when Resend throws during a later Apple login", async () => {
    currentClerkUser = registerClerkUser(fixture("apple", `social-exception-${Date.now()}@test.internal`));
    await insertSocialUser(currentClerkUser);
    resendMode = "throw";

    const response = await supertest(app)
      .post("/uc/auth/social")
      .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, currentClerkUser.emailAddresses[0]!.emailAddress);
    assert.equal(typeof response.body.token, "string");
    assertNoCredentialsOrResetTokens(capturedEmails);

    const log = await waitForLog(
      currentClerkUser.emailAddresses[0]!.emailAddress,
      "uc-social-sign-in",
    );
    assert.equal(log.status, "failed");
    assert.match(log.errorMessage ?? "", /Network error: Resend network outage/);
  });

  it("keeps concurrent first-time Google and Apple welcome emails and audits matched to each account", async () => {
    const nonce = Date.now();
    const googleUser = registerClerkUser(
      fixture("google", `social-race-google-${nonce}@test.internal`),
    );
    const appleUser = registerClerkUser(
      fixture("apple", `social-race-apple-${nonce}@test.internal`),
    );

    const [googleResponse, appleResponse] = await Promise.all([
      supertest(app)
        .post("/uc/auth/social")
        .set("x-test-clerk-user-id", googleUser.id)
        .send({}),
      supertest(app)
        .post("/uc/auth/social")
        .set("x-test-clerk-user-id", appleUser.id)
        .send({}),
    ]);

    assert.equal(googleResponse.status, 200);
    assert.equal(appleResponse.status, 200);
    assert.equal(googleResponse.body.user.email, googleUser.emailAddresses[0]!.emailAddress);
    assert.equal(appleResponse.body.user.email, appleUser.emailAddresses[0]!.emailAddress);
    assert.notEqual(googleResponse.body.user.id, appleResponse.body.user.id);
    assert.equal(typeof googleResponse.body.token, "string");
    assert.equal(typeof appleResponse.body.token, "string");
    assert.notEqual(googleResponse.body.token, appleResponse.body.token);
    const googleClaims = verifyToken(`Bearer ${googleResponse.body.token}`);
    const appleClaims = verifyToken(`Bearer ${appleResponse.body.token}`);
    assert.equal(googleClaims?.id, googleResponse.body.user.id);
    assert.equal(googleClaims?.email, googleUser.emailAddresses[0]!.emailAddress);
    assert.equal(appleClaims?.id, appleResponse.body.user.id);
    assert.equal(appleClaims?.email, appleUser.emailAddresses[0]!.emailAddress);

    assert.equal(capturedEmails.length, 2);
    for (const user of [googleUser, appleUser]) {
      const recipient = user.emailAddresses[0]!.emailAddress;
      const matchingEmails = capturedEmails.filter((email) => email.to === recipient);
      assert.equal(matchingEmails.length, 1, `${recipient} should receive exactly one email`);
      assert.equal(matchingEmails[0]!.subject, "Welcome to Ultra-Clear");
      assert.match(matchingEmails[0]!.text, new RegExp(`^Hi ${user.firstName},`));
      assert.match(matchingEmails[0]!.text, /Welcome to Ultra-Clear/);

      await waitForLog(recipient, "uc-social-welcome");
      const logs = await db.select()
        .from(ucNotificationLogTable)
        .where(and(
          eq(ucNotificationLogTable.recipient, recipient),
          eq(ucNotificationLogTable.template, "uc-social-welcome"),
        ));
      assert.equal(logs.length, 1, `${recipient} should have exactly one welcome audit row`);
      assert.equal(logs[0]!.status, "sent");
      assert.equal(logs[0]!.messageBody, matchingEmails[0]!.text);
    }
    assertNoCredentialsOrResetTokens(capturedEmails);
  });
});