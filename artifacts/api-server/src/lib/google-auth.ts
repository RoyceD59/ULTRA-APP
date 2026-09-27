/**
 * Google OAuth 2.0 helpers for private Google Sheets access.
 *
 * Env vars required:
 *   GOOGLE_CLIENT_ID      — OAuth 2.0 client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET  — OAuth 2.0 client secret
 *   GOOGLE_REDIRECT_URI   — Exact redirect URI registered in Google Cloud Console
 *                           e.g. https://your-domain.com/api/contacts/sync/google/callback
 */

import { OAuth2Client } from "google-auth-library";
import { randomBytes } from "node:crypto";
import { db, googleOAuthCredentialsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── CSRF state store ─────────────────────────────────────────────────────────
// Short-lived (10 min) set of valid state tokens. Stored in process memory;
// that's fine because the OAuth popup opens and closes within one server process.
// Each token is single-use: consumed on callback validation.

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StateEntry {
  expiresAt: number;
}

const pendingStates = new Map<string, StateEntry>();

/** Generate a cryptographically random state token and record it. */
export function generateOAuthState(): string {
  const state = randomBytes(32).toString("hex");
  pendingStates.set(state, { expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
  // Prune expired entries opportunistically
  for (const [k, v] of pendingStates) {
    if (v.expiresAt < Date.now()) pendingStates.delete(k);
  }
  return state;
}

/**
 * Validate and consume a state token. Returns true and removes the token
 * if it is valid and unexpired; returns false otherwise.
 */
export function consumeOAuthState(state: string): boolean {
  const entry = pendingStates.get(state);
  if (!entry) return false;
  pendingStates.delete(state);
  return entry.expiresAt >= Date.now();
}

/** Scopes needed: read Google Drive / Sheets files the user has access to */
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "email",
];

function getClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables."
    );
  }
  if (!redirectUri) {
    throw new Error(
      "GOOGLE_REDIRECT_URI environment variable is not set. " +
        "Set it to the exact callback URL registered in Google Cloud Console, " +
        "e.g. https://your-domain.com/api/contacts/sync/google/callback"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Create a new OAuth2 client. Throws if env vars are missing. */
export function createOAuth2Client(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = getClientConfig();
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

/** Returns true if Google OAuth env vars are configured. */
export function isGoogleOAuthConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

/** Generate the Google OAuth consent screen URL with a CSRF state token. */
export function buildAuthUrl(): string {
  const client = createOAuth2Client();
  const state = generateOAuthState();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // always ask so we always get a refresh token
    state,
  });
}

/**
 * Exchange an authorization code for tokens and persist them to DB.
 * Returns the connected account email.
 */
export async function exchangeCodeAndStore(code: string): Promise<string> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. " +
        "Please disconnect and reconnect your Google account to re-authorize."
    );
  }

  // Decode the ID token to get the user's email
  let googleEmail = "unknown@google.com";
  if (tokens.id_token) {
    try {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token });
      googleEmail = ticket.getPayload()?.email ?? googleEmail;
    } catch (err) {
      logger.warn({ err }, "google-auth: could not verify ID token to extract email");
    }
  }

  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date)
    : new Date(Date.now() + 3600 * 1000);

  // Upsert: delete any existing credential and insert the new one
  await db.delete(googleOAuthCredentialsTable);
  await db.insert(googleOAuthCredentialsTable).values({
    googleEmail,
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token,
    expiresAt,
  });

  logger.info({ googleEmail }, "google-auth: OAuth credential stored");
  return googleEmail;
}

/**
 * Load the stored credential and return a valid (possibly refreshed) access token.
 * Returns null if no credential is stored.
 * Throws if the refresh fails.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const [credential] = await db
    .select()
    .from(googleOAuthCredentialsTable)
    .orderBy(desc(googleOAuthCredentialsTable.createdAt))
    .limit(1);

  if (!credential) return null;

  // If the access token is still valid (with 60s buffer), use it
  if (credential.expiresAt > new Date(Date.now() + 60_000)) {
    return credential.accessToken;
  }

  // Otherwise refresh using the refresh token
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: credential.refreshToken });

  const { credentials } = await client.refreshAccessToken();

  const newAccessToken = credentials.access_token;
  if (!newAccessToken) {
    throw new Error("Google OAuth refresh returned no access token.");
  }

  const newExpiresAt = credentials.expiry_date
    ? new Date(credentials.expiry_date)
    : new Date(Date.now() + 3600 * 1000);

  // Persist the refreshed token
  await db
    .update(googleOAuthCredentialsTable)
    .set({
      accessToken: newAccessToken,
      expiresAt: newExpiresAt,
      updatedAt: new Date(),
    });

  logger.info("google-auth: access token refreshed");
  return newAccessToken;
}

/**
 * Return the stored credential status (email + whether it's connected).
 * Returns null if no credential is stored.
 */
export async function getCredentialStatus(): Promise<{
  connected: true;
  googleEmail: string;
  connectedAt: Date;
} | { connected: false }> {
  const [credential] = await db
    .select()
    .from(googleOAuthCredentialsTable)
    .orderBy(desc(googleOAuthCredentialsTable.createdAt))
    .limit(1);

  if (!credential) return { connected: false };

  return {
    connected: true,
    googleEmail: credential.googleEmail,
    connectedAt: credential.createdAt,
  };
}

/** Remove all stored OAuth credentials (disconnect). */
export async function disconnectGoogle(): Promise<void> {
  await db.delete(googleOAuthCredentialsTable);
  logger.info("google-auth: OAuth credential removed (disconnected)");
}
