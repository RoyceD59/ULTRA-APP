import { randomBytes, randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  db,
  pool,
  ucOfflineClientsTable,
  ucUsersTable,
  type OfflineProduct,
} from "@workspace/db";
import { normalizeEmail, normalizePhone } from "./customer-identity.js";
import { sendViaResend } from "./resend.js";
import { sendWhatsAppMessage } from "./whatsapp.js";
import { logger } from "./logger.js";
import { resolveCustomerIdentity } from "./customer-identity-resolution.js";
import { reconcileOfflineProducts } from "./offline-purchases.js";

const TEMPORARY_PASSWORD_DAYS = 14;
const COMPANION_URL = "https://app.ucfilters.com";

export type OfflineProvisioningInput = {
  idempotencyKey: string;
  clientRef: string;
  phone: string | null;
  email: string | null;
  products: OfflineProduct[];
  saleDate: string;
  notes: string;
  firstName?: string;
  lastName?: string;
};

type DeliveryWork = {
  saleId: number;
  userId: number;
  channel: "email" | "whatsapp";
  recipient: string;
  firstName: string;
  loginIdentifier: string;
  temporaryPassword: string;
  expiresAt: Date;
  claimToken: string;
  credentialVersion: number;
  handoffIdempotencyKey: string;
};

export type PublicOfflineSale = {
  id: number;
  clientRef: string;
  phone: string | null;
  email: string | null;
  products: OfflineProduct[];
  saleDate: string;
  notes: string;
  createdAt: Date;
  companionUserId: number | null;
  accountSetupStatus: string;
  deliveryChannel: string | null;
  deliveryStatus: string;
  deliveryMetadata: Record<string, unknown>;
  conflictReason: string | null;
  deliveryAttempts: number;
  deliveryLastAttemptAt: Date | null;
  deliveryError: string | null;
};

function generateTemporaryPassword(): string {
  // URL-safe output avoids quoting/escaping surprises in email and WhatsApp.
  return randomBytes(18).toString("base64url");
}

function internalEmail(phone: string): string {
  return `offline-${createHash(phone)}@accounts.ucfilters.invalid`;
}

function createHash(value: string): string {
  return randomBytes(8).toString("hex") + value.replace(/\D/g, "").slice(-8);
}

function safeName(input: string | undefined, fallback: string): string {
  const value = input?.trim();
  return value || fallback;
}

async function sendCredential(work: DeliveryWork, signal: AbortSignal): Promise<boolean> {
  const expiry = work.expiresAt.toISOString();
  if (work.channel === "email") {
    return sendViaResend({
      from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
      to: work.recipient,
      subject: "Your Ultra-Clear Companion account",
      text: [
        `Hello ${work.firstName},`,
        "",
        "Your Ultra-Clear Companion account is ready.",
        `Login email: ${work.loginIdentifier}`,
        `Temporary password: ${work.temporaryPassword}`,
        `Sign in at ${COMPANION_URL}.`,
        `This one-time credential expires on ${expiry}.`,
        "Choose a permanent password on your first sign-in.",
      ].join("\n"),
      html: `<p>Hello ${work.firstName},</p><p>Your Ultra-Clear Companion account is ready.</p><p>Login email: ${work.loginIdentifier}</p><p><strong>Temporary password:</strong> ${work.temporaryPassword}</p><p>Sign in at <a href="${COMPANION_URL}">${COMPANION_URL}</a>.</p><p>This one-time credential expires on ${expiry}. Choose a permanent password on your first sign-in.</p>`,
      idempotencyKey: work.handoffIdempotencyKey,
      signal,
      meta: { template: "uc-offline-account-credential", auditMode: "metadata-only" },
      logBody: "Offline account credential dispatched (credential redacted)",
    });
  }
  try {
    await sendWhatsAppMessage(
      work.recipient,
      [
        "Your Ultra-Clear Companion account is ready.",
        `Login phone: ${work.loginIdentifier}`,
        `Temporary password: ${work.temporaryPassword}`,
        `Sign in at ${COMPANION_URL}.`,
        `This one-time credential expires on ${expiry}. Choose a permanent password on your first sign-in.`,
      ].join("\n"),
      signal,
    );
    return true;
  } catch (err) {
    logger.warn({ err, saleId: work.saleId, channel: work.channel }, "Offline credential delivery failed");
    return false;
  }
}

export function toPublicOfflineSale(row: typeof ucOfflineClientsTable.$inferSelect): PublicOfflineSale {
  // Explicit projection makes it impossible for a future credential field to
  // accidentally be returned to ProjectHub.
  return {
    id: row.id,
    clientRef: row.clientRef,
    phone: row.phone,
    email: row.email,
    products: row.products,
    saleDate: row.saleDate,
    notes: row.notes,
    createdAt: row.createdAt,
    companionUserId: row.companionUserId,
    accountSetupStatus: row.accountSetupStatus,
    deliveryChannel: row.deliveryChannel,
    deliveryStatus: row.deliveryStatus,
    deliveryMetadata: row.deliveryMetadata ?? {},
    conflictReason: row.conflictReason,
    deliveryAttempts: row.deliveryAttempts,
    deliveryLastAttemptAt: row.deliveryLastAttemptAt,
    deliveryError: row.deliveryError,
  };
}

export async function provisionOfflineSale(input: OfflineProvisioningInput): Promise<{
  row: PublicOfflineSale;
  created: boolean;
}> {
  input = { ...input, products: reconcileOfflineProducts(input.products) };
  const normalizedEmail = input.email ? normalizeEmail(input.email) : null;
  const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
  if (!normalizedEmail && !normalizedPhone) {
    throw new Error("A valid email address or international phone number is required");
  }

  const client = await pool.connect();
  let result: { row: typeof ucOfflineClientsTable.$inferSelect; created: boolean };
  try {
    await client.query("BEGIN");
    // Serialize sale idempotency first, then use the shared email/phone locks.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`offline-sale:${input.idempotencyKey}`]);
    const tx = drizzle(client);
    result = await (async () => {
    const [existingSale] = await tx.select().from(ucOfflineClientsTable)
      .where(eq(ucOfflineClientsTable.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existingSale) return { row: existingSale, created: false };

    const identity = await resolveCustomerIdentity(
      { email: normalizedEmail, phone: normalizedPhone },
      client,
    );
    const conflict = identity.kind === "email_phone_conflict"
      || identity.kind === "ambiguous" || identity.kind === "deleted_only"
      || identity.kind === "mixed_deleted_conflict";

    if (conflict) {
      const [sale] = await tx.insert(ucOfflineClientsTable).values({
        idempotencyKey: input.idempotencyKey,
        clientRef: input.clientRef,
        phone: normalizedPhone,
        email: normalizedEmail,
        products: input.products,
        saleDate: input.saleDate,
        notes: input.notes,
        accountSetupStatus: "conflict",
        deliveryStatus: "not_applicable",
        deliveryMetadata: { reason: "identity_conflict" },
        conflictReason: "Email and phone identify different accounts or an identifier is ambiguous",
      }).returning();
      return { row: sale!, created: true };
    }

    if (identity.kind === "one_active_candidate") {
      const [sale] = await tx.insert(ucOfflineClientsTable).values({
        idempotencyKey: input.idempotencyKey,
        clientRef: input.clientRef,
        phone: normalizedPhone,
        email: normalizedEmail,
        products: input.products,
        saleDate: input.saleDate,
        notes: input.notes,
        companionUserId: identity.customerId,
        accountSetupStatus: "linked-existing",
        deliveryStatus: "not_applicable",
        deliveryMetadata: { matchedBy: normalizedEmail ? "email" : "phone" },
      }).returning();
      return { row: sale!, created: true };
    }

    const email = normalizedEmail ?? internalEmail(normalizedPhone!);
    const firstName = safeName(input.firstName, "Customer");
    const lastName = safeName(input.lastName, "");
    const [user] = await tx.insert(ucUsersTable).values({
      email,
      phone: normalizedPhone ?? "",
      // The sale transaction never creates or knows a customer credential.
      // Delivery claims the job after commit and installs a fresh credential.
      passwordHash: await bcryptjs.hash(randomBytes(32).toString("base64url"), 12),
      firstName,
      lastName,
      authProvider: "password",
      emailVerified: !!normalizedEmail,
      phoneVerified: !normalizedEmail && !!normalizedPhone,
      mustChangePassword: false,
    }).returning();
    const [sale] = await tx.insert(ucOfflineClientsTable).values({
      idempotencyKey: input.idempotencyKey,
      clientRef: input.clientRef,
      phone: normalizedPhone,
      email: normalizedEmail,
      products: input.products,
      saleDate: input.saleDate,
      notes: input.notes,
      companionUserId: user!.id,
      accountSetupStatus: "created",
      deliveryChannel: normalizedEmail ? "email" : "whatsapp",
      deliveryStatus: "pending",
      deliveryJobKey: randomUUID(),
      deliveryMetadata: { loginIdentifier: normalizedEmail ?? normalizedPhone },
    }).returning();
    return { row: sale!, created: true };
    })();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (!result.created || result.row.accountSetupStatus !== "created") {
    return { ...result, row: toPublicOfflineSale(result.row) };
  }
  const delivered = await deliverOfflineSale(result.row.id);
  return { row: toPublicOfflineSale(delivered ?? result.row), created: true };
}

/**
 * Claims a pending/failed delivery after the sale transaction commits. The
 * claim lease prevents concurrent workers from generating or sending two
 * credentials. A crashed worker leaves an expired `sending` lease, which is
 * safely reclaimable with a fresh credential.
 */
export async function deliverOfflineSale(saleId: number): Promise<typeof ucOfflineClientsTable.$inferSelect | null> {
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
  let temporaryPassword = "";
  let passwordHash = "";
  let expiresAt: Date | undefined;
  let work: DeliveryWork | undefined;
  const sale = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"offline-delivery:" + saleId}))`);
    const [row] = await tx.select().from(ucOfflineClientsTable)
      .where(eq(ucOfflineClientsTable.id, saleId)).limit(1);
    if (!row || !row.companionUserId) return row;
    const leaseActive = row.deliveryClaimExpiresAt && row.deliveryClaimExpiresAt.getTime() > Date.now();
    if (!["pending", "failed", "sending"].includes(row.deliveryStatus) ||
        (row.deliveryStatus === "sending" && leaseActive)) return row;
    const [user] = await tx.select().from(ucUsersTable)
      .where(and(eq(ucUsersTable.id, row.companionUserId), isNull(ucUsersTable.deletedAt))).limit(1);
    if (!user || user.authProvider !== "password") return row;
    const issuedCredentialVersion = row.issuedCredentialVersion;
    // A lease can expire after the customer has completed the temporary
    // password flow. Treat that handoff as terminal; never replace the
    // permanent password with a reclaimed temporary credential.
    if (
      row.deliveryStatus === "sending"
      && !leaseActive
      && (!user.mustChangePassword
        || (issuedCredentialVersion != null && user.credentialVersion > issuedCredentialVersion))
    ) {
      const [superseded] = await tx.update(ucOfflineClientsTable).set({
        deliveryStatus: "sent",
        deliveryError: "Temporary credential superseded by customer password completion",
        deliveryClaimToken: null,
        deliveryClaimExpiresAt: null,
      }).where(and(
        eq(ucOfflineClientsTable.id, saleId),
        eq(ucOfflineClientsTable.deliveryClaimToken, row.deliveryClaimToken!),
        sql`${ucOfflineClientsTable.issuedCredentialVersion} IS NOT DISTINCT FROM ${issuedCredentialVersion}`,
      )).returning();
      return superseded ?? row;
    }
    temporaryPassword = generateTemporaryPassword();
    passwordHash = await bcryptjs.hash(temporaryPassword, 12);
    expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_DAYS * 24 * 60 * 60 * 1000);
    const expectedVersion = user.credentialVersion;
    const [claimedSale] = await tx.update(ucOfflineClientsTable).set({
      accountSetupStatus: "created",
      deliveryStatus: "sending",
      deliveryError: null,
      deliveryLastAttemptAt: new Date(),
      deliveryClaimToken: claimToken,
      deliveryClaimExpiresAt: claimExpiresAt,
    }).where(and(
      eq(ucOfflineClientsTable.id, saleId),
      eq(ucOfflineClientsTable.deliveryStatus, row.deliveryStatus),
    )).returning();
    if (!claimedSale) return row;
    const [installed] = await tx.update(ucUsersTable).set({
      passwordHash,
      credentialVersion: expectedVersion + 1,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: expiresAt,
    }).where(and(
      eq(ucUsersTable.id, user.id),
      eq(ucUsersTable.credentialVersion, expectedVersion),
      sql`EXISTS (
        SELECT 1 FROM uc_offline_clients
        WHERE id = ${saleId} AND delivery_claim_token = ${claimToken}
      )`,
    )).returning({
      id: ucUsersTable.id,
      credentialVersion: ucUsersTable.credentialVersion,
    });
    if (!installed) {
      // The permanent password won the race after the claim was acquired.
      const [current] = await tx.select({
        credentialVersion: ucUsersTable.credentialVersion,
        mustChangePassword: ucUsersTable.mustChangePassword,
      }).from(ucUsersTable).where(eq(ucUsersTable.id, user.id)).limit(1);
      if (current && (!current.mustChangePassword || current.credentialVersion > expectedVersion)) {
        const [superseded] = await tx.update(ucOfflineClientsTable).set({
          deliveryStatus: "sent",
          deliveryError: "Temporary credential superseded by customer password completion",
          deliveryClaimToken: null,
          deliveryClaimExpiresAt: null,
        }).where(and(
          eq(ucOfflineClientsTable.id, saleId),
          eq(ucOfflineClientsTable.deliveryClaimToken, claimToken),
        )).returning();
        return superseded ?? row;
      }
      throw new Error("Offline credential claim became stale before installation");
    }
    const [issuedSale] = await tx.update(ucOfflineClientsTable).set({
      issuedCredentialVersion: installed.credentialVersion,
    }).where(and(
      eq(ucOfflineClientsTable.id, saleId),
      eq(ucOfflineClientsTable.deliveryClaimToken, claimToken),
    )).returning();
    if (!issuedSale) return row;
    const channel = row.email ? "email" : "whatsapp";
    work = {
      saleId,
      userId: user.id,
      channel,
      recipient: row.email ?? row.phone!,
      firstName: user.firstName,
      loginIdentifier: row.email ?? row.phone!,
      temporaryPassword,
      expiresAt,
      claimToken,
      credentialVersion: installed.credentialVersion,
      handoffIdempotencyKey: `${issuedSale.deliveryJobKey ?? `offline-sale-${saleId}`}:${claimToken}`,
    };
    return claimedSale;
  });
  if (!sale || !work) return sale ?? null;
  const claimedWork = work;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 4 * 60 * 1000);
  timeout.unref?.();
  let sent = false;
  try {
    sent = await sendCredential(claimedWork, abortController.signal);
  } catch (err) {
    logger.warn({ err, saleId }, "Offline credential provider threw");
  } finally {
    clearTimeout(timeout);
  }
  const [updated] = await db.transaction(async (tx) => {
    // Re-check the lease before touching the account. Both the lease token and
    // the credential version must still identify this exact handoff.
    const [claim] = await tx.select({ id: ucOfflineClientsTable.id })
      .from(ucOfflineClientsTable)
      .where(and(
        eq(ucOfflineClientsTable.id, saleId),
        eq(ucOfflineClientsTable.deliveryClaimToken, claimedWork.claimToken),
      ))
      .limit(1);
    if (!claim) return [];
    const [current] = await tx.select({
      id: ucUsersTable.id,
      credentialVersion: ucUsersTable.credentialVersion,
      mustChangePassword: ucUsersTable.mustChangePassword,
    }).from(ucUsersTable).where(eq(ucUsersTable.id, claimedWork.userId)).limit(1);
    if (!current) return [];
    if (!current.mustChangePassword || current.credentialVersion > claimedWork.credentialVersion) {
      // The customer completed a permanent password change while the provider
      // was working. Close this lease without touching the permanent hash.
      return tx.update(ucOfflineClientsTable).set({
        deliveryStatus: "sent",
        deliveryError: "Temporary credential superseded by customer password completion",
        deliveryClaimToken: null,
        deliveryClaimExpiresAt: null,
      }).where(and(
        eq(ucOfflineClientsTable.id, saleId),
        eq(ucOfflineClientsTable.deliveryClaimToken, claimedWork.claimToken),
        eq(ucOfflineClientsTable.issuedCredentialVersion, claimedWork.credentialVersion),
      )).returning();
    }
    if (current.credentialVersion !== claimedWork.credentialVersion) return [];
    if (!sent) {
      // Failure handling is one transaction: there is no crash window where
      // the failed job and its generated credential disagree.
      const [invalidated] = await tx.update(ucUsersTable).set({
        passwordHash: await bcryptjs.hash(randomUUID(), 12),
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        credentialVersion: sql`${ucUsersTable.credentialVersion} + 1`,
      }).where(and(
        eq(ucUsersTable.id, claimedWork.userId),
        eq(ucUsersTable.credentialVersion, claimedWork.credentialVersion),
        eq(ucUsersTable.mustChangePassword, true),
      )).returning({ id: ucUsersTable.id });
      if (!invalidated) return [];
    }
    return tx.update(ucOfflineClientsTable).set({
      accountSetupStatus: sent ? "created" : "failed",
      deliveryStatus: sent ? "sent" : "failed",
      deliveryAttempts: sql`${ucOfflineClientsTable.deliveryAttempts} + 1`,
      deliveryLastAttemptAt: new Date(),
      deliveryError: sent ? null : "Credential provider did not accept the message",
      deliveryClaimToken: null,
      deliveryClaimExpiresAt: null,
    }).where(and(
      eq(ucOfflineClientsTable.id, saleId),
      eq(ucOfflineClientsTable.deliveryClaimToken, claimedWork.claimToken),
    )).returning();
  });
  return updated ?? sale;
}

export async function retryOfflineSaleDelivery(saleId: number): Promise<PublicOfflineSale | null> {
  const row = await deliverOfflineSale(saleId);
  return row ? toPublicOfflineSale(row) : null;
}
