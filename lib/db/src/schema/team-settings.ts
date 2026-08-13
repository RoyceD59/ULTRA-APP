import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const teamSettingsTable = pgTable("team_settings", {
  id: text("id").primaryKey().$defaultFn(() => "singleton"),
  passcodeHash: text("passcode_hash"),
  /**
   * AES-256-GCM encrypted M-Pesa webhook secret.
   * Format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>" (set by encryptSecret / decryptSecret).
   * When set, the callback handler uses this instead of the MPESA_WEBHOOK_SECRET env var,
   * so the team can rotate it from the admin panel without a server restart.
   */
  mpesaWebhookSecretEnc: text("mpesa_webhook_secret_enc"),
  /**
   * Team alert phone number for SMS fallback on recovery-order alerts.
   * Stored in plain text (E.164 / Kenyan local format accepted).
   * Supersedes the TEAM_ALERT_PHONE env var when present.
   */
  teamAlertPhone: text("team_alert_phone"),
  /**
   * How many days to keep successful notification log entries before the nightly pruning job
   * removes them. Falls back to UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS env var (default 30).
   */
  notificationLogSuccessRetentionDays: integer("notification_log_success_retention_days"),
  /**
   * How many days to keep failed notification log entries. Failed rows are kept longer so the
   * team has time to investigate and retry. Falls back to
   * UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS env var (default 90).
   */
  notificationLogFailureRetentionDays: integer("notification_log_failure_retention_days"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TeamSettings = typeof teamSettingsTable.$inferSelect;
