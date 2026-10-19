import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

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
   * Team alert email address for account-deletion and recovery-order alerts.
   * Supersedes the TEAM_ALERT_EMAIL env var when present.
   * Falls back to info@ucfilters.com when neither is set.
   */
  teamAlertEmail: text("team_alert_email"),
  /**
   * Failed referral settlement attempts required before the team is alerted.
   * Falls back to REFERRAL_FAILURE_ALERT_THRESHOLD (default 3) when null.
   */
  referralFailureAlertThreshold: integer("referral_failure_alert_threshold"),
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
  /**
   * AES-256-GCM encrypted n8n webhook URL for inventory-sync automation.
   * Format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>" (same as mpesaWebhookSecretEnc).
   * Encrypted because webhook URLs often embed bearer-style path tokens.
   * Admins paste the URL via Admin → Integrations; it is encrypted before storage.
   */
  n8nInventoryWebhookUrlEnc: text("n8n_inventory_webhook_url_enc"),
  /**
   * Low-stock alert threshold (units). When a product's WooCommerce stock_quantity
   * falls to this value or below (including 0 = out of stock), the system sends an
   * email alert to the team. Defaults to 5 when null.
   */
  lowStockThreshold: integer("low_stock_threshold"),
  /**
   * Number of customers waiting for a product before the team receives a
   * restock-demand alert. Defaults to 5 when null.
   */
  restockDemandThreshold: integer("restock_demand_threshold"),
  /** Persistent, admin-controlled preview switch. Off unless deliberately enabled. */
  careOverviewPreview: boolean("care_overview_preview").notNull().default(false),
  /** Persistent, admin-controlled governance preview switch. Does not authorize refill operations. */
  refillGovernancePreview: boolean("refill_governance_preview").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TeamSettings = typeof teamSettingsTable.$inferSelect;
