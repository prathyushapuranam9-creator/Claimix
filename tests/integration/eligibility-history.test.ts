import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { diagnoses, procedures, ruleEvaluations } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { EligibilityService } from "@/modules/eligibility/eligibility.service";
import { freshFloaterPatient, useTempStorage } from "./fixtures";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
let dx: Record<string, string>;
let px: Record<string, string>;

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  dx = Object.fromEntries((await ctx.db.select().from(diagnoses)).map((d) => [d.code, d.id]));
  px = Object.fromEntries((await ctx.db.select().from(procedures)).map((p) => [p.code, p.id]));
});
afterAll(() => ctx.close());

const complete = (beneficiaryId: string) => ({
  beneficiaryId, claimType: "cashless", diagnosisId: dx.K35, procedureId: px.APPENDECTOMY, admissionDate: "2026-10-10",
  isAccident: "no", pedDeclared: "no", pedRelated: "unknown", estimatedCost: 100000, roomRentPerDay: 4000,
});

const evaluationCount = async (beneficiaryId: string) => (await ctx.db.select({ n: count() }).from(ruleEvaluations).where(eq(ruleEvaluations.subjectId, beneficiaryId)))[0]!.n;

describe("eligibility history (recorded checks are readable again)", () => {
  it("returns every recorded check newest first, with the stored result, without running or recording anything", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    expect(await EligibilityService.history(as("deskA"), coverage.id)).toEqual([]);

    const first = await EligibilityService.check(as("deskA"), { beneficiaryId: coverage.id, claimType: "cashless" });
    const second = await EligibilityService.check(as("deskA"), complete(coverage.id));
    expect(await evaluationCount(coverage.id)).toBe(2);

    const history = await EligibilityService.history(as("deskA"), coverage.id);
    expect(history.map((h) => h.id)).toEqual([second.evaluationId, first.evaluationId]);
    expect(history[0]).toMatchObject({ overall: second.evaluation.overall, case: { claimType: "cashless", admissionDate: "2026-10-10", diagnosisCode: "K35" } });
    expect(history[0]!.evaluation).toEqual(second.evaluation);
    expect(history[1]!.evaluation).toEqual(first.evaluation);
    expect(history[0]!.checkedBy).toBeTruthy();

    // Reading it again (a refresh, returning to the page) never creates another evaluation.
    await EligibilityService.history(as("deskA"), coverage.id);
    await EligibilityService.latestChecks(as("deskA"), [coverage.id]);
    expect(await evaluationCount(coverage.id)).toBe(2);
  });

  it("latestChecks reports the newest check per coverage", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    expect((await EligibilityService.latestChecks(as("deskA"), [coverage.id])).size).toBe(0);
    await EligibilityService.check(as("deskA"), { beneficiaryId: coverage.id, claimType: "cashless" });
    const latest = await EligibilityService.check(as("deskA"), complete(coverage.id));
    const m = await EligibilityService.latestChecks(as("deskA"), [coverage.id]);
    expect(m.get(coverage.id)?.id).toBe(latest.evaluationId);
  });

  it("another hospital cannot read the history; users without the check permission cannot either", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    await EligibilityService.check(as("deskA"), complete(coverage.id));
    await expect(EligibilityService.history(as("deskB"), coverage.id)).rejects.toBeInstanceOf(NotFoundError);
    for (const k of ["insurerA", "tpaA", "patientA1", "readOnly"] as const) {
      await expect(EligibilityService.history(as(k), coverage.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await EligibilityService.latestChecks(as("insurerA"), [coverage.id])).size).toBe(0);
    // A platform administrator may read it.
    expect((await EligibilityService.history(as("admin"), coverage.id)).length).toBe(1);
  });

  it("only shows checks run by the viewer's own organization", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    await EligibilityService.check(as("admin"), { ...complete(coverage.id), hospitalId: who.deskA.organizationId });
    expect(await EligibilityService.history(as("deskA"), coverage.id)).toEqual([]);
    expect((await EligibilityService.history(as("admin"), coverage.id)).length).toBe(1);
  });
});
