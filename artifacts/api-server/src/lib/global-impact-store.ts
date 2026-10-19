import { pool } from "@workspace/db";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { logger } from "./logger.js";

// Same DDL as migration 0067. No defaults: missing historical evidence is not zero.
export const GLOBAL_IMPACT_DDL = `
CREATE TABLE IF NOT EXISTS uc_global_impact (
 id text PRIMARY KEY CHECK (id = 'global'), litres_offset double precision NOT NULL,
 users_offset double precision NOT NULL, revision integer NOT NULL CHECK (revision > 0),
 last_updated_by text NOT NULL, last_updated_at timestamptz, legacy_sha256 text);
CREATE TABLE IF NOT EXISTS uc_global_impact_audit (
 id bigserial PRIMARY KEY, action text NOT NULL, actor text NOT NULL,
 previous jsonb, next jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`;

export function parseLegacyImpact(raw: string) {
  const data = JSON.parse(raw);
  if (!data || !Number.isFinite(data.litresOffset) || !Number.isFinite(data.usersOffset)
      || typeof data.lastUpdatedBy !== "string" || typeof data.lastUpdatedAt !== "string"
      || (data.lastUpdatedAt && !Number.isFinite(Date.parse(data.lastUpdatedAt)))) {
    throw new Error("Malformed legacy impact adjustments; import refused");
  }
  return data as { litresOffset: number; usersOffset: number; lastUpdatedBy: string; lastUpdatedAt: string };
}

/** Explicit, idempotent import; never replaces an existing shared adjustment. */
export async function importLegacyImpact(raw: string, database: Pool = pool) {
  const legacy = parseLegacyImpact(raw);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(951067)");
    const result = await client.query(`INSERT INTO uc_global_impact
      (id,litres_offset,users_offset,revision,last_updated_by,last_updated_at,legacy_sha256)
      VALUES ('global',$1,$2,1,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING *`,
    [legacy.litresOffset, legacy.usersOffset, legacy.lastUpdatedBy,
      legacy.lastUpdatedAt || null, createHash("sha256").update(raw).digest("hex")]);
    if (result.rows[0]) await client.query(`INSERT INTO uc_global_impact_audit(action,actor,next)
      VALUES ('legacy-import','system',$1)`, [JSON.stringify(result.rows[0])]);
    await client.query("COMMIT");
    return !!result.rowCount;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function ensureGlobalImpactSchema() {
  await pool.query(GLOBAL_IMPACT_DDL);
  if ((await pool.query("SELECT 1 FROM uc_global_impact WHERE id='global'")).rowCount) return;
  // Resolve both repo-root and package cwd, without silently swallowing bad files.
  const candidates = [resolve("artifacts/api-server/data/impact-override.json"), resolve("data/impact-override.json")];
  try {
    const raw = await findLegacyImpactEvidence(candidates);
    if (raw === null) logger.warn("No legacy impact evidence found; explicit staff initialization required");
    else await importLegacyImpact(raw);
  } catch (error) {
    logger.error({ err: error }, "Legacy impact evidence unavailable or malformed; shared totals remain unavailable");
  }
}

export async function findLegacyImpactEvidence(
  candidates: string[], read: (file: string) => Promise<string> = file => readFile(file, "utf8"),
) {
  for (const file of candidates) {
    let raw: string;
    try { raw = await read(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    parseLegacyImpact(raw);
    return raw;
  }
  return null;
}

export class ImpactConflict extends Error {}

export async function saveGlobalImpact(
  patch: { litresOffset?: number; usersOffset?: number }, actor: string,
  expectedRevision?: number, database: Pool = pool,
) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Serializes initialization as well as subsequent writes across processes.
    await client.query("SELECT pg_advisory_xact_lock(951067)");
    const previous = (await client.query("SELECT * FROM uc_global_impact WHERE id='global' FOR UPDATE")).rows[0];
    if (expectedRevision !== undefined && expectedRevision !== (previous?.revision ?? 0)) throw new ImpactConflict("Adjustments changed. Refresh before saving.");
    if (!previous && (patch.litresOffset === undefined || patch.usersOffset === undefined)) {
      throw new ImpactConflict("Both adjustments are required for explicit initialization.");
    }
    const next = (await client.query(`INSERT INTO uc_global_impact
      (id,litres_offset,users_offset,revision,last_updated_by,last_updated_at)
      VALUES ('global',$1,$2,$3,$4,now()) ON CONFLICT(id) DO UPDATE SET
      litres_offset=EXCLUDED.litres_offset,users_offset=EXCLUDED.users_offset,
      revision=EXCLUDED.revision,last_updated_by=EXCLUDED.last_updated_by,last_updated_at=EXCLUDED.last_updated_at
      RETURNING *`, [patch.litresOffset ?? previous.litres_offset, patch.usersOffset ?? previous.users_offset,
      (previous?.revision ?? 0) + 1, actor])).rows[0];
    await client.query(`INSERT INTO uc_global_impact_audit(action,actor,previous,next)
      VALUES ('staff-update',$1,$2,$3)`, [actor, previous ? JSON.stringify(previous) : null, JSON.stringify(next)]);
    await client.query("COMMIT");
    return next;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
