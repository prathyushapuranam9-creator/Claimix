import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditLogs, users } from "@/db/schema";
import { RateLimitedError, UnauthorizedError, ValidationError } from "@/lib/errors";
import type { Principal } from "@/lib/permissions/principal";
import { UserService } from "@/modules/users/users.service";
import { createThrowawayUser, demoPrincipals, META, principalFor, svc, testContext, uniqueIp } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const meta = () => ({ ...META, ipAddress: uniqueIp() });

const row = async (id: string) =>
  (await ctx.db.select({ fullName: users.fullName, email: users.email, roleId: users.roleId, organizationId: users.organizationId, isActive: users.isActive }).from(users).where(eq(users.id, id)))[0]!;

/** Profile update as the action does it: the current-password check comes from the auth service. */
const updateOwn = (p: Principal, input: unknown) => UserService.updateOwnProfile(svc(ctx.db, p), input, (pw) => ctx.auth.confirmCurrentPassword(p, pw, meta()));

let originalA: Awaited<ReturnType<typeof row>>;
let originalB: Awaited<ReturnType<typeof row>>;

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  originalA = await row(who.staffA.userId);
  originalB = await row(who.staffB.userId);
});
afterAll(async () => {
  // Leave the fixture accounts exactly as they were.
  await ctx.db.update(users).set({ fullName: originalA.fullName }).where(eq(users.id, who.staffA.userId));
  await ctx.db.update(users).set({ fullName: originalB.fullName }).where(eq(users.id, who.staffB.userId));
  await ctx.close();
});

describe("Profile Settings: update own profile", () => {
  it("saves the signed-in user's new name and audits it", async () => {
    const r = await updateOwn(who.staffA, { fullName: "Kiran Desk Updated", email: originalA.email });
    expect(r.fullName).toBe("Kiran Desk Updated");
    expect((await row(who.staffA.userId)).fullName).toBe("Kiran Desk Updated");
    const [log] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "user.profile_updated"), eq(auditLogs.resourceId, who.staffA.userId))).orderBy(desc(auditLogs.occurredAt)).limit(1);
    expect(log).toBeTruthy();
  });

  it("ignores any other user id, role, organization or status in the request", async () => {
    const before = await row(who.staffA.userId);
    await updateOwn(who.staffA, {
      fullName: "Kiran Desk Again",
      email: originalA.email,
      id: who.staffB.userId,
      userId: who.staffB.userId,
      roleId: who.admin.userId,
      organizationId: who.insurerA.organizationId,
      isActive: false,
    });
    const after = await row(who.staffA.userId);
    expect(after).toEqual({ ...before, fullName: "Kiran Desk Again" });
    // The other user is untouched.
    expect(await row(who.staffB.userId)).toEqual(originalB);
  });

  it("rejects invalid names and emails on the server", async () => {
    for (const fullName of ["", " ", "A", "<script>", "x".repeat(201)]) {
      await expect(updateOwn(who.staffA, { fullName, email: originalA.email })).rejects.toBeInstanceOf(ValidationError);
    }
    for (const email of ["", "not-an-email", "a@"]) {
      await expect(updateOwn(who.staffA, { fullName: "Kiran Desk Again", email })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await row(who.staffA.userId)).toMatchObject({ fullName: "Kiran Desk Again", email: originalA.email });
  });

  it("works for every role without needing admin permissions", async () => {
    for (const k of ["insurerA", "patientA1", "readOnly"] as const) {
      const before = await row(who[k].userId);
      await updateOwn(who[k], { fullName: `${before.fullName} Edited`, email: before.email });
      expect((await row(who[k].userId)).fullName).toBe(`${before.fullName} Edited`);
      await ctx.db.update(users).set({ fullName: before.fullName }).where(eq(users.id, who[k].userId));
    }
  });
});

describe("Profile Settings: change email", () => {
  const PASSWORD = "Profile-pass-1234";

  it("needs the correct current password, refuses an email in use, then signs in with the new email", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    const me = await principalFor(ctx.auth, u.email, PASSWORD);
    const other = await principalFor(ctx.auth, u.email, PASSWORD); // a second device
    const next = `changed-${u.email}`;

    await expect(updateOwn(me, { fullName: "Throwaway Test User", email: next })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOwn(me, { fullName: "Throwaway Test User", email: next, currentPassword: "wrong-password-1" })).rejects.toThrow("current password is incorrect");
    await expect(updateOwn(me, { fullName: "Throwaway Test User", email: originalB.email, currentPassword: PASSWORD })).rejects.toThrow("already used");
    expect((await row(u.id)).email).toBe(u.email);

    // Mixed case is normalized like everywhere else.
    const r = await updateOwn(me, { fullName: "Throwaway Test User", email: next.toUpperCase(), currentPassword: PASSWORD });
    expect(r.email).toBe(next);
    expect((await row(u.id)).email).toBe(next);
    const [log] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "user.email_changed"), eq(auditLogs.resourceId, u.id))).limit(1);
    expect(log).toBeTruthy();

    // The new email signs in; the old one no longer does. The other device was signed out.
    await expect(principalFor(ctx.auth, next, PASSWORD)).resolves.toBeTruthy();
    await expect(ctx.auth.login({ email: u.email, password: PASSWORD }, meta())).rejects.toBeInstanceOf(UnauthorizedError);
    const sessions = await ctx.db.execute<{ id: string; revoked: boolean }>(
      sql`select id::text, revoked_at is not null as revoked from sessions where id in (${me.sessionId}, ${other.sessionId})`,
    );
    const byId = new Map(sessions.map((s) => [s.id, s.revoked]));
    expect(byId.get(me.sessionId)).toBe(false);
    expect(byId.get(other.sessionId)).toBe(true);
  });
});

describe("Profile Settings: change password", () => {
  const PASSWORD = "Original-pass-1234";
  const NEXT = "Brand-new-pass-5678";

  it("validates the current password, the rules and the confirmation, then keeps this session and signs out others", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    const me = await principalFor(ctx.auth, u.email, PASSWORD);
    const other = await principalFor(ctx.auth, u.email, PASSWORD);

    await expect(ctx.auth.changePassword(me, { currentPassword: "wrong-password-1", newPassword: NEXT, confirmPassword: NEXT }, meta())).rejects.toThrow("current password is incorrect");
    await expect(ctx.auth.changePassword(me, { currentPassword: PASSWORD, newPassword: "short1", confirmPassword: "short1" }, meta())).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.auth.changePassword(me, { currentPassword: PASSWORD, newPassword: "onlyletterslong", confirmPassword: "onlyletterslong" }, meta())).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.auth.changePassword(me, { currentPassword: PASSWORD, newPassword: NEXT, confirmPassword: `${NEXT}x` }, meta())).rejects.toThrow("highlighted");
    await expect(ctx.auth.changePassword(me, { currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD }, meta())).rejects.toBeInstanceOf(ValidationError);

    await ctx.auth.changePassword(me, { currentPassword: PASSWORD, newPassword: NEXT, confirmPassword: NEXT }, meta());

    // Only the new password works; the password hash never equals the plain text.
    await expect(principalFor(ctx.auth, u.email, NEXT)).resolves.toBeTruthy();
    await expect(ctx.auth.login({ email: u.email, password: PASSWORD }, meta())).rejects.toBeInstanceOf(UnauthorizedError);
    const [stored] = await ctx.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, u.id));
    expect(stored!.hash).not.toContain(NEXT);

    const [log] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "auth.password_changed"), eq(auditLogs.actorUserId, u.id))).limit(1);
    expect(log).toBeTruthy();
    expect(JSON.stringify(log)).not.toContain(NEXT);

    const rows = await ctx.db.execute<{ id: string; revoked: boolean }>(sql`select id::text, revoked_at is not null as revoked from sessions where id in (${me.sessionId}, ${other.sessionId})`);
    const byId = new Map(rows.map((s) => [s.id, s.revoked]));
    expect(byId.get(me.sessionId)).toBe(false);
    expect(byId.get(other.sessionId)).toBe(true);
  });

  it("wrong current passwords count toward the sign-in lockout", async () => {
    const u = await createThrowawayUser(ctx.db, PASSWORD);
    const me = await principalFor(ctx.auth, u.email, PASSWORD);
    for (let i = 0; i < 5; i++) {
      await expect(ctx.auth.changePassword(me, { currentPassword: `wrong-guess-${i}x`, newPassword: NEXT, confirmPassword: NEXT }, meta())).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(ctx.auth.changePassword(me, { currentPassword: PASSWORD, newPassword: NEXT, confirmPassword: NEXT }, meta())).rejects.toBeInstanceOf(RateLimitedError);
  });
});
