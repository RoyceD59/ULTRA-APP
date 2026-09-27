import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import { resolveAndCreateCustomerIdentity, resolveCustomerIdentity } from "../lib/customer-identity-resolution.js";

const createdIds: number[] = [];
const makePhone = () => `+2547${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
const makeEmail = (prefix: string) => `${prefix}-${randomUUID()}@example.test`;

async function createUser(values: {
  email: string; phone: string; deletedAt?: Date | null;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, phone, password_hash, first_name, last_name, deleted_at)
     VALUES ($1, $2, 'test-sentinel', 'Identity', 'Fixture', $3) RETURNING id`,
    [values.email, values.phone, values.deletedAt ?? null],
  );
  createdIds.push(result.rows[0]!.id);
  return result.rows[0]!.id;
}

async function withClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

after(async () => {
  if (createdIds.length) await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [createdIds]);
  await pool.end();
});

test("classifies an unmatched identity as create_allowed", async () => {
  const contact = makeEmail("identity-create");
  const classification = await withClient((client) =>
    resolveCustomerIdentity({ email: contact }, client));
  assert.deepEqual(classification, { kind: "create_allowed", candidateCustomerIds: [] });
});

test("classifies existing candidates but never authorizes reuse", async () => {
  const contact = makeEmail("identity-candidate");
  const userId = await createUser({ email: contact, phone: makePhone() });
  const classification = await withClient((client) =>
    resolveCustomerIdentity({ email: contact }, client));
  assert.deepEqual(classification, {
    kind: "one_active_candidate", customerId: userId, candidateCustomerIds: [userId],
  });
  assert.equal("proof" in classification, false);
  assert.equal("reuse" in classification, false);
});

test("classifies conflict, ambiguity, and deleted-only candidates", async () => {
  const suffix = randomUUID();
  const conflictEmail = `identity-conflict-${suffix}@example.test`;
  const conflictPhone = makePhone();
  const emailId = await createUser({ email: conflictEmail, phone: makePhone() });
  const phoneId = await createUser({ email: `other-${suffix}@example.test`, phone: conflictPhone });
  const conflict = await withClient((client) =>
    resolveCustomerIdentity({ email: conflictEmail, phone: conflictPhone }, client));
  assert.equal(conflict.kind, "email_phone_conflict");
  assert.deepEqual(conflict.candidateCustomerIds, [emailId, phoneId].sort((a, b) => a - b));

  const duplicatePhone = makePhone();
  const first = await createUser({ email: makeEmail("identity-duplicate-a"), phone: duplicatePhone });
  const second = await createUser({ email: makeEmail("identity-duplicate-b"), phone: duplicatePhone });
  const ambiguous = await withClient((client) =>
    resolveCustomerIdentity({ phone: duplicatePhone }, client));
  assert.equal(ambiguous.kind, "ambiguous");
  assert.deepEqual(ambiguous.candidateCustomerIds, [first, second].sort((a, b) => a - b));

  const deletedEmail = makeEmail("identity-deleted");
  const deletedId = await createUser({ email: deletedEmail, phone: makePhone(), deletedAt: new Date() });
  const deleted = await withClient((client) =>
    resolveCustomerIdentity({ email: deletedEmail }, client));
  assert.deepEqual(deleted, { kind: "deleted_only", candidateCustomerIds: [deletedId] });

  const mixedPhone = makePhone();
  const activeMixedId = await createUser({ email: makeEmail("identity-mixed-active"), phone: mixedPhone });
  const deletedMixedId = await createUser({
    email: makeEmail("identity-mixed-deleted"), phone: mixedPhone, deletedAt: new Date(),
  });
  const mixed = await withClient((client) =>
    resolveCustomerIdentity({ phone: mixedPhone }, client));
  assert.equal(mixed.kind, "mixed_deleted_conflict");
  assert.deepEqual(mixed.candidateCustomerIds, [activeMixedId, deletedMixedId].sort((a, b) => a - b));
});

test("concurrent service-owned creation converges to one active user", async () => {
  const contact = makeEmail("identity-concurrent");
  const outcomes = await Promise.all(Array.from({ length: 8 }, () =>
    resolveAndCreateCustomerIdentity({ email: contact }, async (client) => {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO uc_users (email, phone, password_hash, first_name, last_name)
         VALUES ($1, '', 'test-sentinel', 'Concurrent', 'Fixture') RETURNING id`,
        [contact.toLowerCase()],
      );
      createdIds.push(inserted.rows[0]!.id);
      return inserted.rows[0]!.id;
    }),
  ));
  const created = outcomes.map((outcome) => outcome.createdCustomerId)
    .filter((id): id is number => id !== null);
  assert.equal(created.length, 1);
  const classifications = outcomes.map((outcome) => outcome.classification.kind);
  assert.equal(classifications.filter((kind) => kind === "create_allowed").length, 1);
  assert.equal(classifications.filter((kind) => kind === "one_active_candidate").length, 7);
  const rows = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM uc_users WHERE email = $1 AND deleted_at IS NULL",
    [contact.toLowerCase()],
  );
  assert.equal(rows.rows[0]!.count, "1");
});