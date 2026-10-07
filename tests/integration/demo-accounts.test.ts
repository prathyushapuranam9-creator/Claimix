import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { organizations, roles, users } from "@/db/schema";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import { portalFor } from "@/lib/portals";
import { configureDemoAccounts, DEMO_ACCOUNTS } from "@/modules/users/demo-accounts";
import { META, testContext, uniqueIp } from "./helpers";

/** The three shared demo logins. Test-only passwords; the accounts are removed afterwards. */
const ctx = testContext();
const EMAILS = DEMO_ACCOUNTS.map((a) => a.email);
const PW = { admin: "Test-demo-admin-1", insurer: "Test-demo-insurer-1", hospital: "Test-demo-hospital-1" };

afterAll(async () => {
  await ctx.db.delete(users).where(inArray(users.email, EMAILS));
  await ctx.close();
});

const login = (email: string, password: string) => ctx.auth.login({ email, password }, { ...META, ipAddress: uniqueIp() });

describe("demo accounts", () => {
  it("creates one login per portal; each signs in without choosing a portal and lands in its own", async () => {
    const results = await configureDemoAccounts(ctx.db, PW);
    expect(results.map((r) => r.email)).toEqual(EMAILS);

    const rows = await ctx.db
      .select({ email: users.email, role: roles.key, orgType: organizations.type, flag: users.insuranceContext, hash: users.passwordHash })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(inArray(users.email, EMAILS));
    const by = Object.fromEntries(rows.map((r) => [r.email, r]));
    expect(by["admin@claimix.com"]).toMatchObject({ role: "admin", orgType: "platform", flag: false });
    expect(by["insurer@claimix.com"]).toMatchObject({ role: "payer_reviewer", orgType: "insurer", flag: true });
    expect(by["hospital@claimix.com"]).toMatchObject({ role: "hospital_staff", orgType: "hospital", flag: false });
    // Stored only as a hash.
    for (const a of DEMO_ACCOUNTS) expect(by[a.email]!.hash).not.toContain(PW[a.key]);

    const expected = { "admin@claimix.com": "admin", "insurer@claimix.com": "insurance", "hospital@claimix.com": "hospital" } as const;
    for (const a of DEMO_ACCOUNTS) {
      const { token } = await login(a.email, PW[a.key]); // no portal given
      const me = (await ctx.auth.resolve(token))!;
      expect(portalFor(me.principal.orgType), a.email).toBe(expected[a.email]);
    }
  });

  it("the one insurer login can open every active insurance company; ordinary insurer users still only their own", async () => {
    const { token } = await login("insurer@claimix.com", PW.insurer);
    const me = (await ctx.auth.resolve(token))!;
    expect(me.contextOrganizationId).toBeNull();
    const options = await ctx.auth.contextOptions(token);
    const insurers = (await ctx.db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.type, "insurer"), eq(organizations.isActive, true), isNull(organizations.deletedAt)))).map((o) => o.id);
    for (const id of insurers) expect(options.find((o) => o.id === id)?.selectable, id).toBe(true);
    // It can switch to each one with the same login.
    for (const id of insurers) {
      const { contextToken } = await ctx.auth.switchContext(token, { organizationId: id, roleKey: "payer_reviewer" }, META);
      expect((await ctx.auth.resolve(token, contextToken))!.principal.organizationId).toBe(id);
    }
    // Nobody else gained anything.
    const other = (await ctx.auth.resolve((await login("insurer.a@demo.claimix.invalid", ctx.demoPassword)).token))!;
    expect(other.contextOrganizationId).toBe(other.principal.organizationId);
  });

  it("running it again resets the password (old one stops working) and needs every password", async () => {
    const next = { ...PW, hospital: "Test-demo-hospital-2" };
    const results = await configureDemoAccounts(ctx.db, next);
    expect(results.every((r) => r.status === "updated")).toBe(true);
    await expect(login("hospital@claimix.com", PW.hospital)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(login("hospital@claimix.com", next.hospital)).resolves.toBeTruthy();
    await expect(configureDemoAccounts(ctx.db, { ...PW, insurer: "" })).rejects.toBeInstanceOf(ValidationError);
  });
});
