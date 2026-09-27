import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const teamUsersTable = pgTable("team_users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  isActive: boolean("is_active").notNull().default(true),
  /** Page-level permissions for members. null = no access to anything. Admin role ignores this. */
  permissions: jsonb("permissions").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TeamUser = typeof teamUsersTable.$inferSelect;
export type TeamUserPublic = Pick<TeamUser, "id" | "email" | "name" | "role" | "isActive" | "permissions" | "createdAt">;
