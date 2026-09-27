import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { normalizeEmail, normalizePhone } from "./customer-identity.js";

export type IdentityResolutionInput = {
  email?: string | null;
  phone?: string | null;
};

export type IdentityClassification =
  | { kind: "create_allowed"; candidateCustomerIds: [] }
  | { kind: "one_active_candidate"; customerId: number; candidateCustomerIds: [number] }
  | { kind: "deleted_only"; candidateCustomerIds: number[] }
  | { kind: "mixed_deleted_conflict"; candidateCustomerIds: number[] }
  | { kind: "ambiguous"; candidateCustomerIds: number[] }
  | { kind: "email_phone_conflict"; candidateCustomerIds: number[] };

type IdentityRow = {
  id: number;
  email: string;
  phone: string;
  deleted_at: Date | null;
};

/**
 * A candidate-only resolver. The PoolClient must already be inside the
 * caller's transaction; this function never begins, commits, or rolls back.
 * It intentionally has no proof or authorization input: trusted route code
 * performs session/password/provider verification before reusing a candidate.
 */
export async function resolveCustomerIdentity(
  input: IdentityResolutionInput,
  client: PoolClient,
): Promise<IdentityClassification> {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw new Error("A valid phone is required");
  if (!email && !phone) throw new Error("An email or phone is required");

  // Match the existing account-records lock namespace and order exactly.
  if (email) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`uc-email:${email}`]);
  if (phone) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`uc-phone:${phone}`]);

  const predicates: string[] = [];
  const params: string[] = [];
  if (email) {
    params.push(email);
    predicates.push(`email = $${params.length}`);
  }
  if (phone) {
    params.push(phone);
    predicates.push(`phone = $${params.length}`);
  }
  const rows = (await client.query<IdentityRow>(
    `SELECT id, email, phone, deleted_at
       FROM uc_users WHERE ${predicates.join(" OR ")} ORDER BY id FOR KEY SHARE`,
    params,
  )).rows;
  const emailRows = email ? rows.filter((row) => row.email === email) : [];
  const phoneRows = phone ? rows.filter((row) => row.phone === phone) : [];
  const activeEmail = emailRows.filter((row) => row.deleted_at === null);
  const activePhone = phoneRows.filter((row) => row.deleted_at === null);
  const activeIds = [...activeEmail, ...activePhone].map((row) => row.id);
  const deletedIds = [...emailRows, ...phoneRows]
    .filter((row) => row.deleted_at !== null).map((row) => row.id);
  const emailMixed = activeEmail.length > 0 && emailRows.length > activeEmail.length;
  const phoneMixed = activePhone.length > 0 && phoneRows.length > activePhone.length;
  const crossDeleted = (activeEmail.length > 0 && phoneRows.some((row) => row.deleted_at !== null))
    || (activePhone.length > 0 && emailRows.some((row) => row.deleted_at !== null));

  if (emailMixed || phoneMixed || crossDeleted) {
    return {
      kind: "mixed_deleted_conflict",
      candidateCustomerIds: [...new Set([...activeIds, ...deletedIds])].sort((a, b) => a - b),
    };
  }
  if (activeEmail.length === 1 && activePhone.length === 1 && activeEmail[0]!.id !== activePhone[0]!.id) {
    return { kind: "email_phone_conflict", candidateCustomerIds: [...new Set(activeIds)].sort((a, b) => a - b) };
  }
  if (activeEmail.length > 1 || activePhone.length > 1) {
    return { kind: "ambiguous", candidateCustomerIds: [...new Set(activeIds)].sort((a, b) => a - b) };
  }
  if (activeIds.length === 0 && deletedIds.length > 0) {
    return { kind: "deleted_only", candidateCustomerIds: [...new Set(deletedIds)].sort((a, b) => a - b) };
  }
  if (activeIds.length === 0) return { kind: "create_allowed", candidateCustomerIds: [] };
  const customerId = activeIds[0]!;
  return { kind: "one_active_candidate", customerId, candidateCustomerIds: [customerId] };
}

export type IdentityCreateCallback = (
  client: PoolClient,
  classification: Extract<IdentityClassification, { kind: "create_allowed" }>,
) => Promise<number>;

/**
 * The only service-owned creation API. It commits once, after the callback.
 * Existing candidates are never reused or linked and never invoke `create`.
 */
export async function resolveAndCreateCustomerIdentity(
  input: IdentityResolutionInput,
  create: IdentityCreateCallback,
): Promise<{ classification: IdentityClassification; createdCustomerId: number | null }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const classification = await resolveCustomerIdentity(input, client);
    let createdCustomerId: number | null = null;
    if (classification.kind === "create_allowed") {
      createdCustomerId = await create(client, classification);
    }
    await client.query("COMMIT");
    return { classification, createdCustomerId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}