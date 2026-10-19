import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

export type RefillFeatures = {
  careOverview: boolean;
  refillGovernance: boolean;
};

export type RefillFeaturesUpdate = Partial<RefillFeatures>;

const FEATURE_COLUMNS = {
  careOverview: "care_overview_preview",
  refillGovernance: "refill_governance_preview",
} as const;
let refillFeaturesReaderOverrideForTests: (() => Promise<RefillFeatures>) | null = null;

/** Dependency seam for route tests; production reads the durable singleton row. */
export function setRefillFeaturesReaderForTests(
  reader: (() => Promise<RefillFeatures>) | null,
): void {
  refillFeaturesReaderOverrideForTests = reader;
}

export async function readRefillFeatures(client?: PoolClient): Promise<RefillFeatures> {
  if (!client && process.env.NODE_ENV === "test" && refillFeaturesReaderOverrideForTests) {
    return refillFeaturesReaderOverrideForTests();
  }
  const result = await (client ?? pool).query<{
    care_overview_preview: boolean | null;
    refill_governance_preview: boolean | null;
  }>(
    "SELECT care_overview_preview,refill_governance_preview FROM team_settings WHERE id='singleton' LIMIT 1",
  );
  const row = result.rows[0];
  return {
    careOverview: row?.care_overview_preview === true,
    refillGovernance: row?.refill_governance_preview === true,
  };
}

/** Update just the keys in the patch; advisory locks serialize each key independently. */
export async function updateRefillFeatures(
  client: PoolClient,
  updates: RefillFeaturesUpdate,
): Promise<RefillFeatures> {
  await client.query("INSERT INTO team_settings (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING");
  for (const key of (Object.keys(updates) as (keyof RefillFeatures)[]).sort()) {
    const column = FEATURE_COLUMNS[key];
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ["refill-feature", key]);
    await client.query(
      `UPDATE team_settings SET ${column}=$1,updated_at=now() WHERE id='singleton'`,
      [updates[key]],
    );
  }
  return readRefillFeatures(client);
}

export async function isRefillGovernanceEnabled(): Promise<boolean> {
  const features = refillFeaturesReaderOverrideForTests
    ? await refillFeaturesReaderOverrideForTests()
    : await readRefillFeatures();
  return features.refillGovernance;
}