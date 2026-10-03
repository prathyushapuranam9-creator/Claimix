import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { beneficiaries, policies } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { EligibilityService } from "@/modules/eligibility/eligibility.service";
import { PatientEligibilityService } from "@/modules/eligibility/patient-eligibility.service";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);

const coverageOf = async (patientId: string) => {
  const [row] = await ctx.db.select({ id: beneficiaries.id }).from(beneficiaries).where(and(eq(beneficiaries.patientId, patientId), isNull(beneficiaries.deletedAt))).limit(1);
  return row!.id;
};

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

describe("patient profile eligibility check", () => {
  it("checks the selected patient's own coverage and returns real record values", async () => {
    const cov = await coverageOf(DEMO.patient.a1);
    const r = await PatientEligibilityService.check(as("staffA"), DEMO.patient.a1, cov);
    expect(r.patientId).toBe(DEMO.patient.a1);
    expect(r.beneficiaryId).toBe(cov);
    expect(["eligible", "not_eligible", "expired", "unable_to_verify"]).toContain(r.status);
    // Missing information never yields "eligible".
    if (r.missingInformation.length > 0) expect(r.status).not.toBe("eligible");
    expect(Number.isNaN(Date.parse(r.checkedAt))).toBe(false);
    // Listed reasons are unique and name their rule (the UI renders them as a keyed list).
    expect(new Set(r.reasons).size).toBe(r.reasons.length);
    for (const reason of r.reasons) expect(reason).toMatch(/^[^:]+: /);
  });

  it("refuses another patient's coverage, even within the same hospital", async () => {
    const otherCov = await coverageOf(DEMO.patient.a2);
    await expect(PatientEligibilityService.check(as("staffA"), DEMO.patient.a1, otherCov)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is refused across organizations and without the eligibility permission", async () => {
    const cov = await coverageOf(DEMO.patient.a1);
    await expect(PatientEligibilityService.check(as("staffB"), DEMO.patient.a1, cov)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PatientEligibilityService.check(as("patientA1"), DEMO.patient.a1, cov)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an insurer reviewer checks only coverage under its own policies", async () => {
    const cov = await coverageOf(DEMO.patient.a1);
    const [row] = await ctx.db.select({ insurerId: policies.insurerId }).from(beneficiaries).innerJoin(policies, eq(policies.id, beneficiaries.policyId)).where(eq(beneficiaries.id, cov));
    expect(row!.insurerId).toBe(DEMO.org.insurerA);
    const r = await PatientEligibilityService.check(as("insurerA"), DEMO.patient.a1, cov);
    expect(r.patientId).toBe(DEMO.patient.a1);
    // Another insurer can never check it (not visible, or not its policy).
    await expect(PatientEligibilityService.check(as("insurerB"), DEMO.patient.a1, cov)).rejects.toSatisfy((e) => e instanceof ForbiddenError || e instanceof NotFoundError);
    // Another insurer's policies are never offered to it.
    expect(PatientEligibilityService.checkable(who.insurerB, [{ insurerId: DEMO.org.insurerA, tpaId: null }])).toEqual([]);
    // The general eligibility checker stays closed to payers.
    await expect(EligibilityService.check(as("insurerA"), { beneficiaryId: cov, claimType: "cashless" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a platform admin checks against the patient's registering hospital", async () => {
    const cov = await coverageOf(DEMO.patient.a1);
    const r = await PatientEligibilityService.check(as("admin"), DEMO.patient.a1, cov);
    expect(r.patientId).toBe(DEMO.patient.a1);
  });
});
