import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { diagnoses, procedures, ruleEvaluations } from "@/db/schema";
import { DEMO } from "@/db/seed/ids";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { EligibilityService } from "@/modules/eligibility/eligibility.service";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
let dx: Record<string, string>;
let px: Record<string, string>;

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  dx = Object.fromEntries((await ctx.db.select().from(diagnoses)).map((d) => [d.code, d.id]));
  px = Object.fromEntries((await ctx.db.select().from(procedures)).map((p) => [p.code, p.id]));
});
afterAll(() => ctx.close());

/** A complete, compliant appendectomy case for patient A1 on the family floater. */
const good = (over: Record<string, unknown> = {}) => ({
  beneficiaryId: DEMO.beneficiary.a1Floater,
  claimType: "cashless",
  diagnosisId: dx.K35,
  procedureId: px.APPENDECTOMY,
  admissionDate: "2026-10-10",
  isAccident: "no",
  pedDeclared: "no",
  pedRelated: "unknown",
  estimatedCost: 100000,
  roomRentPerDay: 4000,
  ...over,
});
const result = (e: Awaited<ReturnType<typeof EligibilityService.check>>, kind: string) => e.evaluation.results.find((r) => r.kind === kind)!;

describe("eligibility checker (spec scenarios)", () => {
  it("active policy, complete information → Eligible, and the check is recorded", async () => {
    const e = await EligibilityService.check(as("staffA"), good());
    expect(e.evaluation.results.filter((r) => r.outcome !== "PASS")).toEqual([]);
    expect(e.evaluation.overall).toBe("PASS");
    expect(e.evaluation.preauthRequired).toBe(true);
    const [row] = await ctx.db.select().from(ruleEvaluations).where(eq(ruleEvaluations.id, e.evaluationId!));
    expect(row).toMatchObject({ subjectType: "eligibility_check", subjectId: DEMO.beneficiary.a1Floater, policyId: DEMO.policy.aarogyaFloater, overallResult: "PASS" });
  });

  it("expired policy → Not eligible", async () => {
    const e = await EligibilityService.check(as("staffB"), { ...good(), beneficiaryId: DEMO.beneficiary.b1Senior, procedureId: px["CATARACT-PHACO"], diagnosisId: dx.H25 });
    expect(result(e, "cover_active").outcome).toBe("FAIL");
    expect(e.evaluation.overall).toBe("FAIL");
  });

  it("waiting period → Not eligible (new policy, not an accident)", async () => {
    const e = await EligibilityService.check(as("staffA"), good({ beneficiaryId: DEMO.beneficiary.a2Individual, admissionDate: "2026-10-01", claimType: "reimbursement" }));
    expect(result(e, "initial_waiting").outcome).toBe("FAIL");
  });

  it("PED within its waiting period → Not eligible", async () => {
    const e = await EligibilityService.check(as("staffA"), {
      policyId: DEMO.policy.aarogyaFloater, dob: "1980-05-05", relationship: "self", coverStart: "2026-01-01", coverEnd: "2026-12-31", inceptionDate: "2025-01-01",
      sumInsured: 500000, availableBalance: 500000, ...good({ beneficiaryId: undefined, pedDeclared: "yes", pedRelated: "yes" }),
    });
    expect(result(e, "ped_waiting").outcome).toBe("FAIL");
  });

  it("exclusion → Not eligible", async () => {
    const e = await EligibilityService.check(as("staffA"), good({ diagnosisId: dx["Z41.1"] }));
    expect(e.evaluation.results.find((r) => r.kind === "excluded_diagnoses" && r.outcome === "FAIL")).toBeTruthy();
    expect(e.evaluation.overall).toBe("FAIL");
  });

  it("insufficient coverage → sum insured check fails with the shortfall", async () => {
    const e = await EligibilityService.check(as("staffA"), good({ estimatedCost: 600000 }));
    const r = result(e, "sum_insured");
    expect(r.outcome).toBe("FAIL");
    expect(r.data?.shortfall).toBe(150000);
  });

  it("hospital not in network → cashless not eligible", async () => {
    // Patient A2's insurer (B) is non-network at hospital A.
    const e = await EligibilityService.check(as("staffA"), good({ beneficiaryId: DEMO.beneficiary.a2Individual }));
    expect(result(e, "hospital_network").outcome).toBe("FAIL");
  });

  it("government scheme at an empanelled hospital is checked with the scheme's own rules", async () => {
    const e = await EligibilityService.check(as("staffB"), good({ beneficiaryId: DEMO.beneficiary.b1Cghs, procedureId: px["CATARACT-PHACO"], diagnosisId: dx.H25, estimatedCost: 20000, roomRentPerDay: undefined }));
    expect(e.policy.category).toBe("government");
    expect(result(e, "hospital_network").outcome).toBe("PASS");
    // Scheme rules have no cataract waiting period (private-policy rules are never applied).
    expect(e.evaluation.results.some((r) => r.kind === "specific_waiting")).toBe(false);
  });

  it("insufficient information → Needs verification, never Eligible", async () => {
    const e = await EligibilityService.check(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, claimType: "cashless" });
    expect(e.evaluation.overall).toBe("NEEDS_VERIFICATION");
    expect(e.evaluation.missingInformation).toEqual(expect.arrayContaining(["Expected admission date", "Treatment / procedure", "Diagnosis (ICD code)", "Estimated treatment cost"]));
  });

  it("manual entry with nothing but a policy is never Eligible", async () => {
    const e = await EligibilityService.check(as("staffA"), { policyId: DEMO.policy.surakshaIndividual, claimType: "cashless" });
    expect(e.evaluation.overall).not.toBe("PASS");
  });
});

describe("eligibility access control", () => {
  it("another hospital can't check a patient's recorded coverage", async () => {
    await expect(EligibilityService.check(as("staffB"), good())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("insurers, patients and read-only users can't run hospital eligibility checks", async () => {
    for (const k of ["insurerA", "patientA1", "readOnly"] as const) {
      await expect(EligibilityService.check(as(k), good())).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("the check always uses the caller's own hospital (a sent hospitalId is ignored)", async () => {
    const e = await EligibilityService.check(as("staffA"), good({ hospitalId: DEMO.org.hospitalC }));
    expect(e.hospital.id).toBe(DEMO.org.hospitalA);
    const [row] = await ctx.db.select().from(ruleEvaluations).where(and(eq(ruleEvaluations.id, e.evaluationId!)));
    expect(row!.organizationId).toBe(DEMO.org.hospitalA);
  });
});
