import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * History of every report push to the Ultra Clear AI orchestrator — manual
 * ("Push to Orchestrator" button) and scheduled (daily 08:00 UTC job).
 *
 * The row id (UUID) is included in the outbound payload as `pushId`; the
 * orchestrator references it when calling back the HMAC-secured echo endpoint
 * (POST /api/ai/echo) with a delivery/processing status update.
 *
 * Status lifecycle:
 *   outbound result → "sent" (delivered), "failed" (send error),
 *                     "not_configured" (no webhook URL set — recorded so the
 *                     team can see the push was attempted)
 *   echo updates    → "received" | "processing" | "completed" | "failed"
 *                     (lastEchoAt set — distinguishes an orchestrator-reported
 *                     failure from an outbound send failure)
 */
export const aiPushEventsTable = pgTable("ai_push_events", {
  id:              uuid("id").primaryKey().defaultRandom(),
  /** Payload `type` field: project_status_report | daily_project_status_report */
  payloadType:     text("payload_type").notNull(),
  /** What initiated the push: manual | scheduled */
  trigger:         text("trigger").notNull(),
  /** Webhook URL the push targeted, or "(not configured)". */
  target:          text("target").notNull().default(""),
  sentAt:          timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  /** Whether the outbound HTTP delivery succeeded. */
  outboundOk:      boolean("outbound_ok").notNull().default(false),
  /** Human-readable outbound result (HTTP status or error message). */
  outboundMessage: text("outbound_message").notNull().default(""),
  /** Current status — see lifecycle above. */
  status:          text("status").notNull().default("pending"),
  /** Latest orchestrator message (or outbound error detail). */
  statusDetail:    text("status_detail").notNull().default(""),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set on every accepted echo callback; null until the orchestrator responds. */
  lastEchoAt:      timestamp("last_echo_at", { withTimezone: true }),
});

export const insertAiPushEventSchema = createInsertSchema(aiPushEventsTable).omit({ id: true });
export type InsertAiPushEvent = z.infer<typeof insertAiPushEventSchema>;
export type AiPushEvent = typeof aiPushEventsTable.$inferSelect;
