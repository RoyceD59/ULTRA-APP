import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Pending (not yet finalised) library upload slots issued by the server.
 *
 * Flow:
 *   1. POST /api/library/request-upload  → server generates the GCS path,
 *      writes a row here, returns { uploadId, uploadURL }.
 *   2. Client PUTs the file to uploadURL.
 *   3. POST /api/library/docs { uploadId, title, … }  → server looks up this
 *      row, verifies ownership and that the object now exists in GCS with the
 *      expected size/type, then promotes the record to team_library_docs.
 *
 * `consumed` is flipped to true once step 3 completes so the same slot
 * cannot be reused to register a second document.
 */
export const teamLibraryPendingUploadsTable = pgTable("team_library_pending_uploads", {
  id:           text("id").primaryKey(),           // UUID returned to client as uploadId
  objectPath:   text("object_path").notNull(),     // server-generated normalised GCS path
  uploadedBy:   text("uploaded_by").notNull(),     // member email — ownership anchor
  consumed:     boolean("consumed").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:    timestamp("expires_at", { withTimezone: true }).notNull(),
  // Declared intent from the request-upload call (used for validation in step 3).
  declaredSize: integer("declared_size").notNull(),
  declaredType: text("declared_type").notNull(),
});

export type TeamLibraryPendingUpload =
  typeof teamLibraryPendingUploadsTable.$inferSelect;
