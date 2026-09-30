import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, diagnoses, notifications, payerResponses, preAuthorizations, procedures, queries, rejectionReasons, statusHistory, users } from "@/db/schema";
import { DEMO } from "@/db/seed/ids";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { DocumentService } from "@/modules/documents/documents.service";
import { localStorageAdapter, setStorageForTests } from "@/modules/documents/storage";
import { CHECKLIST } from "@/modules/preauth/preauth.checklist";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
let dx: Record<string, string>;
let px: Record<string, string>;
let reason: Record<string, string>;

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const file = (name = "doc.pdf", bytes = PDF) => ({ name, size: bytes.length, bytes });
const MANUAL = CHECKLIST.filter((c) => c.source.type === "manual").map((c) => c.key);
const PREAUTH_DOCS = ["id_proof", "insurance_card", "doctor_consultation", "investigation_reports", "treatment_estimate"];

beforeAll(async () => {
  setStorageForTests(localStorageAdapter(mkdtempSync(path.join(tmpdir(), "claimix-docs-"))));
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  dx = Object.fromEntries((await ctx.db.select().from(diagnoses)).map((d) => [d.code, d.id]));
  px = Object.fromEntries((await ctx.db.select().from(procedures)).map((p) => [p.code, p.id]));
  reason = Object.fromEntries((await ctx.db.select().from(rejectionReasons)).map((r) => [r.code, r.id]));
});
afterAll(async () => {
  setStorageForTests(undefined);
  await ctx.close();
});

const details = (over: Record<string, unknown> = {}) => ({
  claimType: "cashless", diagnosisId: dx.K35, procedureId: px.APPENDECTOMY, admissionDate: "2026-10-12", isAccident: "no", pedDeclared: "no", pedRelated: "unknown",
  estimatedCost: 120000, expectedInsuranceAmount: 120000, roomRentPerDay: 4000, expectedStayDays: 3, doctorName: "Dr Demo", ...over,
});

/** A draft for patient A1 with all documents, checks run and manual items confirmed. */
async function readyDraft(over: Record<string, unknown> = {}, beneficiaryId: string = DEMO.beneficiary.a1Floater, who_: "staffA" | "staffB" = "staffA") {
  const p = await PreauthService.create(as(who_), { beneficiaryId, ...details(over) });
  for (const t of PREAUTH_DOCS) await DocumentService.upload(as(who_), { subjectType: "preauth", subjectId: p.id, docType: t, file: file(`${t}.pdf`) });
  await PreauthService.runChecks(as(who_), p.id);
  for (const key of MANUAL) await PreauthService.confirmItem(as(who_), p.id, { key, confirmed: true });
  return p;
}

describe("creating and preparing a pre-auth", () => {
  it("creates a draft with a timeline entry; the policy's payer is copied from the coverage", async () => {
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() });
    expect(p).toMatchObject({ status: "draft", hospitalId: DEMO.org.hospitalA, insurerId: DEMO.org.insurerA, tpaId: DEMO.org.tpaA, patientId: DEMO.patient.a1 });
    const h = await ctx.db.select().from(statusHistory).where(eq(statusHistory.subjectId, p.id));
    expect(h.map((x) => x.toStatus)).toEqual(["draft"]);
  });

  it("only the patient's own hospital can raise it; payers, patients and admins can't", async () => {
    await expect(PreauthService.create(as("staffB"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() })).rejects.toBeInstanceOf(NotFoundError);
    for (const k of ["insurerA", "patientA1", "admin"] as const) {
      await expect(PreauthService.create(as(k), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("submit button is enforced server-side: an unchecked draft is refused", async () => {
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() });
    const err = await PreauthService.submit(as("staffA"), p.id, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Required documents uploaded/);
    expect((await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, p.id)))[0]!.status).toBe("draft");
  });

  it("drafts are invisible to payers", async () => {
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() });
    await expect(PreauthService.workspace(as("insurerA"), p.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PreauthService.workspace(as("tpaA"), p.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rule-based items can't be ticked manually; items needing verification need a note", async () => {
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details({ pedDeclared: "yes", pedRelated: "unknown" }) });
    await PreauthService.runChecks(as("staffA"), p.id);
    await expect(PreauthService.confirmItem(as("staffA"), p.id, { key: "policy_active", confirmed: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(PreauthService.confirmItem(as("staffA"), p.id, { key: "ped", confirmed: true })).rejects.toBeInstanceOf(ValidationError);
    await PreauthService.confirmItem(as("staffA"), p.id, { key: "ped", confirmed: true, note: "Confirmed with TPA desk, ref 12345" });
  });
});

describe("pre-auth status transitions", () => {
  it("submit → query → respond → approve → final approve, with timeline, audit, payer responses and notifications", async () => {
    const p = await readyDraft();
    await PreauthService.submit(as("staffA"), p.id, {});

    // Payer notified; hospital can't decide; other insurer can't see it.
    const [insurerUser] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, "insurer.a@demo.claimix.invalid"));
    const n = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, insurerUser!.id), eq(notifications.resourceId, p.id)));
    expect(n.map((x) => x.kind)).toContain("preauth.submitted");
    await expect(PreauthService.decide(as("staffA"), p.id, { to: "approved", amount: 120000 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PreauthService.decide(as("insurerB"), p.id, { to: "approved", amount: 120000 })).rejects.toBeInstanceOf(NotFoundError);

    await PreauthService.decide(as("tpaA"), p.id, { to: "pending" });
    await PreauthService.decide(as("tpaA"), p.id, { to: "query", reasonId: reason.insufficient_medical_info, message: "Please send the ultrasound report.", requiredDocuments: ["ultrasound"] });
    expect(await ctx.db.select().from(queries).where(and(eq(queries.subjectId, p.id), eq(queries.status, "open")))).toHaveLength(1);

    await PreauthService.respondToQuery(as("staffA"), p.id, { message: "Ultrasound report uploaded as requested." });
    await PreauthService.decide(as("insurerA"), p.id, { to: "approved", amount: 120000 });
    await PreauthService.decide(as("insurerA"), p.id, { to: "final_approved", amount: 110000 });

    const h = await ctx.db.select().from(statusHistory).where(eq(statusHistory.subjectId, p.id)).orderBy(statusHistory.createdAt);
    expect(h.map((x) => x.toStatus)).toEqual(["draft", "submitted", "pending", "query", "submitted", "approved", "final_approved"]);
    const q = h.find((x) => x.toStatus === "query")!;
    expect(q).toMatchObject({ reason: "Insufficient medical information", requiredDocuments: ["Ultrasound"], responsibleTeam: "Hospital insurance desk" });
    const pr = await ctx.db.select().from(payerResponses).where(eq(payerResponses.subjectId, p.id));
    expect(pr.map((x) => x.decision).sort()).toEqual(["approved", "approved", "query"]);
    const audits = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceType, "preauth"), eq(auditLogs.resourceId, p.id)));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["preauth.created", "preauth.submitted", "preauth.query", "preauth.resubmitted", "preauth.approved", "preauth.final_approved"]));
  });

  it("partial approval must be lower than requested; full approval can't be lower", async () => {
    const p = await readyDraft();
    await PreauthService.submit(as("staffA"), p.id, {});
    await expect(PreauthService.decide(as("insurerA"), p.id, { to: "approved", amount: 90000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(PreauthService.decide(as("insurerA"), p.id, { to: "partially_approved", amount: 120000, message: "Room upgrade not covered." })).rejects.toBeInstanceOf(ValidationError);
    const r = await PreauthService.decide(as("insurerA"), p.id, { to: "partially_approved", amount: 90000, message: "Room upgrade not covered." });
    expect(r.approvedAmount).toBe("90000.00");
  });

  it("rejection requires a reason and always records the payer response", async () => {
    const p = await readyDraft();
    await PreauthService.submit(as("staffA"), p.id, {});
    await expect(PreauthService.decide(as("insurerA"), p.id, { to: "rejected", message: "Not covered at all." })).rejects.toBeInstanceOf(ValidationError);
    await PreauthService.decide(as("insurerA"), p.id, { to: "rejected", reasonId: reason.exclusion, message: "Treatment falls under exclusions." });
    // Invariant across the whole database: no rejected pre-auth without a rejected payer response.
    const orphans = await ctx.db.execute(sql`
      select p.id from pre_authorizations p where p.status = 'rejected'
      and not exists (select 1 from payer_responses r where r.subject_type = 'preauth' and r.subject_id = p.id and r.decision = 'rejected')`);
    expect(orphans).toHaveLength(0);
    // Terminal: nothing can move it any more.
    await expect(PreauthService.decide(as("insurerA"), p.id, { to: "approved", amount: 120000 })).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(PreauthService.cancel(as("staffA"), p.id, { message: "Patient discharged" })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("invalid transitions are refused server-side", async () => {
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() });
    await expect(PreauthService.respondToQuery(as("staffA"), p.id, { message: "Nothing was asked yet here." })).rejects.toBeInstanceOf(InvalidTransitionError);
    await PreauthService.cancel(as("staffA"), p.id, { message: "Duplicate request" });
    await expect(PreauthService.submit(as("staffA"), p.id, {})).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(PreauthService.update(as("staffA"), p.id, details())).rejects.toBeInstanceOf(ConflictError);
  });

  it("failed eligibility checks need a recorded override reason to submit", async () => {
    // Patient A2's insurer is non-network at hospital A, and the policy is in its waiting period.
    const p = await readyDraft({ admissionDate: "2026-10-05" }, DEMO.beneficiary.a2Individual);
    const err = await PreauthService.submit(as("staffA"), p.id, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toHaveProperty("overrideReason");
    await PreauthService.submit(as("staffA"), p.id, { overrideReason: "Patient insists; insurer to decide on emergency grounds." });
    const a = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, p.id), eq(auditLogs.action, "preauth.submitted_with_failed_checks")));
    expect(a).toHaveLength(1);
  });

  it("government scheme: hospital scheme desk records the scheme's decision with its reference", async () => {
    const p = await readyDraft({ procedureId: px["CATARACT-PHACO"], diagnosisId: dx.H25, estimatedCost: 15000, expectedInsuranceAmount: 15000, roomRentPerDay: undefined }, DEMO.beneficiary.b1Cghs, "staffB");
    await PreauthService.submit(as("staffB"), p.id, {}).catch(async () => {
      // Scheme documents differ (beneficiary ID, clinical notes); add them and retry.
      for (const t of ["beneficiary_id", "clinical_notes"]) await DocumentService.upload(as("staffB"), { subjectType: "preauth", subjectId: p.id, docType: t, file: file() });
      await PreauthService.submit(as("staffB"), p.id, {});
    });
    await expect(PreauthService.decide(as("staffB"), p.id, { to: "approved", amount: 15000 })).rejects.toBeInstanceOf(ValidationError);
    const r = await PreauthService.decide(as("staffB"), p.id, { to: "approved", amount: 15000, payerReference: "CGHS-DEMO-778" });
    expect(r.status).toBe("approved");
    const [pr] = await ctx.db.select().from(payerResponses).where(eq(payerResponses.subjectId, p.id));
    expect(pr!.payerReference).toBe("CGHS-DEMO-778");
  });

  it("hospitals can't record decisions on private-insurer requests (only schemes)", async () => {
    const p = await readyDraft();
    await PreauthService.submit(as("staffA"), p.id, {});
    await expect(PreauthService.decide(as("staffA"), p.id, { to: "approved", amount: 120000, payerReference: "FAKE" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("documents", () => {
  it("rejects spoofed and infected files, and records the blocked attempt", async () => {
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() });
    await expect(DocumentService.upload(as("staffA"), { subjectType: "preauth", subjectId: p.id, docType: "id_proof", file: file("id.pdf", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) })).rejects.toBeInstanceOf(ValidationError);
    const eicar = new TextEncoder().encode("%PDF-1.4 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    await expect(DocumentService.upload(as("staffA"), { subjectType: "preauth", subjectId: p.id, docType: "id_proof", file: file("id.pdf", eicar) })).rejects.toBeInstanceOf(ValidationError);
    const blocked = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, p.id), eq(auditLogs.action, "document.upload_blocked")));
    expect(blocked).toHaveLength(1);
  });

  it("other hospitals, payers and patients can't upload to someone else's request", async () => {
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, ...details() });
    await expect(DocumentService.upload(as("staffB"), { subjectType: "preauth", subjectId: p.id, docType: "id_proof", file: file() })).rejects.toBeInstanceOf(NotFoundError);
    for (const k of ["insurerA", "patientA1"] as const) {
      await expect(DocumentService.upload(as(k), { subjectType: "preauth", subjectId: p.id, docType: "id_proof", file: file() })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("download is scoped: owner hospital, assigned payer (after submit) and the patient only", async () => {
    const p = await readyDraft();
    const [doc] = (await DocumentService.forPreauth(as("staffA"), p.id)).slice(-1);
    await expect(DocumentService.download(as("insurerA"), doc!.id)).rejects.toBeInstanceOf(NotFoundError); // still a draft
    await PreauthService.submit(as("staffA"), p.id, {});
    expect((await DocumentService.download(as("insurerA"), doc!.id)).bytes.length).toBe(PDF.length);
    expect((await DocumentService.download(as("patientA1"), doc!.id)).mimeType).toBe("application/pdf");
    for (const k of ["insurerB", "staffB", "patientA2"] as const) {
      await expect(DocumentService.download(as(k), doc!.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(DocumentService.download(as("readOnly"), doc!.id)).rejects.toBeInstanceOf(ForbiddenError);
    const access = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, doc!.id), eq(auditLogs.action, "document.accessed")));
    expect(access.length).toBeGreaterThanOrEqual(2);
  });

  it("uploading to a draft invalidates its rules check; after submission the submitted evaluation is kept", async () => {
    const p = await readyDraft();
    await DocumentService.upload(as("staffA"), { subjectType: "preauth", subjectId: p.id, docType: "medical_history", file: file() });
    const [row] = await ctx.db.select().from(preAuthorizations).where(inArray(preAuthorizations.id, [p.id]));
    expect(row!.latestEvaluationId).toBeNull();

    await PreauthService.submit(as("staffA"), p.id, {});
    await DocumentService.upload(as("staffA"), { subjectType: "preauth", subjectId: p.id, docType: "ultrasound", file: file() });
    const [after] = await ctx.db.select().from(preAuthorizations).where(inArray(preAuthorizations.id, [p.id]));
    expect(after!.latestEvaluationId).not.toBeNull();
  });
});

describe("pre-auth visibility", () => {
  it("patients see only their own requests; other hospitals see nothing", async () => {
    const p = await readyDraft();
    await PreauthService.submit(as("staffA"), p.id, {});
    await expect(PreauthService.workspace(as("patientA1"), p.id)).resolves.toBeTruthy();
    for (const k of ["patientA2", "staffB", "insurerB"] as const) await expect(PreauthService.workspace(as(k), p.id)).rejects.toBeInstanceOf(NotFoundError);
    const w = await PreauthService.workspace(as("patientA1"), p.id);
    expect(w.can).toMatchObject({ edit: false, submit: false, decide: [] });
  });
});
