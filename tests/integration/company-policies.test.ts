import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull, or } from "drizzle-orm";
import { policies } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { CompanyPolicyService } from "@/modules/policies/company-policies.service";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { META, svc, testContext, uniqueIp } from "./helpers";

/** Dashboard "Insurance Company → Policy → content": each company shows exactly its own policies, to those allowed. */
const ctx = testContext();
afterAll(() => ctx.close());

async function signedIn(email: string) {
  const { token } = await ctx.auth.login({ email, password: ctx.demoPassword }, { ...META, ipAddress: uniqueIp() });
  const user = (await ctx.auth.resolve(token))!;
  return { user, c: svc(ctx.db, user.principal) };
}

/** Straight from the database: the company's active products (an insurer's own, or those a TPA administers). */
const policiesOf = async (orgId: string) =>
  (await ctx.db.select({ id: policies.id }).from(policies).where(and(or(eq(policies.insurerId, orgId), eq(policies.tpaId, orgId)), eq(policies.isActive, true), isNull(policies.deletedAt)))).map((p) => p.id).sort();

describe("company policies on the dashboard", () => {
  it("an administrator sees each company's own policies, and they never mix", async () => {
    const { user, c } = await signedIn("admin@demo.claimix.invalid");
    const seen = new Map<string, string[]>();
    for (const org of [DEMO.org.insurerA, DEMO.org.insurerB, DEMO.org.insurerC, DEMO.org.tpaA]) {
      const list = (await CompanyPolicyService.list(c, user, org)).map((p) => p.id).sort();
      expect(list, org).toEqual(await policiesOf(org));
      seen.set(org, list);
    }
    const a = new Set(seen.get(DEMO.org.insurerA));
    expect(seen.get(DEMO.org.insurerB)!.some((id) => a.has(id))).toBe(false);

    // A policy opens only under its own company, with its own content.
    const [first] = seen.get(DEMO.org.insurerA)!;
    const d = await CompanyPolicyService.get(c, user, DEMO.org.insurerA, first!);
    expect(d.policy.id).toBe(first);
    expect(d.policy.insurerId).toBe(DEMO.org.insurerA);
    await expect(CompanyPolicyService.get(c, user, DEMO.org.insurerB, first!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an insurer reviewer browses only its own company; other companies and their policies are refused", async () => {
    const { user, c } = await signedIn("insurer.a@demo.claimix.invalid");
    expect((await CompanyPolicyService.list(c, user, DEMO.org.insurerA)).map((p) => p.id).sort()).toEqual(await policiesOf(DEMO.org.insurerA));
    for (const org of [DEMO.org.insurerB, DEMO.org.insurerC, DEMO.org.tpaA]) {
      await expect(CompanyPolicyService.list(c, user, org), org).rejects.toBeInstanceOf(ForbiddenError);
    }
    const [other] = await policiesOf(DEMO.org.insurerB);
    // Not through another company, and not by passing another insurer's policy under its own company.
    await expect(CompanyPolicyService.get(c, user, DEMO.org.insurerB, other!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(CompanyPolicyService.get(c, user, DEMO.org.insurerA, other!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a TPA reviewer sees the policies it administers", async () => {
    const { user, c } = await signedIn("tpa.a@demo.claimix.invalid");
    expect((await CompanyPolicyService.list(c, user, DEMO.org.tpaA)).map((p) => p.id).sort()).toEqual(await policiesOf(DEMO.org.tpaA));
    await expect(CompanyPolicyService.list(c, user, DEMO.org.insurerA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the flagged testing login may browse every company; hospital staff may browse none", async () => {
    const portal = await signedIn("insurer.portal@demo.claimix.invalid");
    expect((await CompanyPolicyService.list(portal.c, portal.user, DEMO.org.insurerB)).map((p) => p.id).sort()).toEqual(await policiesOf(DEMO.org.insurerB));
    const staff = await signedIn("staff.a@demo.claimix.invalid");
    await expect(CompanyPolicyService.list(staff.c, staff.user, DEMO.org.insurerA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects ids that aren't an active insurer or TPA", async () => {
    const { user, c } = await signedIn("admin@demo.claimix.invalid");
    await expect(CompanyPolicyService.list(c, user, DEMO.org.hospitalA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(CompanyPolicyService.list(c, user, "not-a-uuid")).rejects.toBeTruthy();
  });
});
