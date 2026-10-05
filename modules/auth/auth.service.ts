import "server-only";
import type { Db } from "@/db/client";
import { ForbiddenError, RateLimitedError, UnauthorizedError, ValidationError } from "@/lib/errors";
import type { Principal } from "@/lib/permissions/principal";
import { hashPassword, hmacHex, randomToken, sha256Hex, verifyPassword } from "@/lib/security/crypto";
import { AuditService, type RequestMeta } from "@/modules/audit/audit.service";
import { issuePasswordSetup } from "./password-setup";
import { AuthRepository } from "./auth.repository";
import { INSURANCE_CONTEXT_PERMISSION, InsuranceContext, type ContextOption, type ContextSelection, type ResolvedContext } from "./insurance-context";
import { isPortal, PORTALS, portalFor } from "@/lib/portals";
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from "./auth.validation";

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
  /** The real account may use the insurance-portal testing context (true even while a context is active). */
  canSwitchContext: boolean;
  /** The real account's own view is across all insurers (an administrator), rather than one insurer (a flagged payer login). */
  homeIsAllInsurers: boolean;
  /**
   * Which insurer / TPA the testing context may act as: null = any active one (administrators and accounts an
   * administrator flagged); otherwise only this organization (an ordinary insurer / TPA reviewer's own company).
   */
  contextOrganizationId: string | null;
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

  /**
   * Re-checks the signed-in user's current password before a sensitive self-service change.
   * Wrong guesses count toward the same lockout as sign-in, so this can't be used to brute-force.
   */
  async function confirmCurrentPassword(actor: Principal, password: string, meta: RequestMeta): Promise<void> {
    const creds = await AuthRepository.credentialsFor(db, actor.userId);
    if (!creds) throw new UnauthorizedError("Your session has ended. Please sign in again.");
    const emailHash = keyed(creds.email);
    const ipHash = keyed(meta.ipAddress ?? "unknown");
    const since = new Date(Date.now() - SESSION_POLICY.lockout.windowMs);
    const [byEmail, byIp] = await Promise.all([
      AuthRepository.countRecentFailures(db, "email", emailHash, since),
      AuthRepository.countRecentFailures(db, "ip", ipHash, since),
    ]);
    if (byEmail >= SESSION_POLICY.lockout.maxPerEmail || byIp >= SESSION_POLICY.lockout.maxPerIp) {
      throw new RateLimitedError("Too many incorrect password attempts. Please wait 15 minutes and try again.");
    }
    const ok = password.length > 0 && password.length <= 200 && (await verifyPassword(password, creds.passwordHash));
    await AuthRepository.recordAttempt(db, emailHash, ipHash, ok);
    if (!ok) {
      await AuditService.record(db, { action: "auth.password_confirm_failed", actorUserId: actor.userId, organizationId: actor.organizationId, sessionId: actor.sessionId, meta });
      throw new ValidationError("Your current password is incorrect.", { currentPassword: ["Your current password is incorrect."] });
    }
  }

  /** The REAL signed-in account (never the testing context), and only if it may use the insurance-portal context. */
  async function requireContextHolder(token: string | undefined | null) {
    const real = await service.resolve(token);
    if (!real) throw new UnauthorizedError("Your session has ended. Please sign in again.");
    if (!real.canSwitchContext) throw new ForbiddenError();
    return real;
  }

  /** A context choice the real account may use: any insurer / TPA, or only its own organization. */
  const contextAllowed = (real: Pick<SessionUser, "contextOrganizationId">, organizationId: string) =>
    real.contextOrganizationId === null || real.contextOrganizationId === organizationId;

  const service = {
    async login(input: unknown, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
      const parsed = loginSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError("Enter your email and password.");
      const { email, password } = parsed.data;
      // Optional portal chosen on the sign-in form; the account's own role always decides access.
      const requested = (input as { portal?: unknown } | null)?.portal;
      if (requested !== undefined && requested !== "" && !isPortal(requested)) throw new ValidationError("Choose how you are signing in.");
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

      // Only after the password is verified: the account must belong to the chosen portal.
      const portal = portalFor(user.orgType);
      if (isPortal(requested) && requested !== portal) {
        await AuditService.record(db, {
          action: "auth.login_wrong_portal",
          actorUserId: user.id,
          organizationId: user.organizationId,
          meta,
          newState: { requested, portal },
        });
        throw new UnauthorizedError(`This account signs in as ${PORTALS[portal].role}. Choose "${PORTALS[portal].role}" and sign in again.`);
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

    /**
     * Resolves a cookie token to the caller, or null if missing/expired/revoked. `contextToken` is the optional
     * insurance-portal testing context; it is applied only when valid for this session AND the real account
     * holds `insurance:context`, and the effective permissions are always loaded from the chosen role.
     */
    async resolve(token: string | undefined | null, contextToken?: string | null): Promise<SessionUser | null> {
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
      // Across every insurer: the Administrator permission, or the per-account testing flag an administrator sets on a
      // designated demo login. Every insurer / TPA reviewer may also use it, but only for its own organization.
      const crossInsurer = permissions.has(INSURANCE_CONTEXT_PERMISSION) || row.insuranceContext;
      const ownReviewer = (row.orgType === "insurer" || row.orgType === "tpa") && (permissions.has("preauth:review") || permissions.has("claim:review"));
      const canSwitchContext = crossInsurer || ownReviewer;
      const contextOrganizationId = crossInsurer ? null : ownReviewer ? row.organizationId : null;
      const homeIsAllInsurers = row.orgType === "platform";
      const selection = canSwitchContext ? InsuranceContext.verify(cfg.secret, contextToken, row.sessionId) : null;
      const resolved = selection ? await InsuranceContext.resolve(db, selection) : null;
      // Re-checked on every request: a context outside what this account may use is ignored.
      const acting = resolved && contextAllowed({ contextOrganizationId }, resolved.organizationId) ? resolved : null;
      if (acting) {
        return {
          principal: {
            userId: row.userId,
            organizationId: acting.organizationId,
            orgType: acting.orgType,
            roleKey: acting.roleKey,
            patientId: null,
            sessionId: row.sessionId,
            permissions: await AuthRepository.loadPermissions(db, acting.roleId),
            acting: { organizationName: acting.organizationName, roleName: acting.roleName },
          },
          fullName: row.fullName,
          email: row.email,
          roleName: acting.roleName,
          orgName: acting.organizationName,
          canSwitchContext,
          homeIsAllInsurers,
          contextOrganizationId,
        };
      }
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
        canSwitchContext,
        homeIsAllInsurers,
        contextOrganizationId,
      };
    },

    /**
     * The companies shown in the testing selector. Administrators and flagged logins: every active insurer and TPA,
     * all selectable. An ordinary reviewer: every active insurance company by name (public reference data) plus its
     * own organization, but only its own is selectable, and other companies carry no roles. Switching re-checks this.
     */
    async contextOptions(token: string | undefined | null): Promise<ContextOption[]> {
      const real = await requireContextHolder(token);
      const all = await InsuranceContext.options(db);
      if (real.contextOrganizationId === null) return all;
      return all
        .filter((o) => o.type === "insurer" || o.id === real.contextOrganizationId)
        .map((o) => (contextAllowed(real, o.id) ? o : { ...o, roles: [], selectable: false }));
    },

    /** Validates and audits a switch; returns the signed cookie value. Never grants anything the role doesn't hold. */
    async switchContext(token: string | undefined | null, input: unknown, meta: RequestMeta): Promise<{ contextToken: string; info: ResolvedContext }> {
      const real = await requireContextHolder(token);
      const sel = input as Partial<ContextSelection> | null;
      const info =
        typeof sel?.organizationId === "string" && typeof sel?.roleKey === "string"
          ? await InsuranceContext.resolve(db, { organizationId: sel.organizationId, roleKey: sel.roleKey })
          : null;
      if (!info) throw new ValidationError("Choose an insurance company and one of its roles.");
      if (!contextAllowed(real, info.organizationId)) throw new ForbiddenError("You can only test your own insurance company.");
      await AuditService.record(db, {
        action: "context.switched",
        actorUserId: real.principal.userId,
        organizationId: real.principal.organizationId,
        sessionId: real.principal.sessionId,
        newState: { organizationId: info.organizationId, organizationName: info.organizationName, roleKey: info.roleKey },
        meta,
      });
      return {
        contextToken: InsuranceContext.sign(cfg.secret, real.principal.sessionId, { organizationId: info.organizationId, roleKey: info.roleKey }),
        info,
      };
    },

    async clearContext(token: string | undefined | null, meta: RequestMeta): Promise<void> {
      const real = await requireContextHolder(token);
      await AuditService.record(db, { action: "context.cleared", actorUserId: real.principal.userId, organizationId: real.principal.organizationId, sessionId: real.principal.sessionId, meta });
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

    confirmCurrentPassword,

    /**
     * Profile Settings → Change Password, for the signed-in user only. The current password is
     * re-checked; other sessions are signed out, the current one stays signed in.
     */
    async changePassword(actor: Principal, input: unknown, meta: RequestMeta): Promise<void> {
      const parsed = changePasswordSchema.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      await confirmCurrentPassword(actor, parsed.data.currentPassword, meta);
      const newHash = await hashPassword(parsed.data.newPassword);
      await db.transaction(async (tx) => {
        await AuthRepository.setPassword(tx, actor.userId, newHash);
        await AuthRepository.revokeOthersForUser(tx, actor.userId, actor.sessionId);
        await AuditService.record(tx, { action: "auth.password_changed", actorUserId: actor.userId, organizationId: actor.organizationId, sessionId: actor.sessionId, meta });
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
  return service;
}

export type AuthService = ReturnType<typeof createAuthService>;
