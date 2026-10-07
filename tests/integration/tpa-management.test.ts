import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, isNull, isNotNull } from "drizzle-orm";
import { claims, policies, preAuthorizations } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { ClaimService } from "@/modules/claims/claims.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { TpaService } from "@/modules/tpas/tpas.service";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const Q = { page: 1, pageSize: 100 };

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

const dbCount = async (where: Parameters<typeof and>[number][]) => (await ctx.db.select({ n: count() }).from(policies).where(and(isNull(policies.deletedAt), ...where)))[0]!.n;

describe("TPA management", () => {
  it("lists real TPAs with search and pagination", async () => {
    const all = await TpaService.list(as("insurerA"), { page: 1, pageSize: 100 });
    expect(all.rows.map((r) => r.id)).toEqual(expect.arrayContaining([DEMO.org.tpaA, DEMO.org.tpaB]));
    const code = all.rows.find((r) => r.id === DEMO.org.tpaA)!.code;
    const found = await TpaService.list(as("insurerA"), { page: 1, pageSize: 20, q: code });
    expect(found.rows.map((r) => r.id)).toContain(DEMO.org.tpaA);
    const page1 = await TpaService.list(as("insurerA"), { page: 1, pageSize: 5 });
    expect(page1.rows.length).toBeLessThanOrEqual(5);
    expect(page1.total).toBe(all.total);
  });

  it("'policies serviced' counts only what the viewer may see", async () => {
    const insurer = (await TpaService.list(as("insurerA"), Q)).rows.find((r) => r.id === DEMO.org.tpaA)!;
    expect(insurer.policyCount).toBe(await dbCount([eq(policies.tpaId, DEMO.org.tpaA), eq(policies.insurerId, DEMO.org.insurerA)]));
    // Another insurer doesn't see Aarogya's products counted.
    const other = (await TpaService.list(as("insurerB"), Q)).rows.find((r) => r.id === DEMO.org.tpaA)!;
    expect(other.policyCount).toBe(await dbCount([eq(policies.tpaId, DEMO.org.tpaA), eq(policies.insurerId, DEMO.org.insurerB)]));
    // Administrators and hospital staff see the full count.
    for (const k of ["admin", "staffA"] as const) {
      expect((await TpaService.list(as(k), Q)).rows.find((r) => r.id === DEMO.org.tpaA)!.policyCount, k).toBe(await dbCount([eq(policies.tpaId, DEMO.org.tpaA)]));
    }
  });

  it("linked policies are the TPA's own, within the viewer's policy scope", async () => {
    const forA = await PolicyService.list(as("insurerA"), Q, { tpaId: DEMO.org.tpaA });
    expect(forA.rows.length).toBeGreaterThan(0);
    const ids = forA.rows.map((r) => r.id);
    const owners = await ctx.db.select({ id: policies.id, tpaId: policies.tpaId, insurerId: policies.insurerId }).from(policies);
    for (const id of ids) expect(owners.find((o) => o.id === id)).toMatchObject({ tpaId: DEMO.org.tpaA, insurerId: DEMO.org.insurerA });
    expect((await PolicyService.list(as("insurerB"), Q, { tpaId: DEMO.org.tpaA })).rows).toEqual([]);
  });

  it("pre-auths and claims for a TPA come from the existing case scope", async () => {
    // Payer: only cases submitted to it and run by that TPA.
    const pa = await PreauthService.list(as("insurerA"), Q, { tpaId: DEMO.org.tpaA });
    const [expected] = await ctx.db.select({ n: count() }).from(preAuthorizations).where(and(eq(preAuthorizations.tpaId, DEMO.org.tpaA), eq(preAuthorizations.insurerId, DEMO.org.insurerA), isNotNull(preAuthorizations.submittedAt)));
    expect(pa.total).toBe(expected!.n);
    const cl = await ClaimService.list(as("insurerA"), Q, { tpaId: DEMO.org.tpaA });
    const [ce] = await ctx.db.select({ n: count() }).from(claims).where(and(eq(claims.tpaId, DEMO.org.tpaA), eq(claims.insurerId, DEMO.org.insurerA), isNotNull(claims.submittedAt)));
    expect(cl.total).toBe(ce!.n);
    // Another insurer sees none of Aarogya's cases through the same TPA.
    expect((await PreauthService.list(as("insurerB"), Q, { tpaId: DEMO.org.tpaA })).rows.every((r) => r.insurerName !== null && !/Aarogya/.test(r.insurerName))).toBe(true);
    // No case access → refused.
    await expect(ClaimService.list(as("readOnly"), Q, { tpaId: DEMO.org.tpaA })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
