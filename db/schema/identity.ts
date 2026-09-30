import { boolean, check, index, inet, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, softDelete, timestamps } from "./_common";
import { orgType, permissionScope } from "./enums";

export const organizations = pgTable("organizations", {
  id: id(),
  type: orgType("type").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
  ...softDelete,
}, (t) => [index("organizations_type_idx").on(t.type)]);

export const roles = pgTable("roles", {
  id: id(),
  key: varchar("key", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  // Which organization type this role may be assigned within.
  orgType: orgType("org_type"),
  description: text("description"),
  ...timestamps,
});

export const permissions = pgTable("permissions", {
  id: id(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  description: text("description"),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  scope: permissionScope("scope").notNull(),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);

export const users = pgTable("users", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  email: varchar("email", { length: 320 }).notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // Bumped on password change / admin revoke to invalidate all sessions.
  sessionVersion: integer("session_version").notNull().default(1),
  ...timestamps,
  ...softDelete,
}, (t) => [
  // Emails are stored normalized to lowercase (see auth.validation emailSchema).
  uniqueIndex("users_email_uq").on(t.email),
  check("users_email_lowercase_chk", sql`${t.email} = lower(${t.email})`),
  index("users_org_idx").on(t.organizationId),
]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // SHA-256 of the opaque cookie token; the raw token is never stored.
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  sessionVersion: integer("session_version").notNull(),
  ipAddress: inet("ip_address"),
  userAgent: varchar("user_agent", { length: 400 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("prt_user_idx").on(t.userId)]);

export const loginAttempts = pgTable("login_attempts", {
  id: id(),
  // Hashes of normalized email and IP so raw identifiers are not kept here.
  emailHash: varchar("email_hash", { length: 64 }).notNull(),
  ipHash: varchar("ip_hash", { length: 64 }).notNull(),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("login_attempts_email_idx").on(t.emailHash, t.createdAt),
  index("login_attempts_ip_idx").on(t.ipHash, t.createdAt),
]);
