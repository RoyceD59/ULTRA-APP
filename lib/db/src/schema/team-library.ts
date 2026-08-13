import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Library documents uploaded by the ProjectHub team.
 * Files are stored in GCS via the object storage service;
 * this table holds the metadata and the normalized GCS path.
 */
export const teamLibraryDocsTable = pgTable("team_library_docs", {
  id:         text("id").primaryKey(),          // UUID
  title:      text("title").notNull(),
  fileName:   text("file_name").notNull(),
  fileSize:   integer("file_size").notNull(),   // bytes
  fileType:   text("file_type").notNull(),      // MIME type
  objectPath: text("object_path").notNull(),    // normalized GCS path e.g. /objects/<uuid>
  uploadedBy: text("uploaded_by").notNull(),    // member email
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TeamLibraryDoc = typeof teamLibraryDocsTable.$inferSelect;
