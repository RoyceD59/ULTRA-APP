import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { simulateRefillEconomics } from "@workspace/api-zod/refill-readiness";
import type { RefillCampaignProposal } from "@workspace/api-zod/refill-governance";
import { verifyToken } from "./jwt.js";

export class RefillGovernanceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

type Actor = { id: string; role: "admin" | "member" };
type Work<T> = (client: PoolClient, actor: Actor) => Promise<T>;

/** Pin the live team row until commit, so demotion cannot race an approval. */
export async function withRefillTeamActor<T>(authorization: string | undefined, admin: boolean, work: Work<T>): Promise<T> {
  const claims = verifyToken(authorization);
  if (claims?.type !== "team-session" || typeof claims.id !== "string") {
    throw new RefillGovernanceError(401, "TEAM_SESSION_REQUIRED", "A Project Hub team session is required.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; role: string; is_active: boolean }>(
      "SELECT id,role,is_active FROM team_users WHERE id=$1 FOR SHARE", [claims.id],
    );
    const row = result.rows[0];
    if (!row?.is_active || !["admin", "member"].includes(row.role)) {
      throw new RefillGovernanceError(403, "TEAM_ACCESS_REVOKED", "Team access is unavailable.");
    }
    if (admin && row.role !== "admin") {
      throw new RefillGovernanceError(403, "REFILL_ADMIN_REQUIRED", "A live team administrator is required.");
    }
    const value = await work(client, { id: row.id, role: row.role as Actor["role"] });
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function requireStation(client: PoolClient, stationId: string, forEnable: boolean) {
  const result = await client.query<{ id: string; name: string; active: boolean; verified: boolean }>(
    "SELECT id,name,active,verified FROM uc_locations WHERE id=$1 FOR SHARE", [stationId],
  );
  const station = result.rows[0];
  if (!station) throw new RefillGovernanceError(404, "STATION_NOT_FOUND", "Station not found.");
  if (forEnable && (!station.active || !station.verified)) {
    throw new RefillGovernanceError(409, "STATION_NOT_VERIFIED", "The station must be active and verified first.");
  }
  return station;
}

async function lockKey(client: PoolClient, scope: string, key: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [scope, key]);
}

export async function recordStationAction(client: PoolClient, actor: Actor, stationId: string, action: "enable" | "suspend", reason: string) {
  await lockKey(client, "refill-station", stationId);
  await requireStation(client, stationId, action === "enable");
  const prior = await client.query<{ id: string; action: string; actor_id: string }>(
    "SELECT id::text,action,actor_id FROM uc_refill_station_actions WHERE station_id=$1 ORDER BY id DESC LIMIT 1", [stationId],
  );
  if (prior.rows[0]?.action === action) return { action, changed: false, eventId: prior.rows[0].id };
  if (action === "enable" && prior.rows[0]?.action === "suspend" && prior.rows[0].actor_id === actor.id) {
    throw new RefillGovernanceError(403, "STATION_SELF_REENABLE_DENIED", "Another administrator must re-enable a suspended station.");
  }
  const inserted = await client.query<{ id: string }>(
    "INSERT INTO uc_refill_station_actions(station_id,action,actor_id,reason) VALUES($1,$2,$3,$4) RETURNING id::text",
    [stationId, action, actor.id, reason],
  );
  return { action, changed: true, eventId: inserted.rows[0]!.id };
}

export async function recordOperatorAction(client: PoolClient, actor: Actor, stationId: string, operatorId: string, action: "grant" | "revoke", reason: string) {
  await lockKey(client, "refill-station", stationId);
  await lockKey(client, "refill-operator", `${stationId}:${operatorId}`);
  await requireStation(client, stationId, action === "grant");
  const enabled = await client.query<{ id: string; action: string }>(
    "SELECT id::text,action FROM uc_refill_station_actions WHERE station_id=$1 ORDER BY id DESC LIMIT 1", [stationId],
  );
  if (action === "grant" && enabled.rows[0]?.action !== "enable") {
    throw new RefillGovernanceError(409, "STATION_SCOPE_REQUIRED", "The station must be enabled for the pilot before assignment.");
  }
  const operator = await client.query<{ id: string; role: string; is_active: boolean }>(
    "SELECT id,role,is_active FROM team_users WHERE id=$1 FOR SHARE", [operatorId],
  );
  if (!operator.rows[0]) throw new RefillGovernanceError(404, "OPERATOR_NOT_FOUND", "Team operator not found.");
  if (action === "grant" && (!operator.rows[0].is_active || operator.rows[0].role !== "member")) {
    throw new RefillGovernanceError(409, "OPERATOR_INELIGIBLE", "Only an active team member can receive a station assignment.");
  }
  const prior = await client.query<{ id: string; action: string; station_enable_event_id: string | null }>(
    "SELECT id::text,action,station_enable_event_id::text FROM uc_refill_operator_actions WHERE station_id=$1 AND operator_id=$2 ORDER BY id DESC LIMIT 1",
    [stationId, operatorId],
  );
  if (prior.rows[0]?.action === action && (action === "revoke" || prior.rows[0].station_enable_event_id === enabled.rows[0]?.id)) {
    return { action, changed: false, eventId: prior.rows[0].id };
  }
  const inserted = await client.query<{ id: string }>(
    "INSERT INTO uc_refill_operator_actions(station_id,operator_id,action,station_enable_event_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text",
    [stationId, operatorId, action, action === "grant" ? enabled.rows[0]!.id : null, actor.id, reason],
  );
  return { action, changed: true, eventId: inserted.rows[0]!.id };
}

/** Scope is a read-only precondition, never a dispense authorization. */
export async function listOperatorStations(client: PoolClient, actor: Actor) {
  const result = await client.query<{ station_id: string; name: string; action: string }>(`
    SELECT l.id AS station_id,l.name,grant_event.action
    FROM uc_locations l
    JOIN LATERAL (
      SELECT action,station_enable_event_id FROM uc_refill_operator_actions
      WHERE station_id=l.id AND operator_id=$1 ORDER BY id DESC LIMIT 1
    ) grant_event ON grant_event.action='grant'
    JOIN LATERAL (
      SELECT id,action FROM uc_refill_station_actions
      WHERE station_id=l.id ORDER BY id DESC LIMIT 1
    ) station_event ON station_event.action='enable' AND grant_event.station_enable_event_id=station_event.id
    WHERE l.active AND l.verified ORDER BY l.name,l.id`, [actor.id]);
  return { stations: result.rows.map(({ station_id, name }) => ({ stationId: station_id, name })), mayDispense: false };
}

export async function listGovernedStations(client: PoolClient) {
  const result = await client.query(`
    SELECT l.id AS "stationId",l.name,l.active,l.verified,
      COALESCE((SELECT action FROM uc_refill_station_actions WHERE station_id=l.id ORDER BY id DESC LIMIT 1),'unreviewed') AS status
    FROM uc_locations l ORDER BY l.name,l.id`);
  return result.rows;
}

export async function proposeCampaignVersion(client: PoolClient, actor: Actor, input: RefillCampaignProposal) {
  await requireStation(client, input.stationId, true);
  const payload = {
    campaignKey: input.campaignKey, version: input.version, stationId: input.stationId,
    eligibilityPolicy: input.eligibilityPolicy, maxGrants: input.maxGrants,
    startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(input.endsAt).toISOString(),
    scenario: input.scenario,
  };
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await lockKey(client, "refill-rule", `${input.campaignKey}:${input.stationId}:${input.version}`);
  const prior = await client.query<{ id: string; proposal_hash: string }>(
    "SELECT id::text,proposal_hash FROM uc_refill_campaign_versions WHERE campaign_key=$1 AND station_id=$2 AND version=$3",
    [input.campaignKey, input.stationId, input.version],
  );
  if (prior.rows[0]) {
    if (prior.rows[0].proposal_hash !== hash) throw new RefillGovernanceError(409, "RULE_VERSION_CONFLICT", "This version already has different terms.");
    return { id: prior.rows[0].id, proposalHash: hash, created: false, status: "existing" as const };
  }
  const scenario = input.scenario;
  const result = await client.query<{ id: string }>(`
    INSERT INTO uc_refill_campaign_versions
      (campaign_key,version,station_id,pricing_version,eligibility_policy,credit_ml,max_grants,
       sponsor_funding_minor,cash_charge_minor,costs_minor,starts_at,ends_at,proposal_hash,proposed_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9::jsonb,$10,$11,$12,$13) RETURNING id::text`,
    [input.campaignKey, input.version, input.stationId, scenario.pricingVersion, input.eligibilityPolicy,
      scenario.volumeMl, input.maxGrants, scenario.sponsorFundingMinor, JSON.stringify(scenario.costs),
      payload.startsAt, payload.endsAt, hash, actor.id],
  );
  return { id: result.rows[0]!.id, proposalHash: hash, created: true, status: "proposed" as const };
}

type RuleRow = {
  id: string; campaign_key: string; version: number; pricing_version: string;
  credit_ml: string; sponsor_funding_minor: string; cash_charge_minor: string;
  costs_minor: Record<string, number | null>; proposed_by: string;
};

export async function recordCampaignAction(client: PoolClient, actor: Actor, ruleId: string, action: "approve" | "suspend", reason: string) {
  const result = await client.query<RuleRow>(`
    SELECT id::text,campaign_key,version,pricing_version,credit_ml::text,sponsor_funding_minor::text,
      cash_charge_minor::text,costs_minor,proposed_by FROM uc_refill_campaign_versions WHERE id=$1 FOR UPDATE`, [ruleId]);
  const rule = result.rows[0];
  if (!rule) throw new RefillGovernanceError(404, "RULE_NOT_FOUND", "Rule version not found.");
  const previous = await client.query<{ action: string; actor_id: string; id: string }>(
    "SELECT action,actor_id,id::text FROM uc_refill_campaign_actions WHERE campaign_version_id=$1 ORDER BY id", [ruleId],
  );
  if (previous.rows.some((row) => row.action === action)) {
    return { action, changed: false, eventId: previous.rows.find((row) => row.action === action)!.id,
      status: previous.rows.some((row) => row.action === "suspend") ? "suspended" : "reviewed" };
  }
  if (action === "approve") {
    if (rule.proposed_by === actor.id) throw new RefillGovernanceError(403, "SELF_APPROVAL_DENIED", "A second administrator must review this version.");
    if (previous.rows.some((row) => row.action === "suspend")) throw new RefillGovernanceError(409, "RULE_SUSPENDED", "A suspended version cannot be approved.");
    let economics;
    try {
      economics = simulateRefillEconomics({
        pricingVersion: rule.pricing_version, campaignVersion: `${rule.campaign_key}:${rule.version}`,
        volumeMl: Number(rule.credit_ml), cashChargeMinor: Number(rule.cash_charge_minor),
        sponsorFundingMinor: Number(rule.sponsor_funding_minor), costs: rule.costs_minor,
      });
    } catch {
      throw new RefillGovernanceError(422, "RULE_COSTS_UNRESOLVED", "The scenario exceeds the supported integer range or has invalid costs.");
    }
    if (economics.status !== "complete" || economics.contributionMinor === null || economics.contributionMinor < 0) {
      throw new RefillGovernanceError(422, "RULE_COSTS_UNRESOLVED", "Verified costs and non-negative scenario funding are required for review.");
    }
  }
  const inserted = await client.query<{ id: string }>(
    "INSERT INTO uc_refill_campaign_actions(campaign_version_id,action,actor_id,reason) VALUES($1,$2,$3,$4) RETURNING id::text",
    [ruleId, action, actor.id, reason],
  );
  return { action, changed: true, eventId: inserted.rows[0]!.id, status: action === "suspend" ? "suspended" : "reviewed" };
}

export async function listCampaignVersions(client: PoolClient) {
  const result = await client.query(`
    SELECT v.id,v.campaign_key AS "campaignKey",v.version,v.station_id AS "stationId",
      v.pricing_version AS "pricingVersion",v.eligibility_policy AS "eligibilityPolicy",
      v.credit_ml::text AS "creditMl",v.max_grants AS "maxGrants",
      v.sponsor_funding_minor::text AS "sponsorFundingMinor",v.costs_minor AS "costsMinor",
      v.starts_at AS "startsAt",v.ends_at AS "endsAt",v.proposal_hash AS "proposalHash",
      v.proposed_by AS "proposedBy",v.created_at AS "createdAt",
      CASE WHEN EXISTS(SELECT 1 FROM uc_refill_campaign_actions a WHERE a.campaign_version_id=v.id AND a.action='suspend') THEN 'suspended'
           WHEN EXISTS(SELECT 1 FROM uc_refill_campaign_actions a WHERE a.campaign_version_id=v.id AND a.action='approve') THEN 'reviewed'
           ELSE 'proposed' END AS status
    FROM uc_refill_campaign_versions v ORDER BY v.created_at DESC,v.id DESC`);
  return result.rows;
}
