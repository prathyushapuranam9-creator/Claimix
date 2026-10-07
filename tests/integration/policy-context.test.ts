import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { claims, documents, policies, preAuthorizations } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { InsuranceContext } from "@/modules/auth/insurance-context";
import { ClaimService } from "@/modules/claims/claims.service";
import { DocumentListService } from "@/modules/documents/documents.service";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { ReportService } from "@/modules/reports/reports.service";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { approvedPreauth, codes, useTempStorage } from "./fixtures";
import { demoPrincipals, META, svc, testContext, uniqueIp } from "./helpers";

/**
 * Insurance Company + Policy on the dashboard: the whole portal narrows to that one policy, enforced in the shared
 * server-side scope (lists, detail lookups, counts, reports), never only in the page.
 */
const ctx = testContext();
const SECRET = "test-secret-".padEnd(40, "x"); // matches testContext()
const ALL = { page: 1, pageSize: 100 };
const FLOATER = DEMO.policy.aarogyaFloater;
let who: Awaited<ReturnType<typeof demoPrincipals>>;

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  await approvedPreauth(ctx.db, who, await codes(ctx.db)); // a submitted Aarogya case exists
});
afterAll(() => ctx.close());

const login = async (email: string) => (await ctx.auth.login({ email, password: ctx.demoPassword }, { ...META, ipAddress: uniqueIp() })).token;

async function narrowed(email: string, org: string, policyId: string | null) {
  const token = await login(email);
  const { contextToken } = await ctx.auth.switchContext(token, { organizationId: org, roleKey: "payer_reviewer", policyId }, META);
  const user = (await ctx.auth.resolve(token, contextToken))!;
  return { user, c: svc(ctx.db, user.principal), token };
}

const policyOf = async (table: typeof claims | typeof preAuthorizations, ids: string[]) =>
  ids.length ? (await ctx.db.select({ p: table.policyId }).from(table).where(inArray(table.id, ids))).map((r) => r.p) : [];

describe("Insurance Company + Policy context", () => {
  it("narrows pre-auths, claims, patients, coverage, documents, policies and reports to that one policy", async () => {
    const whole = await narrowed("admin@demo.claimix.invalid", DEMO.org.insurerA, null);
    const { user, c } = await narrowed("admin@demo.claimix.invalid", DEMO.org.insurerA, FLOATER);
    expect(user.principal.policyId).toBe(FLOATER);
    expect(user.principal.acting?.policyName).toMatch(/Aarogya Family Floater/);

    const pa = (await PreauthService.list(c, ALL, {})).rows.map((r) => r.id);
    expect(pa.length).toBeGreaterThan(0);
    expect(new Set(await policyOf(preAuthorizations, pa))).toEqual(new Set([FLOATER]));
    // Strictly fewer or equal than the whole company, and never another policy.
    expect(pa.length).toBeLessThanOrEqual((await PreauthService.list(whole.c, ALL, {})).total);

    const cl = (await ClaimService.list(c, ALL, {})).rows.map((r) => r.id);
    expect((await policyOf(claims, cl)).every((p) => p === FLOATER)).toBe(true);

    // Patients: only those with a submitted case under this policy.
    const pts = (await PatientService.list(c, ALL)).rows.map((r) => r.id);
    expect(pts.length).toBeGreaterThan(0);
    for (const id of pts) {
      const [r] = await ctx.db.execute<{ n: number }>(sql`select (
        (select count(*) from claims where patient_id = ${id} and policy_id = ${FLOATER} and submitted_at is not null) +
        (select count(*) from pre_authorizations where patient_id = ${id} and policy_id = ${FLOATER} and submitted_at is not null))::int as n`);
      expect(r!.n, id).toBeGreaterThan(0);
    }
    // Coverage on a profile: that policy only.
    const cov = await CoverageService.forPatient(c, pts[0]!);
    expect(cov.every((x) => x.policyId === FLOATER)).toBe(true);

    // Documents: only those on this policy's cases.
    const docs = (await DocumentListService.list(c, ALL, {})).rows.map((r) => r.id);
    if (docs.length) {
      const rows = await ctx.db.select({ t: documents.subjectType, s: documents.subjectId }).from(documents).where(inArray(documents.id, docs));
      for (const d of rows) {
        const table = d.t === "claim" ? claims : preAuthorizations;
        expect(await policyOf(table, [d.s!])).toEqual([FLOATER]);
      }
    }

    // Policies list: just this one.
    expect((await PolicyService.list(c, ALL, {})).rows.map((r) => r.id)).toEqual([FLOATER]);

    // Reports follow the same filter.
    const rep = await ReportService.overview(c, {});
    const counted = Object.values(rep.preauthStatus ?? {}).reduce((a, b) => a + b, 0);
    expect(counted).toBe((await PreauthService.list(c, ALL, {})).total);
  });

  it("a case under another policy can't be opened while narrowed, even by id", async () => {
    const whole = await narrowed("admin@demo.claimix.invalid", DEMO.org.insurerA, null);
    const ids = (await PreauthService.list(whole.c, ALL, {})).rows.map((r) => r.id);
    const rows = await ctx.db.select({ id: preAuthorizations.id, p: preAuthorizations.policyId }).from(preAuthorizations).where(inArray(preAuthorizations.id, ids));
    const floaterCase = rows.find((r) => r.p === FLOATER)!;
    expect(floaterCase).toBeTruthy();
    // Narrowed to the senior policy: the floater case is out of reach; narrowed to the floater: it opens.
    const senior = await narrowed("admin@demo.claimix.invalid", DEMO.org.insurerA, DEMO.policy.aarogyaSenior);
    await expect(PreauthService.workspace(senior.c, floaterCase.id)).rejects.toBeTruthy();
    const floater = await narrowed("admin@demo.claimix.invalid", DEMO.org.insurerA, FLOATER);
    await expect(PreauthService.workspace(floater.c, floaterCase.id)).resolves.toBeTruthy();
  });

  it("only a policy of the chosen company is accepted; an ordinary reviewer only within its own company", async () => {
    const admin = await login("admin@demo.claimix.invalid");
    await expect(ctx.auth.switchContext(admin, { organizationId: DEMO.org.insurerA, roleKey: "payer_reviewer", policyId: DEMO.policy.navjeevanTopUp }, META)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.auth.switchContext(admin, { organizationId: DEMO.org.insurerA, roleKey: "payer_reviewer", policyId: "not-a-uuid" }, META)).rejects.toBeInstanceOf(ValidationError);

    const own = await narrowed("insurer.a@demo.claimix.invalid", DEMO.org.insurerA, FLOATER);
    expect(own.user.principal).toMatchObject({ organizationId: DEMO.org.insurerA, policyId: FLOATER });
    const rev = await login("insurer.a@demo.claimix.invalid");
    await expect(ctx.auth.switchContext(rev, { organizationId: DEMO.org.insurerC, roleKey: "payer_reviewer", policyId: DEMO.policy.navjeevanTopUp }, META)).rejects.toBeTruthy();

    // A forged cookie pairing its company with another company's policy is ignored entirely.
    const real = (await ctx.auth.resolve(rev))!;
    const forged = InsuranceContext.sign(SECRET, real.principal.sessionId, { organizationId: DEMO.org.insurerA, roleKey: "payer_reviewer", policyId: DEMO.policy.navjeevanTopUp });
    const via = (await ctx.auth.resolve(rev, forged))!;
    expect(via.principal.policyId ?? null).toBeNull();
    expect(via.principal.acting).toBeUndefined();
  });

  it("without a policy chosen, nothing changes", async () => {
    const { user } = await narrowed("admin@demo.claimix.invalid", DEMO.org.insurerA, null);
    expect(user.principal.policyId).toBeNull();
    const total = (await PolicyService.list(svc(ctx.db, user.principal), ALL, {})).total;
    const db = await ctx.db.select({ id: policies.id }).from(policies).where(sql`(${policies.insurerId} = ${DEMO.org.insurerA}) and ${policies.deletedAt} is null`);
    expect(total).toBe(db.length);
    // The ordinary reviewer's own view is unaffected.
    expect(who.insurerA.policyId ?? null).toBeNull();
  });
});
