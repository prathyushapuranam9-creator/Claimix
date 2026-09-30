import "server-only";
import type { Db } from "@/db/client";
import { RateLimitedError, UnauthorizedError, ValidationError } from "@/lib/errors";
import type { Principal } from "@/lib/permissions/principal";
import { hashPassword, hmacHex, randomToken, sha256Hex, verifyPassword } from "@/lib/security/crypto";
import { AuditService, type RequestMeta } from "@/modules/audit/audit.service";
import { issuePasswordSetup } from "./password-setup";
import { AuthRepository } from "./auth.repository";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from "./auth.validation";

export const SESSION_POLICY = {
  absoluteMs: 12 * 60 * 60 * 1000, // 12h hard limit
  idleMs: 60 * 60 * 1000, // 1h inactivity
  touchEveryMs: 5 * 60 * 1000, // throttle last-seen writes
  lockout: { windowMs: 15 * 60 * 1000, maxPerEmail: 5, maxPerIp: 30 },
  // Reset emails per account per hour; extra requests are silently dropped.
  resetLimit: { windowMs: 60 * 60 * 1000, max: 3 },
  // Reset requests take at least this long either way, so timing doesn't reveal whether an account exists.
  resetMinMs: 400,
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AuthConfig {
  secret: string;
  appUrl: string;
}

export interface SessionUser {
  principal: Principal;
  fullName: string;
  email: string;
  roleName: string;
  orgName: string;
}

// Verified against when the email is unknown so response time does not reveal which accounts exist.
let dummyHash: Promise<string> | undefined;

/**
 * Authentication, isolated from the rest of the app. It has no knowledge of Next.js:
 * callers pass the database, config and request metadata, and get back opaque tokens.
 * Only SHA-256 hashes of tokens are stored.
 */
export function createAuthService(db: Db, cfg: AuthConfig) {
  const keyed = (v: string) => hmacHex(v, cfg.secret);

  return {
    async login(input: unknown, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
      const parsed = loginSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError("Enter your email and password.");
      const { email, password } = parsed.data;
      const emailHash = keyed(email);
      const ipHash = keyed(meta.ipAddress ?? "unknown");
      const since = new Date(Date.now() - SESSION_POLICY.lockout.windowMs);

      const [byEmail, byIp] = await Promise.all([
        AuthRepository.countRecentFailures(db, "email", emailHash, since),
        AuthRepository.countRecentFailures(db, "ip", ipHash, since),
      ]);
      if (byEmail >= SESSION_POLICY.lockout.maxPerEmail || byIp >= SESSION_POLICY.lockout.maxPerIp) {
        await AuditService.record(db, { action: "auth.login_blocked", meta, newState: { reason: "rate_limited" } });
        throw new RateLimitedError("Too many failed sign-in attempts. Please wait 15 minutes and try again.");
      }

      const user = await AuthRepository.findUserByEmail(db, email);
      dummyHash ??= hashPassword("claimix-timing-equalizer");
      const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
      const allowed = ok && !!user && user.isActive && user.orgActive;

      await AuthRepository.recordAttempt(db, emailHash, ipHash, allowed);
      if (!allowed || !user) {
        await AuditService.record(db, {
          action: "auth.login_failed",
          actorUserId: user?.id ?? null,
          organizationId: user?.organizationId ?? null,
          meta,
        });
        // Same message for unknown email, wrong password and disabled account.
        throw new UnauthorizedError("Incorrect email or password.");
      }

      const token = randomToken();
      const expiresAt = new Date(Date.now() + SESSION_POLICY.absoluteMs);
      await db.transaction(async (tx) => {
        const s = await AuthRepository.createSession(tx, {
          userId: user.id,
          tokenHash: sha256Hex(token),
          sessionVersion: user.sessionVersion,
          ipAddress: meta.ipAddress && /^[0-9a-fA-F:.]{3,45}$/.test(meta.ipAddress) ? meta.ipAddress : null,
          userAgent: meta.userAgent?.slice(0, 400) ?? null,
          expiresAt,
        });
        await AuthRepository.markLogin(tx, user.id);
        await AuditService.record(tx, {
          action: "auth.login",
          actorUserId: user.id,
          organizationId: user.organizationId,
          sessionId: s.id,
          meta,
        });
      });
      return { token, expiresAt };
    },

    /** Resolves a cookie token to the caller, or null if missing/expired/revoked. */
    async resolve(token: string | undefined | null): Promise<SessionUser | null> {
      if (!token || token.length > 200) return null;
      const row = await AuthRepository.findSessionContext(db, sha256Hex(token));
      if (!row) return null;
      const now = Date.now();
      const invalid =
        row.revokedAt !== null ||
        row.expiresAt.getTime() <= now ||
        now - row.lastSeenAt.getTime() > SESSION_POLICY.idleMs ||
        !row.userActive ||
        row.userDeletedAt !== null ||
        !row.orgActive ||
        row.sessionVersion !== row.userSessionVersion;
      if (invalid) return null;

      if (now - row.lastSeenAt.getTime() > SESSION_POLICY.touchEveryMs) {
        await AuthRepository.touchSession(db, row.sessionId);
      }
      const permissions = await AuthRepository.loadPermissions(db, row.roleId);
      return {
        principal: {
          userId: row.userId,
          organizationId: row.organizationId,
          orgType: row.orgType,
          roleKey: row.roleKey,
          // Only patient-role users are ever bound to a single patient record.
          patientId: row.roleKey === "patient" ? row.patientId : null,
          sessionId: row.sessionId,
          permissions,
        },
        fullName: row.fullName,
        email: row.email,
        roleName: row.roleName,
        orgName: row.orgName,
      };
    },

    async logout(token: string | undefined | null, meta: RequestMeta): Promise<void> {
      if (!token) return;
      const revoked = await AuthRepository.revokeSession(db, sha256Hex(token));
      if (revoked) {
        await AuditService.record(db, { action: "auth.logout", actorUserId: revoked.userId, sessionId: revoked.id, meta });
      }
    },

    async revokeAllSessions(userId: string, actor: Principal, meta: RequestMeta): Promise<void> {
      await db.transaction(async (tx) => {
        await AuthRepository.revokeAllForUser(tx, userId);
        await AuditService.record(tx, {
          action: "auth.sessions_revoked",
          actorUserId: actor.userId,
          organizationId: actor.organizationId,
          resourceType: "user",
          resourceId: userId,
          meta,
        });
      });
    },

    /** Always resolves the same way whether or not the email exists (no account enumeration). */
    async requestPasswordReset(input: unknown, meta: RequestMeta): Promise<void> {
      const parsed = forgotPasswordSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError("Enter a valid email address.");
      const started = Date.now();
      try {
        const user = await AuthRepository.findUserByEmail(db, parsed.data.email);
        if (!user || !user.isActive) return;
        // Throttle per account: stops inbox flooding and repeated invalidation of a genuine link.
        const since = new Date(Date.now() - SESSION_POLICY.resetLimit.windowMs);
        if ((await AuthRepository.countRecentResetTokens(db, user.id, since)) >= SESSION_POLICY.resetLimit.max) return;
        await db.transaction(async (tx) => {
          await issuePasswordSetup(tx, user.id, cfg.appUrl, "reset");
          await AuditService.record(tx, { action: "auth.password_reset_requested", actorUserId: user.id, organizationId: user.organizationId, meta });
        });
      } finally {
        await sleep(Math.max(0, SESSION_POLICY.resetMinMs - (Date.now() - started)));
      }
    },

    async resetPassword(input: unknown, meta: RequestMeta): Promise<void> {
      const parsed = resetPasswordSchema.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      const newHash = await hashPassword(parsed.data.password);
      await db.transaction(async (tx) => {
        const userId = await AuthRepository.consumeResetToken(tx, sha256Hex(parsed.data.token));
        if (!userId) throw new ValidationError("This reset link is invalid or has expired. Request a new one.");
        await AuthRepository.setPassword(tx, userId, newHash);
        await AuthRepository.revokeAllForUser(tx, userId); // sign out everywhere
        await AuditService.record(tx, { action: "auth.password_reset", actorUserId: userId, meta });
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
