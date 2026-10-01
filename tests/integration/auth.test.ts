import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditLogs, jobs, sessions, users } from "@/db/schema";
import { RateLimitedError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { sha256Hex } from "@/lib/security/crypto";
import { createThrowawayUser, META, testContext, uniqueIp } from "./helpers";

const ctx = testContext();
const PASSWORD = "Throwaway-pass-123";

afterAll(() => ctx.close());

describe("login", () => {
  it("issues a session for valid credentials and resolves it to a principal", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    const { token, expiresAt } = await ctx.auth.login({ email: u.email.toUpperCase(), password: PASSWORD }, META);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const resolved = await ctx.auth.resolve(token);
    expect(resolved?.principal.userId).toBe(u.id);
    expect(resolved?.principal.roleKey).toBe("hospital_staff");
  });

  it("stores only a hash of the session token", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    const { token } = await ctx.auth.login({ email: u.email, password: PASSWORD }, META);
    const rows = await ctx.db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("gives the same error for wrong password and unknown email", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    const a = ctx.auth.login({ email: u.email, password: "wrong-password-1" }, { ...META, ipAddress: uniqueIp() });
    const b = ctx.auth.login({ email: "nobody@test.claimix.invalid", password: "x" }, { ...META, ipAddress: uniqueIp() });
    await expect(a).rejects.toThrow(new UnauthorizedError("Incorrect email or password."));
    await expect(b).rejects.toThrow(new UnauthorizedError("Incorrect email or password."));
  });

  it("rejects inactive users", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    await expect(ctx.auth.login({ email: u.email, password: PASSWORD }, META)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects malformed input", async () => {
    await expect(ctx.auth.login({ email: "not-an-email", password: "" }, META)).rejects.toBeInstanceOf(ValidationError);
  });

  it("locks out an account after repeated failures (brute-force protection)", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    for (let i = 0; i < 5; i++) {
      await expect(ctx.auth.login({ email: u.email, password: `bad-${i}` }, { ...META, ipAddress: uniqueIp() })).rejects.toBeInstanceOf(UnauthorizedError);
    }
    // Even the correct password is refused while locked.
    await expect(ctx.auth.login({ email: u.email, password: PASSWORD }, { ...META, ipAddress: uniqueIp() })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("audits successful and failed logins without recording the password", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    await ctx.auth.login({ email: u.email, password: PASSWORD }, META);
    await ctx.auth.login({ email: u.email, password: "nope-wrong-1" }, { ...META, ipAddress: uniqueIp() }).catch(() => {});
    const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, u.id));
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("auth.login");
    expect(actions).toContain("auth.login_failed");
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });
});

describe("sessions", () => {
  async function freshSession() {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    const { token } = await ctx.auth.login({ email: u.email, password: PASSWORD }, META);
    return { u, token };
  }

  it("logout revokes the session", async () => {
    const { token } = await freshSession();
    await ctx.auth.logout(token, META);
    expect(await ctx.auth.resolve(token)).toBeNull();
  });

  it("expired sessions are rejected (absolute expiry)", async () => {
    const { token } = await freshSession();
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, sha256Hex(token)));
    expect(await ctx.auth.resolve(token)).toBeNull();
  });

  it("idle sessions are rejected (inactivity timeout)", async () => {
    const { token } = await freshSession();
    await ctx.db.update(sessions).set({ lastSeenAt: sql`now() - interval '2 hours'` }).where(eq(sessions.tokenHash, sha256Hex(token)));
    expect(await ctx.auth.resolve(token)).toBeNull();
  });

  it("revoking all sessions invalidates every device", async () => {
    const { u, token } = await freshSession();
    const second = await ctx.auth.login({ email: u.email, password: PASSWORD }, META);
    const admin = (await ctx.auth.resolve(token))!.principal;
    await ctx.auth.revokeAllSessions(u.id, admin, META);
    expect(await ctx.auth.resolve(token)).toBeNull();
    expect(await ctx.auth.resolve(second.token)).toBeNull();
  });

  it("deactivating a user ends their existing sessions", async () => {
    const { u, token } = await freshSession();
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    expect(await ctx.auth.resolve(token)).toBeNull();
  });

  it("garbage and oversized tokens resolve to null", async () => {
    expect(await ctx.auth.resolve("nonsense")).toBeNull();
    expect(await ctx.auth.resolve("x".repeat(5000))).toBeNull();
    expect(await ctx.auth.resolve(undefined)).toBeNull();
  });
});

describe("password reset", () => {
  let email: string;
  let userId: string;

  beforeAll(async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    email = u.email;
    userId = u.id;
  });

  async function latestResetToken() {
    const [job] = await ctx.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, "email.send"), sql`${jobs.payload}->>'userId' = ${userId}`))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return new URL(String(job!.payload.link)).searchParams.get("token")!;
  }

  it("does not reveal whether an account exists", async () => {
    await expect(ctx.auth.requestPasswordReset({ email: "ghost@test.claimix.invalid" }, META)).resolves.toBeUndefined();
  });

  it("resets the password once, signs out everywhere, and the link cannot be reused", async () => {
    const { token: sessionToken } = await ctx.auth.login({ email, password: PASSWORD }, META);
    await ctx.auth.requestPasswordReset({ email }, META);
    const resetToken = await latestResetToken();
    const newPassword = "Brand-new-pass-456";

    await ctx.auth.resetPassword({ token: resetToken, password: newPassword, confirmPassword: newPassword }, META);
    expect(await ctx.auth.resolve(sessionToken)).toBeNull();
    await expect(ctx.auth.login({ email, password: newPassword }, META)).resolves.toHaveProperty("token");
    await expect(
      ctx.auth.resetPassword({ token: resetToken, password: "Another-pass-789", confirmPassword: "Another-pass-789" }, META),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("portal-based sign-in", () => {
  it("accepts the account's own portal, refuses another only after the password is verified, and never grants a role", async () => {
    const { auth, demoPassword } = ctx;
    const insurer = "insurer.a@demo.claimix.invalid";
    await expect(auth.login({ email: insurer, password: demoPassword, portal: "hospital" }, { ...META, ipAddress: uniqueIp() })).rejects.toThrow(/Insurance Reviewer/);
    // Wrong password with the wrong portal: the generic message (no hint about the account).
    await expect(auth.login({ email: insurer, password: "Wrong-password-123", portal: "hospital" }, { ...META, ipAddress: uniqueIp() })).rejects.toThrow("Incorrect email or password.");
    await expect(auth.login({ email: insurer, password: demoPassword, portal: "bogus" }, { ...META, ipAddress: uniqueIp() })).rejects.toThrow(/Choose how/);
    const ok = await auth.login({ email: insurer, password: demoPassword, portal: "insurance" }, { ...META, ipAddress: uniqueIp() });
    const user = await auth.resolve(ok.token);
    expect(user?.principal.orgType).toBe("insurer");
    expect(user?.principal.roleKey).toBe("payer_reviewer");
    // Choosing "admin" can never make an insurer an admin.
    await expect(auth.login({ email: insurer, password: demoPassword, portal: "admin" }, { ...META, ipAddress: uniqueIp() })).rejects.toThrow(/Insurance Reviewer/);
  });
});
