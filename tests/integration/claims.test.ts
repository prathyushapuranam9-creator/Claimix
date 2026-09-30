import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, beneficiaries, claims, preAuthorizations, settlements } from "@/db/schema";
import { DEMO } from "@/db/seed/ids";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { CLAIM_CHECKLIST } from "@/modules/claims/claims.checklist";
import { ClaimService } from "@/modules/claims/claims.service";
import { DocumentService } from "@/modules/documents/documents.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { approvedPreauth, codes, file, freshFloaterPatient, useTempStorage } from "./fixtures";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const CLAIM_DOCS = ["final_bill", "discharge_summary", "pharmacy_bills"];
const MANUAL = CLAIM_CHECKLIST.filter((x) => x.source.type === "manual").map((x) => x.key);

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(async () => {
  setStorageForTests(undefined);
  await ctx.close();
});

const bill = (over: Record<string, unknown> = {}) => ({ admissionDate: "2026-09-20", dischargeDate: "2026-09-23", billNumber: "BILL-001", claimedAmount: 90000, ...over });

/** A cashless claim ready to submit: documents uploaded, checks run, manual items confirmed. */
async function readyClaim(amount = 90000) {
  const { preauth, coverage } = await approvedPreauth(ctx.db, who, c, 100000);
  const claim = await ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, ...bill({ claimedAmount: amount }) });
  for (const t of CLAIM_DOCS) await DocumentService.upload(as("staffA"), { subjectType: "claim", subjectId: claim.id, docType: t, file: file() });
  await ClaimService.runChecks(as("staffA"), claim.id);
  for (const key of MANUAL) await ClaimService.confirmItem(as("staffA"), claim.id, { key, confirmed: true });
  return { claim, preauth, coverage };
}

describe("creating claims", () => {
  it("cashless claim from an approved pre-auth copies patient, policy and payer; one live claim per pre-auth", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const claim = await ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, ...bill() });
    expect(claim).toMatchObject({ status: "draft", claimType: "cashless", preAuthId: preauth.id, insurerId: DEMO.org.insurerA, tpaId: DEMO.org.tpaA, diagnosisId: c.dx.K35 });
    await expect(ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, ...bill() })).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses cashless claims without an approved pre-auth, and from other hospitals or payers", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.staffA);
    const draft = await PreauthService.create(as("staffA"), { beneficiaryId: coverage.id, claimType: "cashless" });
    await expect(ClaimService.createCashless(as("staffA"), { preAuthId: draft.id, ...bill() })).rejects.toBeInstanceOf(ValidationError);
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    await expect(ClaimService.createCashless(as("staffB"), { preAuthId: preauth.id, ...bill() })).rejects.toBeInstanceOf(NotFoundError);
    for (const k of ["insurerA", "patientA1", "admin"] as const) {
      await expect(ClaimService.createCashless(as(k), { preAuthId: preauth.id, ...bill() })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("validates dates and amounts", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    await expect(ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, ...bill({ dischargeDate: "2026-09-10" }) })).rejects.toBeInstanceOf(ValidationError);
    await expect(ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, ...bill({ claimedAmount: -5 }) })).rejects.toBeInstanceOf(ValidationError);
    await expect(ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, ...bill({ dischargeDate: "2099-01-01" }) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("reimbursement claims need no pre-auth", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.staffA);
    const claim = await ClaimService.createReimbursement(as("staffA"), { beneficiaryId: coverage.id, diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, ...bill() });
    expect(claim).toMatchObject({ claimType: "reimbursement", preAuthId: null });
  });
});

describe("claim lifecycle", () => {
  it("submission is enforced server-side: missing claim documents block it", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const claim = await ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, ...bill() });
    for (const key of MANUAL) await ClaimService.confirmItem(as("staffA"), claim.id, { key, confirmed: true });
    const err = await ClaimService.submit(as("staffA"), claim.id, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Final claim documents uploaded/);
  });

  it("submit → partial approval → settlement: patient share, pre-auth sync, balance reduced", async () => {
    const { claim, preauth, coverage } = await readyClaim(90000);
    await ClaimService.submit(as("staffA"), claim.id, {});
    // Drafts and other payers
    await expect(ClaimService.workspace(as("insurerB"), claim.id)).rejects.toBeInstanceOf(NotFoundError);

    await expect(ClaimService.decide(as("insurerA"), claim.id, { to: "approved", amount: 80000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(ClaimService.decide(as("insurerA"), claim.id, { to: "partially_approved", amount: 90000, message: "Consumables not payable." })).rejects.toBeInstanceOf(ValidationError);
    const decided = await ClaimService.decide(as("tpaA"), claim.id, { to: "partially_approved", amount: 80000, message: "Consumables and registration are non-payable." });
    expect(decided).toMatchObject({ status: "partially_approved", approvedAmount: "80000.00", patientAmount: "10000.00" });
    const [pre] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, preauth.id));
    expect(pre).toMatchObject({ status: "final_approved", approvedAmount: "80000.00" });

    // TPAs assess but don't pay.
    await expect(ClaimService.settle(as("tpaA"), claim.id, { amount: 80000, utr: "UTR123456", settledAt: "2026-09-29" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ClaimService.settle(as("insurerA"), claim.id, { amount: 85000, utr: "UTR123456", settledAt: "2026-09-29" })).rejects.toBeInstanceOf(ValidationError);
    await expect(ClaimService.settle(as("insurerA"), claim.id, { amount: 78000, utr: "UTR123456", settledAt: "2026-09-29" })).rejects.toBeInstanceOf(ValidationError);
    const settled = await ClaimService.settle(as("insurerA"), claim.id, { amount: 78000, utr: "UTR123456", settledAt: "2026-09-29", deductionNote: "TDS deducted at source as per rules." });
    expect(settled.status).toBe("settled");

    const [s] = await ctx.db.select().from(settlements).where(eq(settlements.claimId, claim.id));
    expect(s).toMatchObject({ status: "paid", amount: "78000.00", payee: "hospital", utr: "UTR123456" });
    const [b] = await ctx.db.select().from(beneficiaries).where(eq(beneficiaries.id, coverage.id));
    expect(b!.sumInsuredAvailable).toBe("322000.00");
    const [pre2] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, preauth.id));
    expect(pre2!.status).toBe("settled");
    const audits = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceType, "claim"), eq(auditLogs.resourceId, claim.id)));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["claim.created", "claim.submitted", "claim.partially_approved", "settlement.recorded", "claim.settled"]));
    // Terminal.
    await expect(ClaimService.decide(as("insurerA"), claim.id, { to: "rejected", reasonId: c.reason.exclusion, message: "Changed our minds later." })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("query → respond → approve in full; approval can't exceed the available balance", async () => {
    const { claim } = await readyClaim(90000);
    await ClaimService.submit(as("staffA"), claim.id, {});
    await ClaimService.decide(as("insurerA"), claim.id, { to: "query", reasonId: c.reason.non_medical_expenses, message: "Please send an itemised pharmacy bill.", requiredDocuments: ["pharmacy_bills"] });
    await expect(ClaimService.submit(as("staffA"), claim.id, {})).rejects.toBeInstanceOf(InvalidTransitionError);
    await ClaimService.respondToQuery(as("staffA"), claim.id, { message: "Itemised pharmacy bill uploaded." });
    const r = await ClaimService.decide(as("insurerA"), claim.id, { to: "approved", amount: 90000 });
    expect(r).toMatchObject({ status: "approved", patientAmount: "0.00" });
  });

  it("rejection needs a reason and records the payer response", async () => {
    const { claim } = await readyClaim();
    await ClaimService.submit(as("staffA"), claim.id, {});
    await expect(ClaimService.decide(as("insurerA"), claim.id, { to: "rejected", message: "Not payable." })).rejects.toBeInstanceOf(ValidationError);
    await ClaimService.decide(as("insurerA"), claim.id, { to: "rejected", reasonId: c.reason.treatment_mismatch, message: "Treatment differs from what was authorized." });
    const w = await ClaimService.workspace(as("staffA"), claim.id);
    expect(w.payerResponses[0]).toMatchObject({ decision: "rejected", reasonTitle: "Treatment mismatch" });
    expect(w.payerResponses[0]!.reasonAction).toBeTruthy();
  });

  it("hospitals can't record decisions on private-insurer claims", async () => {
    const { claim } = await readyClaim();
    await ClaimService.submit(as("staffA"), claim.id, {});
    await expect(ClaimService.decide(as("staffA"), claim.id, { to: "approved", amount: 90000, payerReference: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ClaimService.settle(as("staffA"), claim.id, { amount: 1, utr: "UTR000001", settledAt: "2026-09-29" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("database invariants (defence in depth)", () => {
  it("a claim can't be marked rejected without a payer rejection, or settled without a paid settlement", async () => {
    const { claim } = await readyClaim();
    await expect(ctx.db.update(claims).set({ status: "rejected" }).where(eq(claims.id, claim.id))).rejects.toThrow();
    await expect(ctx.db.update(claims).set({ status: "settled" }).where(eq(claims.id, claim.id))).rejects.toThrow();
    const orphans = await ctx.db.execute(sql`
      select c.id from claims c where c.status = 'rejected'
      and not exists (select 1 from payer_responses r where r.subject_type = 'claim' and r.subject_id = c.id and r.decision = 'rejected')`);
    expect(orphans).toHaveLength(0);
  });

  it("recorded settlements can't be altered or deleted", async () => {
    const [s] = await ctx.db.select().from(settlements).limit(1);
    expect(s).toBeTruthy();
    await expect(ctx.db.update(settlements).set({ amount: "1.00" }).where(eq(settlements.id, s!.id))).rejects.toThrow();
    await expect(ctx.db.delete(settlements).where(eq(settlements.id, s!.id))).rejects.toThrow();
  });
});

describe("claim visibility, export and documents", () => {
  it("patients see only their own claims; other hospitals nothing", async () => {
    const { claim } = await readyClaim();
    await ClaimService.submit(as("staffA"), claim.id, {});
    for (const k of ["patientA1", "patientA2", "staffB", "insurerB"] as const) await expect(ClaimService.workspace(as(k), claim.id)).rejects.toBeInstanceOf(NotFoundError);
    const list = await ClaimService.list(as("patientA1"), { page: 1, pageSize: 100 }, {});
    expect(list.rows.every((r) => r.patientName === "Demo Patient Anil")).toBe(true);
  });

  it("export returns only the caller's scoped claims and is audited; read-only users can't export", async () => {
    const a = await ClaimService.exportRows(as("insurerA"), {}, {});
    const b = await ClaimService.exportRows(as("insurerB"), {}, {});
    const idsA = new Set(a.rows.map((r) => r.id));
    expect(b.rows.some((r) => idsA.has(r.id))).toBe(false);
    expect(a.rows.every((r) => r.insurerName?.startsWith("Aarogya"))).toBe(true);
    const staffB = await ClaimService.exportRows(as("staffB"), {}, {});
    expect(staffB.rows.every((r) => r.hospitalName?.startsWith("Lakeview"))).toBe(true);
    await expect(ClaimService.exportRows(as("readOnly"), {}, {})).rejects.toBeInstanceOf(ForbiddenError);
    const logged = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "claim.exported"), eq(auditLogs.actorUserId, who.insurerA.userId)));
    expect(logged.length).toBeGreaterThan(0);
  });

  it("claim documents follow the claim's scope", async () => {
    const { claim } = await readyClaim();
    const [doc] = (await ClaimService.workspace(as("staffA"), claim.id)).documents;
    await expect(DocumentService.download(as("insurerA"), doc!.id)).rejects.toBeInstanceOf(NotFoundError); // draft
    await ClaimService.submit(as("staffA"), claim.id, {});
    await expect(DocumentService.download(as("insurerA"), doc!.id)).resolves.toBeTruthy();
    await expect(DocumentService.download(as("insurerB"), doc!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
