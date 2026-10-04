import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import {
  normalizeInstantFirstName,
  normalizeInstantPhone as normalizeSharedPhone,
} from "@workspace/api-zod/instant-water-identity";
import { countryCodeFromValue } from "@workspace/api-zod/phone";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, ObjectStorageService } from "./objectStorage.js";
import {
  scoreInstantWaterCheck,
  normalizeWaterSelections,
  type InstantWaterCheckAnswers,
  type InstantWaterCheckResult,
} from "./instant-water-check.js";
import { enqueueLeadDelivery } from "./lead-delivery.js";
import { quotePromotion, consumePromotionOnClient } from "./reward-promotions.js";
import { notifyPhysicalTest } from "./physical-test-notifications.js";
import { withWaterRecommendationTarget, type CatalogueLoader } from "./water-recommendation-targets.js";

const PUBLIC_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const ACTION_TOKEN_TTL_MS = 30 * 60 * 1000;
const HANDOFF_TOKEN_TTL_MS = 20 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
function tokenSecret(): string {
  const value = process.env.WATER_CHECK_TOKEN_SECRET ?? process.env.SESSION_SECRET;
  if (!value) throw new Error("TOKEN_SECRET_MISSING");
  return value;
}

export type AssessmentRow = {
  id: string;
  reference: string;
  customer_user_id: string | null;
  first_name: string;
  normalized_phone: string;
  phone_verification_state: string;
  phone_verified_at: Date | null;
  country: string;
  area: string;
  source: string;
  concern: string;
  setting: string;
  raw_answers: InstantWaterCheckAnswers;
  result: InstantWaterCheckResult;
  area_flags: { hardGroundwater?: boolean; riftValleyFluoride?: boolean };
  source_attribution: Record<string, string>;
  lifecycle_status: string;
  account_link_state: string;
  physical_request_state: string;
  public_token_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type AssessmentResponse = {
  assessmentId: string;
  reference: string;
  resultToken?: string;
  resultTokenExpiresAt?: Date;
  result: ReturnType<typeof redactInstantWaterResult>;
};
/** Old snapshots may have empty raw_answers but valid compatibility columns.
 * Restore selections only; never recompute the saved result. */
function storedWaterAnswers(row: {
  raw_answers?: Partial<InstantWaterCheckAnswers>;
  area?: string; country?: string; source?: string; concern?: string; setting?: string;
}) {
  return normalizeWaterSelections({
    country: row.country,
    area: row.area ?? "Unknown",
    source: row.source as InstantWaterCheckAnswers["source"],
    concern: row.concern as InstantWaterCheckAnswers["concern"],
    setting: row.setting as InstantWaterCheckAnswers["setting"],
    ...row.raw_answers,
  });
}

export function normalizeInstantPhone(raw: string, country?: Parameters<typeof normalizeSharedPhone>[1]): string | null {
  return normalizeSharedPhone(raw, country);
}

function hashSecret(value: string): string {
  return createHmac("sha256", tokenSecret()).update(value).digest("hex");
}

export function hashInstantSecurityKey(value: string): string {
  return hashSecret(value);
}

function encryptOtpCode(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(tokenSecret()).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptOtpCode(value: string): string {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(tokenSecret()).digest(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

async function enforceDurableRateLimit(
  key: string,
  max: number,
  windowMs: number,
  executor: Pick<PoolClient, "query"> = pool,
): Promise<void> {
  const bucketStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const keyHash = hashSecret(`rate:${key}`);
  const result = await executor.query(
    `INSERT INTO instant_water_rate_limits (key_hash, bucket_start, request_count)
       VALUES ($1, $2, 1)
     ON CONFLICT (key_hash) DO UPDATE
       SET bucket_start = EXCLUDED.bucket_start,
           request_count = CASE
             WHEN instant_water_rate_limits.bucket_start < EXCLUDED.bucket_start THEN 1
             ELSE instant_water_rate_limits.request_count + 1
           END,
           updated_at = now()
     RETURNING request_count`,
    [keyHash, bucketStart],
  );
  if (Number(result.rows[0]?.request_count ?? 0) > max) throw new Error("RATE_LIMITED");
}

export function instantOtpRateLimitKeys(
  operation: "request" | "confirm" | "failed-confirm",
  ipKey: string,
  phone: string,
): { ip: string; phone: string } {
  const prefix = operation === "failed-confirm" ? "otp-failed" : `otp-${operation}`;
  return { ip: `${prefix}-ip:${ipKey}`, phone: `${prefix}-phone:${phone}` };
}

export function instantCreateRateLimitKeys(
  ipKey: string,
  phone: string | null,
  assessmentKey?: string,
): { ip: string; phone?: string; assessment?: string } {
  return {
    ip: `create-ip:${ipKey}`,
    ...(phone ? { phone: `create-phone:${phone}` } : {}),
    ...(assessmentKey ? { assessment: `create-assessment:${assessmentKey}` } : {}),
  };
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

function parseRow(row: Record<string, unknown>): AssessmentRow {
  return row as unknown as AssessmentRow;
}

export function serviceAvailable(country: string): boolean {
  return country.trim().toLowerCase() === "kenya";
}

export function redactInstantWaterResult(result: InstantWaterCheckResult, reference: string, country: string, status: string) {
  const flag = result.areaFlags.riftValleyFluoride
    ? "rift_valley_fluoride"
    : result.areaFlags.hardGroundwater
      ? "hard_groundwater"
      : "none";
  return {
    reference,
    rulesVersion: result.rulesVersion,
    bands: result.bands,
    summary: result.summary,
    areaFlag: flag as "none" | "hard_groundwater" | "rift_valley_fluoride",
    recommendation: result.recommendation,
    disclaimer: result.disclaimer,
    provenance: result.provenance,
    serviceAvailable: serviceAvailable(country),
    physicalTestStatus: status,
  };
}

export function determineAccountLinkState(matchCount: number): "verified_unmatched" | "attached" | "ambiguous_match" {
  return matchCount === 1 ? "attached" : matchCount > 1 ? "ambiguous_match" : "verified_unmatched";
}

export function canAttachInstantAssessment(accountLinkState: string, customerUserId: string | null): boolean {
  return !customerUserId && ["unverified_lead", "verified_unmatched", "ambiguous_match"].includes(accountLinkState);
}

export function physicalServiceState(country: string): "physical_test_requested" | "follow_up_requested" {
  return serviceAvailable(country) ? "physical_test_requested" : "follow_up_requested";
}

export function mediaObjectPath(reference: string): string | null {
  const value = reference.trim();
  const match = value.match(/(?:^|\/)storage\/objects\/((?:water-tests\/[A-Za-z0-9_-]+\/(?:customer-[A-Za-z0-9_-]+|lead)\/|uploads\/)[A-Za-z0-9-]+)$/);
  if (match) return `/objects/${match[1]}`;
  if (/^\/objects\/(?:water-tests\/[A-Za-z0-9_-]+\/(?:customer-[A-Za-z0-9_-]+|lead)\/|uploads\/)[A-Za-z0-9-]+$/.test(value)) return value;
  return null;
}

export function projectHubMediaReferences(
  assessmentId: string,
  references: unknown,
): Array<{ reference: string; mediaType: string; downloadUrl: string }> {
  if (!Array.isArray(references)) return [];
  return references.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as { reference?: unknown; mediaType?: unknown };
    const path = typeof value.reference === "string" ? mediaObjectPath(value.reference) : null;
    const mediaType = typeof value.mediaType === "string" ? value.mediaType : "";
    if (!path || !path.startsWith(`/objects/water-tests/${assessmentId}/`) ||
        !["jpg", "png", "webp", "mp4", "mov", "webm"].includes(mediaType)) return [];
    const opaqueReference = path.slice(path.lastIndexOf("/") + 1);
    return [{
      reference: opaqueReference,
      mediaType,
      downloadUrl: `/api/storage/private${path.slice("/objects".length)}`,
    }];
  });
}

export function instantMediaSignatureValid(mediaType: string, bytes: Buffer): boolean {
  return (
    (mediaType === "jpg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mediaType === "png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (mediaType === "webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") ||
    ((mediaType === "mp4" || mediaType === "mov") && bytes.length >= 12 && bytes.subarray(4, 8).toString() === "ftyp") ||
    (mediaType === "webm" && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
  );
}

async function verifyInstantMediaReferences(
  assessmentId: string,
  userId: string | undefined,
  media: Array<{ reference: string; mediaType: string }>,
): Promise<string[]> {
  const paths: string[] = [];
  const storage = new ObjectStorageService();
  for (const item of media) {
    const path = mediaObjectPath(item.reference);
    if (!path) throw new Error("INVALID_MEDIA_REFERENCE");
    if (!path.startsWith(`/objects/water-tests/${assessmentId}/`)) {
      throw new Error("INVALID_MEDIA_REFERENCE");
    }
    const row = await pool.query(
      `SELECT object_path, uploader_user_id, assessment_id, declared_type, declared_size,
              detected_type, detected_size, scan_status
         FROM instant_water_media_uploads
        WHERE object_path = $1 AND expires_at > now() AND consumed_at IS NULL
        LIMIT 1`,
      [path],
    );
    const upload = row.rows[0] as {
      object_path: string; uploader_user_id: string | null; assessment_id: string | null;
      declared_type: string; declared_size: number; detected_type: string | null;
      detected_size: number | null; scan_status: string;
    } | undefined;
    if (!upload || !upload.assessment_id || upload.assessment_id !== assessmentId ||
        userId && upload.uploader_user_id !== userId ||
        !userId && upload.uploader_user_id !== null ||
        upload.scan_status === "rejected" ||
        upload.detected_type && upload.detected_type !== upload.declared_type ||
        upload.detected_size && upload.detected_size !== upload.declared_size) {
      throw new Error("MEDIA_OWNERSHIP_INVALID");
    }
    try {
      const file = await storage.getObjectEntityFile(path);
      const [metadata] = await file.getMetadata();
      const detectedType = String(metadata.contentType ?? "");
      const detectedSize = Number(metadata.size ?? 0);
      const expectedTypes: Record<string, string[]> = {
        jpg: ["image/jpeg"], png: ["image/png"], webp: ["image/webp"],
        mp4: ["video/mp4"], mov: ["video/quicktime"], webm: ["video/webm"],
      };
      const [bytes] = await file.download();
      const signatureValid = instantMediaSignatureValid(item.mediaType, bytes);
      const maximumBytes = ["mp4", "mov", "webm"].includes(item.mediaType) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (!expectedTypes[item.mediaType]?.includes(detectedType) ||
          detectedSize <= 0 || detectedSize !== upload.declared_size ||
          detectedSize > maximumBytes ||
          bytes.length !== detectedSize || !signatureValid) {
        await pool.query(
          `UPDATE instant_water_media_uploads
              SET detected_type = $2, detected_size = $3, scan_status = 'rejected'
            WHERE object_path = $1`,
          [path, detectedType, detectedSize],
        );
        throw new Error("MEDIA_METADATA_INVALID");
      }
      await pool.query(
        `UPDATE instant_water_media_uploads
            SET detected_type = $2, detected_size = $3, scan_status = 'clean'
          WHERE object_path = $1`,
        [path, detectedType, detectedSize],
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("MEDIA_")) throw error;
      await pool.query(
        `UPDATE instant_water_media_uploads SET scan_status = 'rejected' WHERE object_path = $1`,
        [path],
      ).catch(() => undefined);
      throw new Error("MEDIA_METADATA_INVALID");
    }
    paths.push(path);
  }
  return paths;
}

function stablePayload(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

async function findById(client: { query: Function }, id: string): Promise<AssessmentRow | null> {
  const result = await client.query(
    `SELECT * FROM instant_water_assessments WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ? parseRow(result.rows[0]) : null;
}

export function maskPhone(phone: string): string {
  return phone.length < 7 ? "***" : `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

export async function createInstantAssessment(input: {
  firstName: string;
  phone: string;
  consentVersion: string;
  country: string;
  area: string;
  answers: Partial<InstantWaterCheckAnswers> & { area: string };
  sourceAttribution?: Record<string, string | undefined>;
  customerUserId?: string | null;
  scope: string;
  idempotencyKey: string;
  rateKey?: string;
}, options: { loadCatalogue?: CatalogueLoader } = {}): Promise<{ response: AssessmentResponse; replay: boolean }> {
  const normalizedFirstName = normalizeInstantFirstName(input.firstName);
  if (!normalizedFirstName) throw new Error("INVALID_FIRST_NAME");
  const normalizedPhone = normalizeSharedPhone(input.phone, countryCodeFromValue(input.country) ?? "KE");
  if (!normalizedPhone) throw new Error("INVALID_PHONE");
  const answers = normalizeWaterSelections(input.answers);
  input = { ...input, answers };
  const requestPayload = {
    firstName: normalizedFirstName,
    normalizedPhone,
    consentVersion: input.consentVersion,
    country: input.country.trim(),
    area: input.area.trim(),
    answers: input.answers,
    sourceAttribution: input.sourceAttribution ?? {},
    customerUserId: input.customerUserId ?? null,
  };
  const requestHash = hashSecret(stablePayload(requestPayload));
  const legacyAnswers = { ...answers };
  delete legacyAnswers.sources; delete legacyAnswers.concerns; delete legacyAnswers.settings;
  const compatibleHashes = new Set([requestHash]);
  if (answers.sources!.length === 1 && answers.concerns!.length === 1 && answers.settings!.length === 1) {
    compatibleHashes.add(hashSecret(stablePayload({ ...requestPayload, answers: legacyAnswers })));
  }
  // Completed retries need neither fresh scoring nor a remote catalogue lookup.
  const stored = await pool.query(
    `SELECT request_hash, response FROM instant_water_idempotency
     WHERE endpoint = 'create-instant-water-assessment' AND scope = $1
       AND idempotency_key = $2 AND expires_at > now()`,
    [input.scope, input.idempotencyKey],
  );
  if (stored.rows[0]) {
    if (!compatibleHashes.has(stored.rows[0].request_hash)) throw new Error("IDEMPOTENCY_CONFLICT");
    return { response: stored.rows[0].response as AssessmentResponse, replay: true };
  }
  const result = scoreInstantWaterCheck(answers, input.country);
  // Do not acquire a transaction/client while waiting on WooCommerce.
  result.recommendation = await withWaterRecommendationTarget(result.recommendation, options.loadCatalogue);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Another submission may have completed during the catalogue lookup.
    const prior = await client.query(
      `SELECT request_hash, response FROM instant_water_idempotency
       WHERE endpoint = 'create-instant-water-assessment' AND scope = $1
         AND idempotency_key = $2 AND expires_at > now()
       FOR UPDATE`,
      [input.scope, input.idempotencyKey],
    );
    if (prior.rows[0]) {
      if (!compatibleHashes.has(prior.rows[0].request_hash)) {
        await client.query("ROLLBACK");
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      await client.query("COMMIT");
      return { response: prior.rows[0].response as AssessmentResponse, replay: true };
    }
    if (input.rateKey) {
      const limits = instantCreateRateLimitKeys(input.rateKey, normalizedPhone, input.customerUserId ?? undefined);
      try {
        await enforceDurableRateLimit(limits.ip, 8, 60 * 60 * 1000, client);
        if (limits.phone) await enforceDurableRateLimit(limits.phone, 8, 60 * 60 * 1000, client);
        if (limits.assessment) await enforceDurableRateLimit(limits.assessment, 8, 60 * 60 * 1000, client);
      } catch (error) {
        if (error instanceof Error && error.message === "RATE_LIMITED") await client.query("COMMIT");
        throw error;
      }
    }

    // After 30 days the key may start a new submission. Retire only its retry
    // record, never the assessment/ticket. Do this after rate checks because
    // rejected attempts commit their counters but must retain the expired key.
    // Other creation failures roll this back. Concurrent deletes wait on the
    // expired row; the unique-key replay recovery below handles the winner.
    const expired = await client.query(
      `DELETE FROM instant_water_idempotency
       WHERE endpoint = 'create-instant-water-assessment' AND scope = $1
         AND idempotency_key = $2 AND expires_at <= now()
       RETURNING id`,
      [input.scope, input.idempotencyKey],
    );
    const id = randomUUID();
    const reference = `WT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const publicToken = input.customerUserId ? undefined : token();
    const publicTokenHash = publicToken ? hashSecret(publicToken) : null;
    const tokenExpires = publicToken ? new Date(Date.now() + PUBLIC_TOKEN_TTL_MS) : null;
    const accountState = input.customerUserId ? "attached" : "unverified_lead";
    const lifecycle = "instant_result_ready";
    const rowResult = redactInstantWaterResult(result, reference, input.country, lifecycle);
    const response: AssessmentResponse = {
      assessmentId: id,
      reference,
      ...(publicToken ? { resultToken: publicToken, resultTokenExpiresAt: tokenExpires! } : {}),
      result: rowResult,
    };
    await client.query(
      `INSERT INTO instant_water_assessments
       (id, reference, customer_user_id, first_name, normalized_phone,
        phone_verification_state, phone_verified_at, consent_given, consent_at,
        consent_version, country, area, source, concern, setting, raw_answers,
        rules_version, result, area_flags, source_attribution, lifecycle_status,
        account_link_state, physical_request_state, public_token_hash,
        public_token_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        id, reference, input.customerUserId ?? null, normalizedFirstName, normalizedPhone,
        input.customerUserId ? "verified" : "unverified",
        input.customerUserId ? new Date() : null, "result_and_follow_up",
        input.consentVersion, input.country.trim(), input.area.trim(), answers.source,
        answers.concern, answers.setting, answers, result.rulesVersion,
        result, result.areaFlags, input.sourceAttribution ?? {}, lifecycle, accountState,
        "not_requested", publicTokenHash, tokenExpires,
      ],
    );
    // This insert is in the same transaction as the assessment. There is no
    // separate "booking" operation that could duplicate this ticket later.
    await client.query(
      `INSERT INTO instant_water_check_tickets
       (id, assessment_id, customer_user_id, service_state, country, area)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [`IWT-${randomBytes(8).toString("hex")}`, id, input.customerUserId ?? null, lifecycle, input.country.trim(), input.area.trim()],
    );
    await client.query(
      `INSERT INTO instant_water_idempotency
       (id, endpoint, scope, idempotency_key, request_hash, assessment_id, response, expires_at)
       VALUES ($1,'create-instant-water-assessment',$2,$3,$4,$5,$6,now() + interval '30 days')`,
      [randomUUID(), input.scope, input.idempotencyKey, requestHash, id, response],
    );
    // The outbox/provider dedupe keys outlive the 30-day retry window. A
    // recycled key must not suppress delivery of this new assessment.
    const deliveryKey = `${input.scope}:${input.idempotencyKey}${expired.rows.length ? `:${id}` : ""}`;
    await enqueueLeadDelivery(client, {
      submissionId: deliveryKey,
      idempotencyKey: deliveryKey,
      firstName: normalizedFirstName,
      phone: normalizedPhone,
      country: input.country.trim(),
      area: input.area.trim(),
      source: answers.sources!.join(", "),
      concern: answers.concerns!.join(", "),
      setting: answers.settings!.join(", "),
      consent: "result_and_follow_up",
      consentVersion: input.consentVersion,
      sourceAttribution: input.sourceAttribution ?? {},
      assessmentId: id,
      reference,
    });
    await client.query("COMMIT");
    return { response, replay: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    // A concurrent request can win the unique idempotency key. Retry as a
    // replay rather than creating a second ticket.
    if ((error as { code?: string }).code === "23505") {
      const prior = await pool.query(
        `SELECT request_hash, response FROM instant_water_idempotency
         WHERE endpoint = 'create-instant-water-assessment' AND scope = $1
           AND idempotency_key = $2 AND expires_at > now()`,
        [input.scope, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (!compatibleHashes.has(prior.rows[0].request_hash)) throw new Error("IDEMPOTENCY_CONFLICT");
        return { response: prior.rows[0].response as AssessmentResponse, replay: true };
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getPublicAssessment(tokenValue: string, rateKey?: string): Promise<AssessmentResponse["result"] | null> {
  if (rateKey) await enforceDurableRateLimit(`result:${rateKey}`, 60, 60 * 1000);
  const hash = hashSecret(tokenValue);
  const result = await pool.query(
    `SELECT reference, result, country, lifecycle_status, physical_request_state,
            public_token_expires_at, public_token_revoked_at
       FROM instant_water_assessments
      WHERE public_token_hash = $1 AND public_token_expires_at > now()
        AND public_token_revoked_at IS NULL LIMIT 1`,
    [hash],
  );
  const row = result.rows[0] as AssessmentRow | undefined;
  if (!row) return null;
  return redactInstantWaterResult(row.result, row.reference, row.country, row.physical_request_state);
}

export async function requestVerification(input: {
  assessmentId: string;
  channel: "whatsapp" | "sms";
  smsConsent?: boolean;
  idempotencyKey: string;
  rateKey: string;
  deliver: (channel: "whatsapp" | "sms", phone: string, code: string, assessmentId: string) => Promise<void>;
}): Promise<{ channel: "whatsapp" | "sms" }> {
  if (input.channel === "sms" && input.smsConsent !== true) throw new Error("SMS_CONSENT_REQUIRED");
  const rowResult = await pool.query(
    `SELECT normalized_phone FROM instant_water_assessments WHERE id = $1 LIMIT 1`,
    [input.assessmentId],
  );
  const row = rowResult.rows[0] as { normalized_phone: string } | undefined;
  if (!row) throw new Error("NOT_FOUND");
  const requestHash = hashSecret(`${input.assessmentId}:${input.channel}:${input.smsConsent === true}`);
  const code = String(randomInt(100000, 1000000));
  const challengeId = randomUUID();
  let dispatchChallengeId: string = challengeId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prior = await client.query(
      `SELECT request_hash, response FROM instant_water_idempotency
        WHERE endpoint = 'request-instant-water-verification'
          AND scope = $1 AND idempotency_key = $2 AND expires_at > now()
        FOR UPDATE`,
      [input.assessmentId, input.idempotencyKey],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
      const stored = prior.rows[0].response as { channel?: "whatsapp" | "sms"; challengeId?: string } | null;
      dispatchChallengeId = stored?.challengeId ?? challengeId;
      await client.query("COMMIT");
      return await dispatchOtpChallenge(dispatchChallengeId, input, row.normalized_phone, stored?.channel ?? input.channel);
    }
    const requestLimits = instantOtpRateLimitKeys("request", input.rateKey, row.normalized_phone);
    try {
      await enforceDurableRateLimit(requestLimits.ip, 5, 60 * 60 * 1000, client);
      await enforceDurableRateLimit(requestLimits.phone, 5, 60 * 60 * 1000, client);
      await enforceDurableRateLimit(`otp-request-assessment:${input.assessmentId}`, 5, 60 * 60 * 1000, client);
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMITED") await client.query("COMMIT");
      throw error;
    }
    // After 30 days this key may request a new challenge, even for a changed
    // channel/consent payload. Retire only this endpoint/scope/key's expired
    // retry record, never its historical challenge. Rate-limit rejections
    // commit counters, so retirement must follow those checks. Any later
    // failure rolls it back; concurrent replacements are resolved by the
    // unique-key replay recovery below and the atomic delivery claim.
    await client.query(
      `DELETE FROM instant_water_idempotency
       WHERE endpoint = 'request-instant-water-verification'
         AND scope = $1 AND idempotency_key = $2 AND expires_at <= now()`,
      [input.assessmentId, input.idempotencyKey],
    );
    await client.query(
      `INSERT INTO instant_water_verification_challenges
        (id, assessment_id, channel, phone_hash, code_hash, code_ciphertext, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,now() + interval '10 minutes')`,
      [challengeId, input.assessmentId, input.channel, hashSecret(row.normalized_phone), hashSecret(`${challengeId}:${code}`), encryptOtpCode(code)],
    );
    await client.query(
      `INSERT INTO instant_water_idempotency
        (id, endpoint, scope, idempotency_key, request_hash, assessment_id, response, expires_at)
       VALUES ($1,'request-instant-water-verification',$2,$3,$4,$5,$6,now() + interval '30 days')`,
      [randomUUID(), input.assessmentId, input.idempotencyKey, requestHash, input.assessmentId, { channel: input.channel, challengeId }],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      const prior = await pool.query(
        `SELECT request_hash, response FROM instant_water_idempotency
          WHERE endpoint = 'request-instant-water-verification'
            AND scope = $1 AND idempotency_key = $2 AND expires_at > now()
          LIMIT 1`,
        [input.assessmentId, input.idempotencyKey],
      );
      if (prior.rows[0]?.request_hash === requestHash) {
        const stored = prior.rows[0].response as { channel?: "whatsapp" | "sms"; challengeId?: string };
        if (!stored.challengeId) return { channel: stored.channel ?? input.channel };
        return dispatchOtpChallenge(stored.challengeId, input, row.normalized_phone, stored.channel ?? input.channel);
      }
      if (prior.rows[0]) throw new Error("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  } finally {
    client.release();
  }
  return dispatchOtpChallenge(dispatchChallengeId, input, row.normalized_phone, input.channel);
}

async function dispatchOtpChallenge(
  challengeId: string,
  input: {
    assessmentId: string;
    deliver: (channel: "whatsapp" | "sms", phone: string, code: string, assessmentId: string) => Promise<void>;
  },
  phone: string,
  channel: "whatsapp" | "sms",
): Promise<{ channel: "whatsapp" | "sms" }> {
  const claimed = await pool.query(
    `UPDATE instant_water_verification_challenges
        SET delivery_status = 'sending', delivery_attempts = delivery_attempts + 1,
            delivery_claimed_at = now(), delivery_error_category = NULL
      WHERE id = $1 AND delivery_attempts < 3
        AND (delivery_status = 'pending'
          OR (delivery_status = 'failed' AND (delivery_next_retry_at IS NULL OR delivery_next_retry_at <= now()))
          OR (delivery_status = 'sending' AND delivery_claimed_at < now() - interval '5 minutes'))
      RETURNING code_ciphertext`,
    [challengeId],
  );
  if (!claimed.rowCount) {
    const current = await pool.query(
      `SELECT delivery_status FROM instant_water_verification_challenges WHERE id = $1`,
      [challengeId],
    );
    if (current.rows[0]?.delivery_status === "sent") return { channel };
    throw new Error("DELIVERY_IN_PROGRESS");
  }
  try {
    const code = decryptOtpCode(String(claimed.rows[0].code_ciphertext));
    await input.deliver(channel, phone, code, input.assessmentId);
    await pool.query(
      `UPDATE instant_water_verification_challenges
          SET delivery_status = 'sent', delivery_claimed_at = NULL, delivery_next_retry_at = NULL
        WHERE id = $1`,
      [challengeId],
    );
    return { channel };
  } catch {
    await pool.query(
      `UPDATE instant_water_verification_challenges
          SET delivery_status = 'failed', delivery_error_category = 'provider_unavailable',
              delivery_next_retry_at = now()
        WHERE id = $1`,
      [challengeId],
    );
    throw new Error("DELIVERY_RETRYABLE");
  }
}

export async function confirmVerification(assessmentId: string, code: string, rateKey: string): Promise<{
  actionToken: string;
  actionTokenExpiresAt: Date;
  accountLinkState: string;
  handoffToken?: string;
}> {
  const assessment = await pool.query(
    `SELECT normalized_phone FROM instant_water_assessments WHERE id = $1 LIMIT 1`,
    [assessmentId],
  );
  const phone = String(assessment.rows[0]?.normalized_phone ?? "");
  if (!phone) throw new Error("NOT_FOUND");
  const confirmationLimits = instantOtpRateLimitKeys("confirm", rateKey, phone);
  await enforceDurableRateLimit(confirmationLimits.ip, 5, 10 * 60 * 1000);
  await enforceDurableRateLimit(confirmationLimits.phone, 5, 10 * 60 * 1000);
  const client = await pool.connect();
  let invalidCode = false;
  try {
    await client.query("BEGIN");
    const challengeResult = await client.query(
      `SELECT id, code_hash, attempts, expires_at FROM instant_water_verification_challenges
       WHERE assessment_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [assessmentId],
    );
    const challenge = challengeResult.rows[0] as { id: string; code_hash: string; attempts: number; expires_at: Date } | undefined;
    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
      const failedLimits = instantOtpRateLimitKeys("failed-confirm", rateKey, phone);
      if (challenge) {
        await client.query(`UPDATE instant_water_verification_challenges SET attempts = attempts + 1 WHERE id = $1`, [challenge.id]);
      }
      try {
        await enforceDurableRateLimit(failedLimits.ip, 5, 10 * 60 * 1000, client);
        await enforceDurableRateLimit(failedLimits.phone, 5, 10 * 60 * 1000, client);
      } catch (error) {
        if (error instanceof Error && error.message === "RATE_LIMITED") await client.query("COMMIT");
        throw error;
      }
      await client.query("COMMIT");
      invalidCode = true;
    }
    if (!invalidCode && challenge && challenge.attempts >= MAX_OTP_ATTEMPTS) throw new Error("OTP_LOCKED");
    if (!invalidCode && challenge) {
      await client.query(`UPDATE instant_water_verification_challenges SET attempts = attempts + 1 WHERE id = $1`, [challenge.id]);
      const actualHash = Buffer.from(hashSecret(`${challenge.id}:${code}`), "hex");
      const storedHash = Buffer.from(challenge.code_hash, "hex");
      if (actualHash.length !== storedHash.length || !timingSafeEqual(actualHash, storedHash)) {
        const failedLimits = instantOtpRateLimitKeys("failed-confirm", rateKey, phone);
        try {
          await enforceDurableRateLimit(failedLimits.ip, 5, 10 * 60 * 1000, client);
          await enforceDurableRateLimit(failedLimits.phone, 5, 10 * 60 * 1000, client);
        } catch (error) {
          if (error instanceof Error && error.message === "RATE_LIMITED") await client.query("COMMIT");
          throw error;
        }
      await client.query("COMMIT");
        invalidCode = true;
      }
    }
    if (invalidCode) {
      // The challenge attempt and aggregate failed-confirm buckets are committed
      // before the public INVALID_CODE outcome is returned.
    } else {
    const validChallenge = challenge;
    if (!validChallenge) throw new Error("INVALID_CODE");
    const rowResult = await client.query(
      `SELECT normalized_phone, account_link_state, customer_user_id
         FROM instant_water_assessments WHERE id = $1 FOR UPDATE`,
      [assessmentId],
    );
    const row = rowResult.rows[0] as { normalized_phone: string; account_link_state: string; customer_user_id: string | null } | undefined;
    if (!row) throw new Error("NOT_FOUND");
    if (!canAttachInstantAssessment(row.account_link_state, row.customer_user_id)) {
      throw new Error("OWNERSHIP_CONFLICT");
    }
    const users = await client.query(
      `SELECT id FROM uc_users WHERE phone = $1 AND phone_verified = true AND deleted_at IS NULL LIMIT 2`,
      [row.normalized_phone],
    );
    const state = determineAccountLinkState(users.rows.length);
    const actionToken = token();
    const expiresAt = new Date(Date.now() + ACTION_TOKEN_TTL_MS);
    await client.query(`UPDATE instant_water_verification_challenges SET used_at = now() WHERE id = $1`, [validChallenge.id]);
    await client.query(
      `UPDATE instant_water_assessments
          SET phone_verification_state = 'verified', phone_verified_at = now(),
              account_link_state = $2, customer_user_id = CASE WHEN $2 = 'attached' THEN $3 ELSE customer_user_id END,
              public_token_revoked_at = CASE WHEN $2 = 'attached' THEN now() ELSE public_token_revoked_at END,
              updated_at = now()
         WHERE id = $1 AND account_link_state IN ('unverified_lead', 'verified_unmatched', 'ambiguous_match')
           AND customer_user_id IS NULL`,
      [assessmentId, state, state === "attached" ? String(users.rows[0].id) : null],
    );
    if (state === "attached") {
      await client.query(
        `UPDATE instant_water_check_tickets
            SET customer_user_id = $2, updated_at = now()
          WHERE assessment_id = $1 AND customer_user_id IS NULL`,
        [assessmentId, String(users.rows[0].id)],
      );
    }
    await client.query(
      `INSERT INTO instant_water_action_tokens (id, assessment_id, token_hash, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), assessmentId, hashSecret(actionToken), expiresAt],
    );
    let handoffToken: string | undefined;
    if (state === "verified_unmatched") {
      handoffToken = token();
      await client.query(
        `INSERT INTO instant_water_handoff_tokens (id, assessment_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '20 minutes')`,
        [randomUUID(), assessmentId, hashSecret(handoffToken)],
      );
    }
    await client.query("COMMIT");
    return { actionToken, actionTokenExpiresAt: expiresAt, accountLinkState: state, ...(handoffToken ? { handoffToken } : {}) };
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  throw new Error("INVALID_CODE");
}

async function actionAssessment(actionToken: string, assessmentId: string): Promise<AssessmentRow> {
  const result = await pool.query(
    `SELECT a.* FROM instant_water_assessments a
      JOIN instant_water_action_tokens t ON t.assessment_id = a.id
     WHERE a.id = $1 AND t.token_hash = $2 AND t.expires_at > now() AND t.used_at IS NULL`,
    [assessmentId, hashSecret(actionToken)],
  );
  const row = result.rows[0] as AssessmentRow | undefined;
  if (!row) throw new Error("ACTION_UNAUTHORIZED");
  return row;
}

export async function consumeInstantAssessmentHandoff(
  handoffToken: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  let assessmentId = "";
  try {
    await client.query("BEGIN");
    const handoffResult = await client.query(
      `SELECT h.id, h.expires_at, h.consumed_at, h.revoked_at,
              a.id AS assessment_id, a.normalized_phone, a.account_link_state, a.customer_user_id
         FROM instant_water_handoff_tokens h
         JOIN instant_water_assessments a ON a.id = h.assessment_id
        WHERE h.token_hash = $1
        FOR UPDATE OF h, a`,
      [hashSecret(handoffToken)],
    );
    const handoff = handoffResult.rows[0] as {
      id: string; expires_at: Date; consumed_at: Date | null; revoked_at: Date | null;
      assessment_id: string; normalized_phone: string; account_link_state: string; customer_user_id: string | null;
    } | undefined;
    assessmentId = handoff?.assessment_id ?? "";
    if (!handoff || handoff.consumed_at || handoff.revoked_at ||
        new Date(handoff.expires_at).getTime() <= Date.now() ||
        handoff.account_link_state !== "verified_unmatched" || handoff.customer_user_id) {
      throw new Error("HANDOFF_INVALID");
    }
    const userResult = await client.query(
      `SELECT id, phone, phone_verified
         FROM uc_users
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
        FOR SHARE`,
      [userId],
    );
    const user = userResult.rows[0] as { id: string; phone: string | null; phone_verified: boolean } | undefined;
    const userPhone = user?.phone ? normalizeInstantPhone(user.phone) : null;
    const expectedHash = hashSecret(handoff.normalized_phone);
    const actualHash = userPhone ? hashSecret(userPhone) : "";
    const samePhone = Boolean(user?.phone_verified && userPhone &&
      actualHash.length === expectedHash.length &&
      timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash)));
    if (!user || !samePhone) throw new Error("HANDOFF_INVALID");

    const assessmentUpdate = await client.query(
      `UPDATE instant_water_assessments
          SET customer_user_id = $2, account_link_state = 'attached',
              public_token_revoked_at = now(), updated_at = now()
        WHERE id = $1 AND customer_user_id IS NULL AND account_link_state = 'verified_unmatched'`,
      [handoff.assessment_id, userId],
    );
    if (assessmentUpdate.rowCount !== 1) throw new Error("HANDOFF_INVALID");
    const ticketUpdate = await client.query(
      `UPDATE instant_water_check_tickets
          SET customer_user_id = $2, updated_at = now()
        WHERE assessment_id = $1 AND customer_user_id IS NULL`,
      [handoff.assessment_id, userId],
    );
    if (ticketUpdate.rowCount !== 1) throw new Error("HANDOFF_INVALID");
    await client.query(
      `UPDATE instant_water_handoff_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
      [handoff.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const assessment = await getOwnedAssessment(assessmentId, userId);
  if (!assessment) throw new Error("HANDOFF_INVALID");
  return assessment;
}

export async function authorizeInstantActionUpload(actionToken: string, assessmentId: string): Promise<void> {
  await actionAssessment(actionToken, assessmentId);
}

export async function attachAssessment(assessmentId: string, actionToken: string | undefined, resultToken: string | undefined, userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let row: AssessmentRow;
    if (actionToken) {
      const result = await client.query(
        `SELECT a.* FROM instant_water_assessments a
           JOIN instant_water_action_tokens t ON t.assessment_id = a.id
          WHERE a.id = $1 AND t.token_hash = $2 AND t.expires_at > now() AND t.used_at IS NULL
          FOR UPDATE OF a`,
        [assessmentId, hashSecret(actionToken)],
      );
      row = result.rows[0] as AssessmentRow;
    } else if (resultToken) {
      const result = await client.query(
        `SELECT * FROM instant_water_assessments
          WHERE id = $1 AND public_token_hash = $2 AND public_token_expires_at > now()
            AND public_token_revoked_at IS NULL FOR UPDATE`,
        [assessmentId, hashSecret(resultToken)],
      );
      row = result.rows[0] as AssessmentRow;
    } else {
      throw new Error("ACTION_UNAUTHORIZED");
    }
    if (!row) throw new Error("ACTION_UNAUTHORIZED");
    if (!canAttachInstantAssessment(row.account_link_state, row.customer_user_id)) {
      throw new Error("OWNERSHIP_CONFLICT");
    }
    const user = await client.query(
      `SELECT id, phone, phone_verified FROM uc_users WHERE id::text = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    const account = user.rows[0] as { id: string; phone: string; phone_verified: boolean } | undefined;
    if (!account || !account.phone_verified || normalizeInstantPhone(account.phone) !== row.normalized_phone) {
      throw new Error("ACTION_UNAUTHORIZED");
    }
    const updated = await client.query(
      `UPDATE instant_water_assessments
          SET customer_user_id = $2, account_link_state = 'attached',
              public_token_revoked_at = now(), updated_at = now()
        WHERE id = $1 AND account_link_state IN ('unverified_lead', 'verified_unmatched', 'ambiguous_match')
          AND customer_user_id IS NULL
        RETURNING id`,
      [assessmentId, userId],
    );
    if (!updated.rowCount) throw new Error("OWNERSHIP_CONFLICT");
    await client.query(
      `UPDATE instant_water_check_tickets
          SET customer_user_id = $2, updated_at = now()
        WHERE assessment_id = $1 AND customer_user_id IS NULL`,
      [assessmentId, userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function requestPhysicalTest(input: {
  assessmentId: string;
  actionToken?: string;
  userId?: string;
  serviceAddress: string;
  preferredContactTime: string;
  acknowledgement: boolean;
  mediaReferences?: Array<{ reference: string; mediaType: string }>;
  idempotencyKey: string;
  promoCode?: string;
}): Promise<{ assessmentId: string; reference: string; serviceState: string; ticketId: string; freeWaterTest?: boolean; promoCode?: string }> {
  if (!input.acknowledgement) throw new Error("ACKNOWLEDGEMENT_REQUIRED");
  const media = input.mediaReferences ?? [];
  if (media.length > 7) throw new Error("MEDIA_LIMIT");
  if (media.some((item) =>
    typeof item.reference !== "string" ||
    item.reference.length === 0 ||
    item.reference.length > 300 ||
    /^data:|^https?:\/\//i.test(item.reference)
  )) throw new Error("INVALID_MEDIA_REFERENCE");
  const imageCount = media.filter((item) => ["jpg", "png", "webp"].includes(item.mediaType)).length;
  const videoCount = media.filter((item) => ["mp4", "mov", "webm"].includes(item.mediaType)).length;
  if (imageCount > 5 || videoCount > 2 || imageCount + videoCount !== media.length) {
    throw new Error("MEDIA_LIMIT");
  }
  let row: AssessmentRow;
  if (input.actionToken) row = await actionAssessment(input.actionToken, input.assessmentId);
  else if (input.userId) {
    const result = await pool.query(
      `SELECT * FROM instant_water_assessments WHERE id = $1 AND customer_user_id = $2 LIMIT 1`,
      [input.assessmentId, input.userId],
    );
    row = result.rows[0] as AssessmentRow;
    if (!row) throw new Error("NOT_FOUND");
  } else throw new Error("ACTION_UNAUTHORIZED");
  const serviceState = physicalServiceState(row.country);
  const requestHash = hashSecret(stablePayload({
    assessmentId: input.assessmentId,
    userId: input.userId ?? null,
    serviceAddress: input.serviceAddress.trim(),
    preferredContactTime: input.preferredContactTime.trim(),
    acknowledgement: input.acknowledgement,
    mediaReferences: media,
    ...(input.promoCode?.trim() ? { promoCode: input.promoCode.trim().toUpperCase() } : {}),
  }));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`physical-test:${input.assessmentId}`]);
    const prior = await client.query(
      `SELECT id, request_hash, response, expires_at > now() AS active FROM instant_water_idempotency
        WHERE endpoint = 'request-instant-water-physical-test'
          AND scope = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [input.assessmentId, input.idempotencyKey],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
      if (prior.rows[0].active) {
        await client.query("COMMIT");
        return prior.rows[0].response as { assessmentId: string; reference: string; serviceState: string; ticketId: string };
      }
    }
    const ticket = await client.query(
      `SELECT id, service_state, physical_request_acknowledged_at, free_water_test, promo_code FROM instant_water_check_tickets WHERE assessment_id = $1 FOR UPDATE`,
      [input.assessmentId],
    );
    if (!ticket.rows[0]) throw new Error("NOT_FOUND");
    if (prior.rows[0]) {
      // Unlike assessment creation, this key identifies an action on an existing
      // ticket. Expiry never authorizes a second action or overwriting service
      // details. Renew identical retries with the current state, even if staff
      // have scheduled, completed, or closed the ticket in the meantime.
      const response = {
        assessmentId: input.assessmentId,
        reference: row.reference,
        serviceState: String(ticket.rows[0].service_state),
        ticketId: String(ticket.rows[0].id),
        freeWaterTest: ticket.rows[0].free_water_test,
        promoCode: ticket.rows[0].promo_code ?? "",
      };
      await client.query(
        `UPDATE instant_water_idempotency
            SET response = $2::jsonb, expires_at = now() + interval '30 days'
          WHERE id = $1`,
        [prior.rows[0].id, JSON.stringify(response)],
      );
      await client.query("COMMIT");
      return response;
    }
    if (ticket.rows[0].service_state !== "instant_result_ready" && ticket.rows[0].service_state !== "follow_up_requested" && ticket.rows[0].service_state !== serviceState) {
      throw new Error("CONFLICT");
    }
    if (ticket.rows[0].physical_request_acknowledged_at) throw new Error("CONFLICT");
    const mediaPaths = await verifyInstantMediaReferences(input.assessmentId, input.userId, media);
    const ticketId = String(ticket.rows[0].id);
    const promoCode = input.promoCode?.trim().toUpperCase() ?? "";
    if (promoCode) {
      const customerId = Number(input.userId ?? row.customer_user_id);
      if (!Number.isInteger(customerId) || customerId <= 0) throw Object.assign(new Error("Sign in to apply a free water test code"), { code: "INVALID_PROMOTION" });
      if (serviceState !== "physical_test_requested") throw Object.assign(new Error("Physical tests are not available in this country"), { code: "INVALID_PROMOTION" });
      const promotion = await quotePromotion(promoCode, "water_test", [], 0, undefined, customerId);
      if (!promotion) throw Object.assign(new Error("Water test code is inactive, expired, exhausted, or ineligible"), { code: "INVALID_PROMOTION" });
      await consumePromotionOnClient(client, { quote: promotion, userId: customerId, operation: "water_test",
        actor: `customer:${customerId}`, idempotencyKey: `physical-test:${input.assessmentId}`, operationRef: ticketId });
    }
    await client.query(
      `UPDATE instant_water_check_tickets
          SET service_state = $2, service_address = $3, preferred_contact_time = $4,
              physical_request_acknowledged_at = now(), media_references = $5::jsonb, updated_at = now()
              , promo_code = $6, free_water_test = $7
        WHERE assessment_id = $1`,
      [input.assessmentId, serviceState, input.serviceAddress.trim(), input.preferredContactTime.trim(), JSON.stringify(media), promoCode || null, !!promoCode],
    );
    if (mediaPaths.length) {
      await client.query(
        `UPDATE instant_water_media_uploads
            SET consumed_at = now()
          WHERE object_path = ANY($1::text[]) AND consumed_at IS NULL`,
        [mediaPaths],
      );
    }
    await client.query(
      `UPDATE instant_water_assessments
          SET lifecycle_status = $2, physical_request_state = $2, updated_at = now()
        WHERE id = $1`,
      [input.assessmentId, serviceState],
    );
    const response = { assessmentId: input.assessmentId, reference: row.reference, serviceState, ticketId, freeWaterTest: !!promoCode, promoCode };
    await client.query(
      `INSERT INTO instant_water_idempotency
       (id, endpoint, scope, idempotency_key, request_hash, assessment_id, response, expires_at)
       VALUES ($1,'request-instant-water-physical-test',$2,$3,$4,$5,$6,now() + interval '30 days')`,
      [randomUUID(), input.assessmentId, input.idempotencyKey, requestHash, input.assessmentId, response],
    );
    await client.query("COMMIT");
    if (serviceState === "physical_test_requested") {
      void notifyPhysicalTest({ ticketId, userId: input.userId ?? row.customer_user_id ?? undefined,
        firstName: row.first_name, phone: row.normalized_phone, address: input.serviceAddress.trim(),
        source: row.source, concerns: row.concern, freeWaterTest: !!promoCode, promoCode }).catch(() => {});
    }
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      const prior = await pool.query(
        `SELECT request_hash, response FROM instant_water_idempotency
          WHERE endpoint = 'request-instant-water-physical-test'
            AND scope = $1 AND idempotency_key = $2 AND expires_at > now()
          LIMIT 1`,
        [input.assessmentId, input.idempotencyKey],
      );
      if (prior.rows[0]?.request_hash === requestHash) {
        return prior.rows[0].response as { assessmentId: string; reference: string; serviceState: string; ticketId: string };
      }
      if (prior.rows[0]) throw new Error("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listOwnedAssessments(userId: string): Promise<Array<{
  assessmentId: string;
  reference: string;
  bands: InstantWaterCheckResult["bands"];
  accountLinkState: string;
  serviceState: string;
  createdAt: Date;
  answers: InstantWaterCheckAnswers;
  freeWaterTest: boolean;
  promoCode: string;
}>> {
  const result = await pool.query(
    `SELECT id, reference, result, raw_answers, country, area, source, concern, setting, account_link_state, physical_request_state, created_at,
       COALESCE((SELECT free_water_test FROM instant_water_check_tickets WHERE assessment_id=a.id),false) AS free_water_test,
       (SELECT promo_code FROM instant_water_check_tickets WHERE assessment_id=a.id) AS promo_code
       FROM instant_water_assessments a
      WHERE customer_user_id = $1 AND account_link_state = 'attached'
      ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    assessmentId: row.id,
    reference: row.reference,
    bands: (row.result as InstantWaterCheckResult).bands,
    answers: storedWaterAnswers(row),
    accountLinkState: row.account_link_state,
    serviceState: row.physical_request_state,
    freeWaterTest: row.free_water_test,
    promoCode: row.promo_code ?? "",
    createdAt: row.created_at,
  }));
}

export async function getOwnedAssessment(assessmentId: string, userId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT id, reference, result, raw_answers, country, area, source, concern, setting, physical_request_state, created_at
       FROM instant_water_assessments
      WHERE id = $1 AND customer_user_id = $2 AND account_link_state = 'attached'
      LIMIT 1`,
    [assessmentId, userId],
  );
  const row = result.rows[0] as {
    id: string; reference: string; result: InstantWaterCheckResult; raw_answers: InstantWaterCheckAnswers; country: string; area: string; source: string; concern: string; setting: string;
    physical_request_state: string; created_at: Date;
  } | undefined;
  if (!row) return null;
  return {
    assessmentId: row.id,
    reference: row.reference,
    bands: row.result.bands,
    answers: storedWaterAnswers(row),
    accountLinkState: "attached",
    serviceState: row.physical_request_state,
    createdAt: row.created_at,
  };
}

export async function latestOwnedAssessmentSummary(userId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT reference, result, raw_answers, country, area, source, concern, setting, physical_request_state, created_at
       FROM instant_water_assessments
      WHERE customer_user_id = $1 AND account_link_state = 'attached'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const row = result.rows[0] as {
    reference: string; result: InstantWaterCheckResult; raw_answers: InstantWaterCheckAnswers; country: string; area: string; source: string; concern: string; setting: string;
    physical_request_state: string; created_at: Date;
  } | undefined;
  if (!row) return null;
  return {
    reference: row.reference,
    createdAt: row.created_at,
    source: row.source,
    answers: storedWaterAnswers(row),
    bands: row.result.bands,
    areaFlag: row.result.areaFlags.riftValleyFluoride ? "rift_valley_fluoride" : row.result.areaFlags.hardGroundwater ? "hard_groundwater" : "none",
    recommendation: row.result.recommendation,
    serviceState: row.physical_request_state,
    disclaimer: row.result.disclaimer,
    // Area is only returned to the authenticated owner and never public token.
    area: row.area,
    country: row.country,
  };
}

export function buildInstantAssessmentAiContext(assessment: Record<string, unknown>): string {
  return JSON.stringify({
    reference: assessment.reference,
    createdAt: assessment.createdAt,
    source: assessment.source,
    answers: assessment.answers,
    area: assessment.area,
    bands: assessment.bands,
    areaFlag: assessment.areaFlag,
    recommendation: assessment.recommendation,
    serviceState: assessment.serviceState,
  });
}

export async function getAdminAssessment(assessmentId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT a.*, t.id AS ticket_id, t.service_state, t.service_address,
            t.preferred_contact_time, t.media_references, t.promo_code, t.free_water_test,
            GREATEST(a.updated_at, COALESCE(t.updated_at, a.updated_at)) AS concurrency_updated_at
       FROM instant_water_assessments a
       LEFT JOIN instant_water_check_tickets t ON t.assessment_id = a.id
      WHERE a.id = $1 LIMIT 1`,
    [assessmentId],
  );
  const row = result.rows[0] as AssessmentRow & Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    assessmentId: row.id,
    reference: row.reference,
    firstName: row.first_name,
    phone: row.normalized_phone,
    maskedPhone: maskPhone(row.normalized_phone),
    country: row.country,
    area: row.area,
    source: row.source,
    concern: row.concern,
    answers: storedWaterAnswers(row),
    bands: row.result.bands,
    serviceState: row.service_state ?? row.physical_request_state,
    accountLinkState: row.account_link_state,
    createdAt: row.created_at,
    updatedAt: (row as Record<string, unknown>).concurrency_updated_at,
    consentVersion: (row as Record<string, unknown>).consent_version,
    sourceAttribution: row.source_attribution,
    serviceAddress: row.service_address,
    promoCode: row.promo_code,
    freeWaterTest: row.free_water_test,
    preferredContactTime: row.preferred_contact_time,
    mediaReferences: projectHubMediaReferences(assessmentId, row.media_references),
  };
}

export async function recordInstantAudit(
  assessmentId: string,
  actorTeamUserId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO instant_water_audit_events (id, assessment_id, actor_team_user_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [randomUUID(), assessmentId, actorTeamUserId, action, JSON.stringify(metadata)],
  );
}

export function buildAdminAssessmentFilter(status?: string, customerId?: number): { where: string; args: unknown[] } {
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (status) {
    args.push(status);
    conditions.push(`a.lifecycle_status = $${args.length}`);
  }
  if (customerId !== undefined) {
    args.push(customerId);
    conditions.push(`a.customer_user_id = $${args.length}`);
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    args,
  };
}

export async function listAdminAssessments(page: number, limit: number, status?: string, customerId?: number): Promise<{ items: Record<string, unknown>[]; page: number; limit: number; total: number }> {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const filter = buildAdminAssessmentFilter(status, customerId);
  const args = [...filter.args];
  const offset = (safePage - 1) * safeLimit;
  args.push(safeLimit, offset);
  const rows = await pool.query(
    `SELECT a.id, a.reference, a.first_name, a.normalized_phone, a.country, a.area,
            a.source, a.concern, a.result, a.lifecycle_status, a.account_link_state,
            a.created_at,
            GREATEST(a.updated_at, COALESCE(t.updated_at, a.updated_at)) AS updated_at,
            COALESCE(t.service_state, a.physical_request_state) AS service_state
       FROM instant_water_assessments a
       LEFT JOIN instant_water_check_tickets t ON t.assessment_id = a.id
       ${filter.where} ORDER BY a.created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  const count = await pool.query(`SELECT count(*)::int AS total FROM instant_water_assessments a ${filter.where}`, filter.args);
  return {
    items: rows.rows.map((row) => ({
      assessmentId: row.id,
      reference: row.reference,
      firstName: row.first_name,
      maskedPhone: maskPhone(row.normalized_phone),
      country: row.country,
      area: row.area,
      source: row.source,
      concern: row.concern,
      bands: (row.result as InstantWaterCheckResult).bands,
      serviceState: row.service_state,
      accountLinkState: row.account_link_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    page: safePage,
    limit: safeLimit,
    total: count.rows[0]?.total ?? 0,
  };
}

export async function updateAdminAssessment(assessmentId: string, input: {
  serviceState: string;
  expectedUpdatedAt?: string | Date;
  internalNote?: string;
}): Promise<Record<string, unknown> | null> {
  if (!input.expectedUpdatedAt) throw new Error("EXPECTED_UPDATED_AT_REQUIRED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT a.updated_at AS assessment_updated_at,
              t.updated_at AS ticket_updated_at,
              GREATEST(a.updated_at, COALESCE(t.updated_at, a.updated_at)) AS concurrency_updated_at,
              COALESCE(t.service_state, a.physical_request_state) AS service_state
         FROM instant_water_assessments a
         JOIN instant_water_check_tickets t ON t.assessment_id = a.id
        WHERE a.id = $1
          AND date_trunc('milliseconds', GREATEST(a.updated_at, COALESCE(t.updated_at, a.updated_at))) =
              date_trunc('milliseconds', $2::timestamptz)
        FOR UPDATE OF a, t`,
      [assessmentId, input.expectedUpdatedAt instanceof Date ? input.expectedUpdatedAt.toISOString() : input.expectedUpdatedAt],
    );
    if (!currentResult.rows[0]) {
      const exists = await client.query(
        `SELECT 1 FROM instant_water_assessments WHERE id = $1 LIMIT 1`,
        [assessmentId],
      );
      throw new Error(exists.rows[0] ? "CONFLICT" : "NOT_FOUND");
    }
    const currentState = String(currentResult.rows[0].service_state);
    const allowedTransitions: Record<string, string[]> = {
      instant_result_ready: ["instant_result_ready", "follow_up_requested", "physical_test_requested", "closed"],
      follow_up_requested: ["follow_up_requested", "physical_test_requested", "scheduled", "closed"],
      physical_test_requested: ["physical_test_requested", "scheduled", "closed"],
      scheduled: ["scheduled", "completed", "closed"],
      completed: ["completed", "closed"],
      closed: ["closed"],
    };
    if (!allowedTransitions[currentState]?.includes(input.serviceState)) throw new Error("INVALID_STATE_TRANSITION");
    const result = await client.query(
      `UPDATE instant_water_assessments
          SET lifecycle_status = $2, physical_request_state = $2, updated_at = date_trunc('milliseconds', now())
        WHERE id = $1`,
      [assessmentId, input.serviceState],
    );
    if (!result.rowCount) throw new Error("CONFLICT");
    await client.query(
      `UPDATE instant_water_check_tickets
          SET service_state = $2, internal_notes = COALESCE($3, internal_notes), updated_at = date_trunc('milliseconds', now())
        WHERE assessment_id = $1`,
      [assessmentId, input.serviceState, input.internalNote ?? null],
    );
    await client.query("COMMIT");
    return getAdminAssessment(assessmentId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}