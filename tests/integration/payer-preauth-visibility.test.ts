import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { insurers, notifications, organizations, policies, preAuthorizations, roles, statusHistory, users } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { NotFoundError } from "@/lib/errors";
import { hashPassword, randomToken } from "@/lib/security/crypto";
import { DashboardService } from "@/modules/dashboard/dashboard.service";
import { DocumentService } from "@/modules/documents/documents.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { CHECKLIST } from "@/modules/preauth/preauth.checklist";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { codes, file, freshFloaterPatient, useTempStorage } from "./fixtures";
import { demoPrincipals, principalFor, svc, testContext } from "./helpers";

/**
 * Hospital staff submit a pre-authorization → the insurer / TPA reviewer it belongs to sees it as pending.
 * Covers persistence, the payer association, the reviewer's list and dashboard, and who must NOT see it.
 */
const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const PREAUTH_DOCS = ["id_proof", "insurance_card", "doctor_consultation", "investigation_reports", "treatment_estimate"];
const MANUAL = CHECKLIST.filter((x) => x.source.type === "manual").map((x) => x.key);
const ALL = { page: 1, pageSize: 100 };

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(async () => {
  setStorageForTests(undefined);
  await ctx.close();
});

const details = (coverageId: string) => ({
  beneficiaryId: coverageId, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, admissionDate: "2026-10-20",
  isAccident: "no", pedDeclared: "no", pedRelated: "unknown", estimatedCost: 90000, expectedInsuranceAmount: 90000, roomRentPerDay: 4000,
});

/** A draft, and the same request after hospital staff complete the checks and submit it. */
async function draftFor(coverageId: string) {
  return PreauthService.create(as("deskA"), details(coverageId));
}
async function submit(preauthId: string) {
  for (const t of PREAUTH_DOCS) await DocumentService.upload(as("deskA"), { subjectType: "preauth", subjectId: preauthId, docType: t, file: file() });
  await PreauthService.runChecks(as("deskA"), preauthId);
  for (const key of MANUAL) await PreauthService.confirmItem(as("deskA"), preauthId, { key, confirmed: true });
  return PreauthService.submit(as("deskA"), preauthId, {});
}

const AWAITING = ["submitted", "pending"] as const;
const awaitingCount = async (k: keyof typeof who) => {
  const d = await DashboardService.forCaller(as(k));
  const s = d.preauthStatus as Record<string, number>;
  return { count: AWAITING.reduce((n, st) => n + (s[st] ?? 0), 0), rows: d.actionPreauths.map((r) => r.id), variant: d.variant };
};
const listIds = async (k: keyof typeof who, status?: ("submitted" | "pending")[]) => (await PreauthService.list(as(k), ALL, { status })).rows.map((r) => r.id);

describe("hospital submission → insurer / TPA reviewer", () => {
  it("persists a submitted pre-auth linked to the right patient, hospital, policy, insurer and TPA", async () => {
    const { coverage, patient } = await freshFloaterPatient(ctx.db, who.deskA);
    const draft = await draftFor(coverage.id);
    expect(draft.status).toBe("draft");
    expect(draft.submittedAt).toBeNull();

    const sub = await submit(draft.id);
    const [row] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, draft.id));
    expect(sub.status).toBe("submitted");
    expect(row).toMatchObject({
      status: "submitted",
      hospitalId: DEMO.org.hospitalA,
      patientId: patient.id,
      beneficiaryId: coverage.id,
      policyId: DEMO.policy.aarogyaFloater,
      insurerId: DEMO.org.insurerA,
      tpaId: DEMO.org.tpaA,
      schemeId: null,
    });
    expect(row!.submittedAt).toBeInstanceOf(Date);
    expect(row!.reference).toMatch(/^PA-\d{8}-[A-Z0-9]+$/);

    const [last] = await ctx.db.select().from(statusHistory).where(eq(statusHistory.subjectId, draft.id)).orderBy(desc(statusHistory.createdAt));
    expect(last).toMatchObject({ fromStatus: "draft", toStatus: "submitted", responsibleTeam: "Insurer / TPA review team" });

    // Both payer organizations' reviewers are notified.
    for (const org of [DEMO.org.insurerA, DEMO.org.tpaA]) {
      const n = await ctx.db.select().from(notifications).where(and(eq(notifications.organizationId, org), eq(notifications.resourceId, draft.id)));
      expect(n.map((x) => x.kind)).toContain("preauth.submitted");
    }
  });

  it("the insurer reviewer's dashboard count, awaiting list and full list include it; a draft is invisible until submitted", async () => {
    const before = await awaitingCount("insurerA");
    expect(before.variant).toBe("payer");
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    const draft = await draftFor(coverage.id);

    // A hospital draft is never visible to the payer.
    expect((await awaitingCount("insurerA")).count).toBe(before.count);
    expect(await listIds("insurerA")).not.toContain(draft.id);
    await expect(PreauthService.workspace(as("insurerA"), draft.id)).rejects.toBeInstanceOf(NotFoundError);

    await submit(draft.id);
    const after = await awaitingCount("insurerA");
    expect(after.count).toBe(before.count + 1);
    expect(after.rows).toContain(draft.id); // "Pre-authorizations awaiting decision"
    expect(await listIds("insurerA", ["submitted", "pending"])).toContain(draft.id); // the "Awaiting payer" list view
    expect(await listIds("insurerA")).toContain(draft.id); // the dashboard's "All" (view=all) list
    const ws = await PreauthService.workspace(as("insurerA"), draft.id);
    expect(ws.side).toBe("payer");
    expect(ws.can.decide).toEqual(expect.arrayContaining(["approved", "rejected", "query"]));
  });

  it("the TPA administering the policy sees it too; other insurers, other hospitals and patients do not", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    const draft = await draftFor(coverage.id);
    const tpaBefore = await awaitingCount("tpaA");
    const otherBefore = await awaitingCount("insurerB");
    await submit(draft.id);

    expect(await listIds("tpaA")).toContain(draft.id);
    expect((await awaitingCount("tpaA")).count).toBe(tpaBefore.count + 1);

    expect(await listIds("insurerB")).not.toContain(draft.id);
    expect((await awaitingCount("insurerB")).count).toBe(otherBefore.count);
    expect((await awaitingCount("insurerB")).rows).not.toContain(draft.id);
    await expect(PreauthService.workspace(as("insurerB"), draft.id)).rejects.toBeInstanceOf(NotFoundError);

    expect(await listIds("deskB")).not.toContain(draft.id);
    await expect(PreauthService.workspace(as("deskB"), draft.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listIds("patientA2")).not.toContain(draft.id);
    expect(await listIds("deskA")).toContain(draft.id);
  });

  it("leaves the pending count and awaiting list once decided, but stays in the full list", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    const draft = await draftFor(coverage.id);
    await submit(draft.id);
    const pending = await awaitingCount("insurerA");
    expect(pending.rows).toContain(draft.id);

    await PreauthService.decide(as("insurerA"), draft.id, { to: "approved", amount: 90000 });
    const done = await awaitingCount("insurerA");
    expect(done.count).toBe(pending.count - 1);
    expect(done.rows).not.toContain(draft.id);
    expect(await listIds("insurerA", ["submitted", "pending"])).not.toContain(draft.id);
    expect(await listIds("insurerA")).toContain(draft.id);
  });

  it("a request the hospital cancels after submitting is no longer awaiting a decision", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    const draft = await draftFor(coverage.id);
    await submit(draft.id);
    const pending = await awaitingCount("insurerA");
    await PreauthService.cancel(as("deskA"), draft.id, { message: "Patient chose another hospital" });
    expect((await awaitingCount("insurerA")).count).toBe(pending.count - 1);
  });
});

describe("a payer with no reviewer account", () => {
  /** An insurer organization and policy created the way an administrator would, with no users yet. */
  async function insurerWithoutReviewers() {
    const name = `No Reviewer Insurer ${randomToken(5).replace(/[^a-zA-Z]/g, "x")}`;
    const [org] = await ctx.db.insert(organizations).values({ type: "insurer", name, isDemo: true }).returning();
    await ctx.db.insert(insurers).values({ id: org!.id, code: `NR-${randomToken(5).replace(/[^A-Za-z0-9]/g, "x")}` });
    const [policy] = await ctx.db
      .insert(policies)
      .values({ category: "private", insurerId: org!.id, name: `${name} Policy`, productType: "individual", isDemo: true })
      .returning();
    const p = await PatientService.create(as("deskA"), { fullName: `Orphan Payer ${randomToken(5).replace(/[^a-zA-Z]/g, "x")}`, dob: "1980-01-01", gender: "male" });
    const cov = await CoverageService.add(as("deskA"), p.id, {
      policyId: policy!.id, memberId: `ORPH-${randomToken(6).replace(/[^A-Za-z0-9]/g, "x")}`, relationship: "self", coverStart: "2026-04-01", coverEnd: "2027-03-31", sumInsured: 500000, sumInsuredAvailable: 500000,
    });
    return { org: org!, cov };
  }

  it("hospital staff are told nobody can review the request; adding a Payer Reviewer clears it and makes the request visible to them", async () => {
    const { org, cov } = await insurerWithoutReviewers();
    const draft = await draftFor(cov.id);
    expect((await PreauthService.workspace(as("deskA"), draft.id)).payersWithoutReviewer).toEqual([org.name]);

    // The administrator adds a reviewer for that insurer (the request is submitted by then).
    const [role] = await ctx.db.select().from(roles).where(eq(roles.key, "payer_reviewer"));
    const email = `rev-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "")}@test.claimix.invalid`;
    await ctx.db.insert(users).values({ email, fullName: "New Insurer Reviewer", organizationId: org.id, roleId: role!.id, passwordHash: await hashPassword(ctx.demoPassword), isDemo: true });
    await ctx.db.update(preAuthorizations).set({ status: "submitted", submittedAt: new Date() }).where(eq(preAuthorizations.id, draft.id));

    expect((await PreauthService.workspace(as("deskA"), draft.id)).payersWithoutReviewer).toEqual([]);
    const reviewer = await principalFor(ctx.auth, email, ctx.demoPassword);
    const rc = svc(ctx.db, reviewer);
    const dash = await DashboardService.forCaller(rc);
    expect((dash.preauthStatus as Record<string, number>).submitted).toBe(1);
    expect(dash.actionPreauths.map((r) => r.id)).toEqual([draft.id]);
    expect((await PreauthService.list(rc, ALL, {})).rows.map((r) => r.id)).toEqual([draft.id]);
    // Still only its own: another insurer's reviewer sees nothing of it.
    expect(await listIds("insurerA")).not.toContain(draft.id);
  });

  it("does not warn once the request is decided, and never warns payers or other hospitals", async () => {
    const { cov } = await insurerWithoutReviewers();
    const draft = await draftFor(cov.id);
    await ctx.db.update(preAuthorizations).set({ status: "approved", submittedAt: new Date() }).where(eq(preAuthorizations.id, draft.id));
    expect((await PreauthService.workspace(as("deskA"), draft.id)).payersWithoutReviewer).toEqual([]);
  });
});
