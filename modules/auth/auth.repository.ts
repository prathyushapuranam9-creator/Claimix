import "server-only";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  loginAttempts, organizations, passwordResetTokens, patients, permissions, rolePermissions, roles, sessions, users,
} from "@/db/schema";
import type { OrgType, PermissionKey, Scope } from "@/lib/permissions/catalog";

export const AuthRepository = {
  async findUserByEmail(db: DbOrTx, email: string) {
    const [row] = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
        sessionVersion: users.sessionVersion,
        orgActive: organizations.isActive,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(and(eq(users.email, email.trim().toLowerCase()), isNull(users.deletedAt)))
      .limit(1);
    return row;
  },

  async countRecentFailures(db: DbOrTx, field: "email" | "ip", hash: string, since: Date) {
    const col = field === "email" ? loginAttempts.emailHash : loginAttempts.ipHash;
    const [row] = await db
      .select({ n: count() })
      .from(loginAttempts)
      .where(and(eq(col, hash), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
    return row?.n ?? 0;
  },

  async recordAttempt(db: DbOrTx, emailHash: string, ipHash: string, success: boolean) {
    await db.insert(loginAttempts).values({ emailHash, ipHash, success });
  },

  async createSession(db: DbOrTx, v: typeof sessions.$inferInsert) {
    const [row] = await db.insert(sessions).values(v).returning({ id: sessions.id });
    return row!;
  },

  /** Session + user + org + patient link in one query (no N+1 on every request). */
  async findSessionContext(db: DbOrTx, tokenHash: string) {
    const [row] = await db
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
        revokedAt: sessions.revokedAt,
        sessionVersion: sessions.sessionVersion,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        userActive: users.isActive,
        userDeletedAt: users.deletedAt,
        userSessionVersion: users.sessionVersion,
        roleId: users.roleId,
        roleKey: roles.key,
        roleName: roles.name,
        organizationId: organizations.id,
        orgType: organizations.type,
        orgName: organizations.name,
        orgActive: organizations.isActive,
        patientId: patients.id,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(roles, eq(roles.id, users.roleId))
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .leftJoin(patients, and(eq(patients.userId, users.id), isNull(patients.deletedAt)))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return row;
  },

  async loadPermissions(db: DbOrTx, roleId: string): Promise<Map<PermissionKey, Scope>> {
    const rows = await db
      .select({ key: permissions.key, scope: rolePermissions.scope })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId));
    return new Map(rows.map((r) => [r.key as PermissionKey, r.scope]));
  },

  async touchSession(db: DbOrTx, sessionId: string) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
  },

  async revokeSession(db: DbOrTx, tokenHash: string) {
    const [row] = await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id, userId: sessions.userId });
    return row;
  },

  async revokeAllForUser(db: DbOrTx, userId: string) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
  },

  async markLogin(db: DbOrTx, userId: string) {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  },

  async createResetToken(db: DbOrTx, userId: string, tokenHash: string, expiresAt: Date) {
    // Only the newest reset link stays valid.
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    await db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
  },

  async countRecentResetTokens(db: DbOrTx, userId: string, since: Date) {
    const [r] = await db
      .select({ n: count() })
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, userId), gt(passwordResetTokens.createdAt, since)));
    return r?.n ?? 0;
  },

  /** Atomically consumes a valid reset token; returns the user id or undefined. */
  async consumeResetToken(db: DbOrTx, tokenHash: string) {
    const [row] = await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ))
      .returning({ userId: passwordResetTokens.userId });
    return row?.userId;
  },

  async setPassword(db: DbOrTx, userId: string, passwordHash: string) {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  },
};

export type SessionContextRow = NonNullable<Awaited<ReturnType<typeof AuthRepository.findSessionContext>>>;
export type { OrgType };
