import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores the configured Google Sheets connection for the contacts sync feature.
 * Only one row is expected (the "active" connection), but the table supports
 * multiple rows so a history of connections can be kept.
 */
export const sheetSyncsTable = pgTable("sheet_syncs", {
  id: serial("id").primaryKey(),
  sheetUrl: text("sheet_url").notNull(),
  sheetLabel: text("sheet_label").notNull().default(""),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SheetSync = typeof sheetSyncsTable.$inferSelect;
