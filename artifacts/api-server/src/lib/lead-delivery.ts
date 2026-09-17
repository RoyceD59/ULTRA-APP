import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";

export type LeadDeliveryPayload = {
  submissionId: string;
  idempotencyKey: string;
  firstName: string;
  phone: string;
  country: string;
  area: string;
  source: string;
  concern: string;
  setting: string;
  consent: string;
  consentVersion: string;
  sourceAttribution?: Record<string, string | undefined>;
  assessmentId: string;
  reference?: string;
};

export function leadDeliveryConfigured(): boolean {
  return Boolean(process.env.GOOGLE_LEAD_APPS_SCRIPT_URL?.startsWith("https://"));
}

/** Fields approved for secondary delivery; primary records retain the rest. */
export function approvedLeadDeliveryPayload(payload: LeadDeliveryPayload): Omit<LeadDeliveryPayload, "assessmentId" | "reference" | "sourceAttribution"> {
  const { assessmentId: _assessmentId, reference: _reference, sourceAttribution: _sourceAttribution, ...approved } = payload;
  return approved;
}

export async function enqueueLeadDelivery(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  payload: LeadDeliveryPayload,
): Promise<void> {
  if (!leadDeliveryConfigured()) return;
  await client.query(
    `INSERT INTO instant_water_lead_outbox
      (id, assessment_id, idempotency_key, submission_id, payload)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [randomUUID(), payload.assessmentId, payload.idempotencyKey, payload.submissionId, payload],
  );
}

export async function processLeadDeliveryOutbox(limit = 25): Promise<number> {
  if (!leadDeliveryConfigured()) return 0;
  const claimed = await pool.query(
    `WITH picked AS (
       SELECT id FROM instant_water_lead_outbox
         WHERE (status='pending' AND next_attempt_at <= now())
            OR (status='processing' AND claimed_at < now() - interval '1 minute')
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED LIMIT $1
     )
     UPDATE instant_water_lead_outbox o
         SET status='processing', attempts=attempts+1, claimed_at=now(),
             claim_token=encode(gen_random_bytes(24),'hex'), updated_at=now()
       FROM picked WHERE o.id=picked.id
     RETURNING o.id,o.payload,o.claim_token`,
    [Math.max(1, Math.min(limit, 100))],
  );
  let processed = 0;
  for (const row of claimed.rows as Array<{ id: string; payload: LeadDeliveryPayload; claim_token: string }>) {
    try {
      if (!row.payload) throw new Error("outbox_payload_missing");
      const approvedPayload = approvedLeadDeliveryPayload(row.payload);
      const response = await fetch(process.env.GOOGLE_LEAD_APPS_SCRIPT_URL!, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ schemaVersion: 1, ...approvedPayload }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const result = (await response.json().catch(() => ({}))) as { status?: string };
      if (result.status !== "ok" && result.status !== "duplicate") throw new Error("provider_rejected");
      await pool.query(
        `UPDATE instant_water_lead_outbox
            SET status='delivered', delivered_at=now(), provider_ack=$2, last_error=NULL,
                payload='{}'::jsonb, claimed_at=NULL, claim_token=NULL, updated_at=now()
          WHERE id=$1 AND claim_token=$3`,
        [row.id, result.status, row.claim_token],
      );
      processed++;
    } catch (error) {
      await pool.query(
        `UPDATE instant_water_lead_outbox
            SET status=CASE WHEN attempts >= 8 THEN 'review' ELSE 'pending' END,
                last_error=$2, next_attempt_at=now() + LEAST(interval '6 hours', interval '15 seconds' * power(2, LEAST(attempts, 8))),
                claimed_at=NULL, claim_token=NULL, updated_at=now()
          WHERE id=$1 AND claim_token=$3`,
        [row.id, String(error).slice(0, 500), row.claim_token],
      );
      logger.warn({ err: error, outboxId: row.id }, "Lead delivery attempt failed");
    }
  }
  return processed;
}