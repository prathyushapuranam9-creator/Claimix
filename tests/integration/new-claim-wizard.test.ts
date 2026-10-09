import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, documents, notifications, patients, preAuthorizations } from "@/db/schema";
import { isValidAadhaar } from "@/lib/india";
import { PatientService } from "@/modules/patients/patients.service";
import { RegistrationService } from "@/modules/preauth/registration.service";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { DocumentService } from "@/modules/documents/documents.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { codes, file, freshFloaterPatient, useTempStorage } from "./fixtures";
import { demoPrincipals, svc, testContext } from "./helpers";

/**
 * New Claim: an insurer reviewer raises a cashless pre-authorization on the hospital's behalf for a member
 * of its own policies. Covers who may raise, KYC against the record, cross-organization isolation, uploads by the
 * raiser, the deterministic scrutiny, acknowledged gaps, audit, the hospital's notifications and maker-checker.
 */
const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(async () => {
  setStorageForTests(undefined);
  await ctx.close();
});

type Fresh = Awaited<ReturnType<typeof freshFloaterPatient>>;

/** KYC as typed from the photo ID and card (matching the record unless overridden). */
const kycFor = (f: Fresh, over: Record<string, unknown> = {}) => ({
  uhid: f.patient.patientNo,
  patientName: f.patient.fullName,
  gender: "female",
  dob: "1982-02-02",
  mobile: "9876500000",
  insurerId: DEMO.org.insurerA,
  tpaId: DEMO.org.tpaA,
  policyNumber: "POL-TEST-001",
  policyFrom: f.coverage.coverStart,
  policyTo: f.coverage.coverEnd,
  sumInsured: 500000,
  memberId: f.coverage.memberId,
  mode: "typed",
  ...over,
});

const pkg = () => ({
  claimType: "cashless",
  treatmentType: "surgical",
  procedureId: c.px.APPENDECTOMY,
  diagnosisIds: [c.dx.K35],
  symptoms: "Right lower abdominal pain for two days with fever.",
  admissionType: "planned",
  admissionDate: "2026-12-20",
  admissionTime: "09:00:00.000",
  dischargeDate: "2026-12-23",
  dischargeTime: "11:00:00.000",
  doctorName: "Dr Test Surgeon",
  department: "General Surgery",
  roomCategory: "Twin sharing",
  chronicIllness: ["None"],
  isAccident: "no",
  pedDeclared: "no",
  pedRelated: "unknown",
  icuDays: 0,
  familyPhysician: "Dr Family",
  costItems: [
    { head: "Room rent", description: "Twin sharing", perDay: 4000, days: 3 },
    { head: "Surgeon / OT charges", perDay: 60000, days: 1 },
  ],
});

async function raised(over: Record<string, unknown> = {}) {
  const f = await freshFloaterPatient(ctx.db, who.deskA);
  const draft = await PreauthService.raise(as("insurerA"), { beneficiaryId: f.coverage.id, kyc: kycFor(f, over) });
  return { ...f, draft };
}

/** Completes every step the way the wizard does (papers for each MUST / EXPECTED row, checks, confirmations). */
async function complete(id: string) {
  await PreauthService.saveClinical(as("insurerA"), id, pkg());
  const w0 = await PreauthService.wizard(as("insurerA"), id);
  for (const r of w0.requirements.filter((x) => x.tier !== "optional")) {
    await DocumentService.upload(as("insurerA"), { subjectType: "preauth", subjectId: id, docType: r.type, file: file() });
  }
  await PreauthService.runChecks(as("insurerA"), id);
  const w1 = await PreauthService.wizard(as("insurerA"), id);
  for (const f of w1.scrutiny.findings.filter((x) => x.confirmItem)) {
    await PreauthService.confirmItem(as("insurerA"), id, { key: f.confirmItem!, confirmed: true, note: f.needsNote ? "Verified with the payer desk by phone today." : undefined });
  }
}

describe("New Claim: who may raise, and for whom", () => {
  it("finds only the reviewer's own members; other insurers and hospital staff can't use it", async () => {
    const f = await freshFloaterPatient(ctx.db, who.deskA);
    const mine = await PreauthService.members(as("insurerA"), f.patient.patientNo);
    expect(mine.find((m) => m.beneficiaryId === f.coverage.id)).toMatchObject({ hospitalId: DEMO.org.hospitalA, insurerId: DEMO.org.insurerA, tpaId: DEMO.org.tpaA });

    expect(await PreauthService.members(as("insurerB"), f.patient.patientNo)).toEqual([]);
    await expect(PreauthService.raise(as("insurerB"), { beneficiaryId: f.coverage.id, kyc: kycFor(f, { insurerId: DEMO.org.insurerB, tpaId: "" }) })).rejects.toBeInstanceOf(ValidationError);
    await expect(PreauthService.members(as("deskA"), f.patient.patientNo)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PreauthService.raise(as("deskA"), { beneficiaryId: f.coverage.id, kyc: kycFor(f) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PreauthService.kycOptions(as("patientA1"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("KYC & Policy: the dropdowns hold only the payer's own insurer and its TPAs; the insurer must be the member's", async () => {
    const opts = await PreauthService.kycOptions(as("insurerA"));
    expect(opts.insurers.map((i) => i.id)).toEqual([DEMO.org.insurerA]);
    expect(opts.tpasByInsurer[DEMO.org.insurerA]!.map((t) => t.id)).toContain(DEMO.org.tpaA);

    const f = await freshFloaterPatient(ctx.db, who.deskA);
    await expect(PreauthService.raise(as("insurerA"), { beneficiaryId: f.coverage.id, kyc: kycFor(f, { insurerId: DEMO.org.insurerB }) })).rejects.toThrow(/policy is with/);
    await expect(PreauthService.raise(as("insurerA"), { kyc: kycFor(f, { memberId: "NO-SUCH-MEMBER" }) })).rejects.toThrow(/Find the member first/);
    await expect(PreauthService.raise(as("insurerA"), { beneficiaryId: f.coverage.id, kyc: kycFor(f, { mobile: "123" }) })).rejects.toBeInstanceOf(ValidationError);
    // Without Find, a unique member ID identifies the member.
    const byId = await PreauthService.raise(as("insurerA"), { kyc: kycFor(f) });
    expect(byId.beneficiaryId).toBe(f.coverage.id);
  });

  it("raises a draft case for the patient's own hospital, keeps the KYC, audits and tells the hospital", async () => {
    const { draft, coverage, patient } = await raised();
    const [row] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, draft.id));
    expect(row).toMatchObject({
      status: "draft", hospitalId: DEMO.org.hospitalA, patientId: patient.id, beneficiaryId: coverage.id, insurerId: DEMO.org.insurerA,
      raisedByOrgId: DEMO.org.insurerA, createdBy: who.insurerA.userId, submittedAt: null,
    });
    expect((row!.clinical as { kyc: { mobile: string; policyNumber: string } }).kyc).toMatchObject({ mobile: "9876500000", policyNumber: "POL-TEST-001" });
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "preauth.raised_by_payer"), eq(auditLogs.resourceId, draft.id)))).toHaveLength(1);
    const n = await ctx.db.select().from(notifications).where(and(eq(notifications.organizationId, DEMO.org.hospitalA), eq(notifications.resourceId, draft.id)));
    expect(n.map((x) => x.kind)).toContain("preauth.raised");
  });

  it("keeps the raised draft inside the raiser and the hospital; other payers can't see or touch it", async () => {
    const { draft } = await raised();
    expect((await PreauthService.wizard(as("insurerA"), draft.id)).preauth.id).toBe(draft.id);
    expect((await PreauthService.workspace(as("deskA"), draft.id)).preauth.id).toBe(draft.id);
    await expect(PreauthService.workspace(as("insurerB"), draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PreauthService.workspace(as("deskB"), draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PreauthService.wizard(as("insurerB"), draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PreauthService.saveClinical(as("insurerB"), draft.id, pkg())).rejects.toThrow();
    await expect(PreauthService.saveKyc(as("insurerB"), draft.id, {})).rejects.toThrow();
    await expect(DocumentService.upload(as("insurerB"), { subjectType: "preauth", subjectId: draft.id, docType: "id_proof", file: file() })).rejects.toBeInstanceOf(ForbiddenError);
    // A TPA on the same policy reviews it only after submission.
    await expect(PreauthService.wizard(as("tpaA"), draft.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("New Claim: steps and submission", () => {
  it("Clinical Details & Package: server validation, stay length, cost from the heads (or the package) and the KYC kept", async () => {
    const { draft } = await raised();
    await expect(PreauthService.saveClinical(as("insurerA"), draft.id, { claimType: "cashless" })).rejects.toBeInstanceOf(ValidationError);
    await expect(PreauthService.saveClinical(as("insurerA"), draft.id, { ...pkg(), costItems: [], packageAmount: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(PreauthService.saveClinical(as("insurerA"), draft.id, { ...pkg(), dischargeDate: "2026-12-19" })).rejects.toBeInstanceOf(ValidationError);
    const saved = await PreauthService.saveClinical(as("insurerA"), draft.id, pkg());
    expect(Number(saved.estimatedCost)).toBe(72000);
    expect(saved.expectedStayDays).toBe(4);
    expect(Number(saved.roomRentPerDay)).toBe(4000);
    expect(saved.diagnosisId).toBe(c.dx.K35);
    const pkgOnly = await PreauthService.saveClinical(as("insurerA"), draft.id, { ...pkg(), packageAmount: 55000 });
    expect(Number(pkgOnly.estimatedCost)).toBe(55000);
    const w = await PreauthService.wizard(as("insurerA"), draft.id);
    expect(w.details).toMatchObject({ chronicIllness: ["None"], familyPhysician: "Dr Family", admissionTime: "09:00:00.000" });
    expect(w.details).not.toHaveProperty("doctorContact");
    // A chronic illness typed in (not on the list) is kept as written.
    await PreauthService.saveClinical(as("insurerA"), draft.id, { ...pkg(), chronicIllness: ["Diabetes", "Thyroid disorder"] });
    expect((await PreauthService.wizard(as("insurerA"), draft.id)).details.chronicIllness).toEqual(["Diabetes", "Thyroid disorder"]);
    expect(w.kyc).toMatchObject({ policyNumber: "POL-TEST-001" });
    expect(w.diagnoses.map((x) => x.id)).toEqual([c.dx.K35]);
  });

  it("Pre-Scrutiny quick fixes save one field on its own, only for the raiser, and only the allowed fields", async () => {
    const { draft } = await raised();
    let w = await PreauthService.wizard(as("insurerA"), draft.id);
    expect(w.scrutiny.findings.map((f) => f.key)).toContain("clinical:diagnosisIds");
    await PreauthService.quickFix(as("insurerA"), draft.id, { diagnosisIds: [c.dx.K35] });
    w = await PreauthService.wizard(as("insurerA"), draft.id);
    expect(w.scrutiny.findings.map((f) => f.key)).not.toContain("clinical:diagnosisIds");
    expect(w.preauth.diagnosisId).toBe(c.dx.K35);
    await PreauthService.quickFix(as("insurerA"), draft.id, { admissionDate: "2026-12-20", admissionTime: "09:00:00.000", chronicIllness: ["Asthma / COPD / Bronchitis", "Thyroid disorder"] });
    w = await PreauthService.wizard(as("insurerA"), draft.id);
    expect(w.details).toMatchObject({ diagnosisIds: [c.dx.K35], admissionTime: "09:00:00.000", chronicIllness: ["Asthma / COPD / Bronchitis", "Thyroid disorder"] });
    await expect(PreauthService.quickFix(as("insurerA"), draft.id, { estimatedCost: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(PreauthService.quickFix(as("insurerB"), draft.id, { symptoms: "Should not save" })).rejects.toThrow();
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "preauth.quick_fix"), eq(auditLogs.resourceId, draft.id)))).toHaveLength(2);
  });

  it("files the raiser's uploads under the patient's hospital, and lets it remove only its own while a draft", async () => {
    const { draft } = await raised();
    const doc = await DocumentService.upload(as("insurerA"), { subjectType: "preauth", subjectId: draft.id, docType: "id_proof", file: file() });
    expect(doc.organizationId).toBe(DEMO.org.hospitalA);
    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "document.uploaded"), eq(auditLogs.resourceId, doc.id)));
    expect(audit[0]?.newState).toMatchObject({ onBehalfOfHospital: DEMO.org.hospitalA });
    await expect(DocumentService.remove(as("insurerB"), doc.id)).rejects.toThrow();
    await DocumentService.remove(as("insurerA"), doc.id);
    const [gone] = await ctx.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(gone?.deletedAt).not.toBeNull();
  });

  it("the checks compare the KYC with the record and report missing information, never a pass", async () => {
    const { draft } = await raised({ patientName: "Someone Else", policyFrom: "2025-04-01" });
    const w = await PreauthService.wizard(as("insurerA"), draft.id);
    const keys = w.scrutiny.findings.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["not_evaluated", "document:preauth_form", "kyc:name", "kyc:dates"]));
    expect(keys.some((k) => k.startsWith("clinical:"))).toBe(true);
    expect(w.scrutiny.blocking).toBeGreaterThan(0);
  });

  it("sends with acknowledged gaps (audited), refuses incomplete details or a missing acknowledgment", async () => {
    const { draft } = await raised();
    // Case details incomplete: refused even with the acknowledgment.
    await expect(PreauthService.wizardSubmit(as("insurerA"), draft.id, { acknowledged: true })).rejects.toThrow(/Clinical Details & Package/);
    await PreauthService.saveClinical(as("insurerA"), draft.id, pkg());
    // Gaps remain (papers, confirmations): the acknowledgment is required.
    await expect(PreauthService.wizardSubmit(as("insurerA"), draft.id, {})).rejects.toThrow(/acknowledgment/);
    const sub = await PreauthService.wizardSubmit(as("insurerA"), draft.id, { acknowledged: true });
    expect(sub.status).toBe("submitted");
    const [audit] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "preauth.wizard_submitted"), eq(auditLogs.resourceId, draft.id)));
    expect((audit?.newState as { acknowledgment: string }).acknowledgment).toMatch(/^I have seen these \d+ gaps and am sending anyway\. This is written to the case audit trail with the submission\.$/);
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "preauth.submitted_with_acknowledged_gaps"), eq(auditLogs.resourceId, draft.id)))).toHaveLength(1);
  });

  it("a complete case submits without gaps; the hospital is told; maker-checker on the decision", async () => {
    const { draft } = await raised();
    await complete(draft.id);
    const w = await PreauthService.wizard(as("insurerA"), draft.id);
    const sub = await PreauthService.wizardSubmit(as("insurerA"), draft.id, { acknowledged: w.scrutiny.findings.length > 0 });
    expect(sub.status).toBe("submitted");
    const n = await ctx.db.select().from(notifications).where(and(eq(notifications.organizationId, DEMO.org.hospitalA), eq(notifications.resourceId, draft.id)));
    expect(n.map((x) => x.kind)).toContain("preauth.raised_submitted");

    // Once submitted, the wizard is read-only for everyone.
    await expect(PreauthService.saveClinical(as("insurerA"), draft.id, pkg())).rejects.toThrow();
    await expect(PreauthService.saveKyc(as("insurerA"), draft.id, kycFor((await raised()) as Fresh))).rejects.toThrow();
    await expect(DocumentService.upload(as("insurerA"), { subjectType: "preauth", subjectId: draft.id, docType: "other", file: file() })).rejects.toBeInstanceOf(ForbiddenError);

    // Maker-checker: the reviewer who raised it can't decide it; a colleague can.
    await expect(PreauthService.decide(as("insurerA"), draft.id, { to: "pending" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await PreauthService.decide(as("portalReviewer"), draft.id, { to: "pending" })).status).toBe("pending");
  });

  it("hospital staff can still submit their own requests only with a complete checklist (no acknowledgment path)", async () => {
    const f = await freshFloaterPatient(ctx.db, who.deskA);
    const p = await PreauthService.create(as("deskA"), { beneficiaryId: f.coverage.id, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, estimatedCost: 50000 });
    await expect(PreauthService.submit(as("deskA"), p.id, { overrideReason: "I have seen these gaps and am sending anyway." })).rejects.toThrow(/Complete the checklist/);
  });
});

describe("Find the Patient: suggestions by any identifier, Aadhaar kept private", () => {
  /** 11 digits + the Verhoeff check digit: valid in form, never a real person's number. */
  const aadhaarFor = (prefix: string) => {
    for (let d = 0; d <= 9; d++) if (isValidAadhaar(prefix + d)) return prefix + d;
    throw new Error("no check digit");
  };
  const uniquePrefix = () => `${2 + Math.floor(Math.random() * 8)}${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`;

  async function withAadhaar(phone: string) {
    const f = await freshFloaterPatient(ctx.db, who.staffA);
    const aadhaar = aadhaarFor(uniquePrefix());
    await PatientService.update(as("staffA"), f.patient.id, { fullName: f.patient.fullName, dob: "1982-02-02", gender: "female", phone, aadhaar });
    return { ...f, aadhaar };
  }

  it("stores only a keyed hash and the last 4 digits; finds by the full number or the last 4, never by other digits", async () => {
    const { patient, coverage, aadhaar } = await withAadhaar("+91 98765 41234");
    const [row] = await ctx.db.select().from(patients).where(eq(patients.id, patient.id));
    expect(row!.aadhaarLast4).toBe(aadhaar.slice(-4));
    expect(row!.aadhaarHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(aadhaar);
    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "patient.updated"), eq(auditLogs.resourceId, patient.id)));
    expect(JSON.stringify(audit)).not.toContain(aadhaar);

    const ids = async (q: string, k: keyof typeof who = "insurerA") => (await PreauthService.members(as(k), q)).map((m) => m.beneficiaryId);
    expect(await ids(aadhaar)).toContain(coverage.id);
    expect(await ids(`${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`)).toContain(coverage.id);
    expect(await ids(aadhaar.slice(-4))).toContain(coverage.id);
    expect(await ids(aadhaar.slice(2, 8))).not.toContain(coverage.id);
    // Another insurer never finds the patient, by any value.
    expect(await ids(aadhaar, "insurerB")).not.toContain(coverage.id);
    const lookups = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "patient.aadhaar_lookup"));
    expect(lookups.length).toBeGreaterThan(0);
    expect(JSON.stringify(lookups)).not.toContain(aadhaar);
  });

  it("matches part of the name (any case), UHID, member ID, mobile digits and a policy number typed at KYC", async () => {
    const { patient, coverage } = await withAadhaar("98765 4" + String(Date.now()).slice(-4));
    const ids = async (q: string) => (await PreauthService.members(as("insurerA"), q, { limit: 50 })).map((m) => m.beneficiaryId);
    expect(await ids(patient.fullName.slice(0, 14).toUpperCase())).toContain(coverage.id);
    expect(await ids(patient.patientNo.slice(-5))).toContain(coverage.id);
    expect(await ids(coverage.memberId.slice(-6))).toContain(coverage.id);
    const [row] = await ctx.db.select().from(patients).where(eq(patients.id, patient.id));
    expect(await ids(row!.phone!.replace(/D/g, "").slice(-6))).toContain(coverage.id);
    const policyNumber = `POL-SRCH-${Date.now()}`;
    await PreauthService.raise(as("insurerA"), { beneficiaryId: coverage.id, kyc: kycFor({ patient, coverage } as Fresh, { policyNumber }) });
    expect(await ids(policyNumber.slice(-8))).toContain(coverage.id);
    expect(await ids("zzzz-no-such-patient")).toEqual([]);
    expect(await ids("a")).toEqual([]);
  });

  it("the same Aadhaar can't be registered twice at one hospital", async () => {
    const { aadhaar } = await withAadhaar("9876500111");
    const other = await freshFloaterPatient(ctx.db, who.staffA);
    await expect(
      PatientService.update(as("staffA"), other.patient.id, { fullName: other.patient.fullName, dob: "1982-02-02", gender: "female", aadhaar }),
    ).rejects.toThrow(/already registered/);
  });
});

describe("KYC Aadhaar and Register Case", () => {
  const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const aadhaarFor = (prefix: string) => {
    for (let d = 0; d <= 9; d++) if (isValidAadhaar(prefix + d)) return prefix + d;
    throw new Error("no check digit");
  };

  it("KYC keeps only a keyed hash and the last 4 digits; a blank keeps it; a different one than the record is flagged", async () => {
    const f = await freshFloaterPatient(ctx.db, who.staffA);
    const onRecord = aadhaarFor(`3${String(Date.now()).slice(-10)}`);
    await PatientService.update(as("staffA"), f.patient.id, { fullName: f.patient.fullName, dob: "1982-02-02", gender: "female", aadhaar: onRecord });
    const other = aadhaarFor(`4${String(Date.now()).slice(-10)}`);
    const draft = await PreauthService.raise(as("insurerA"), { beneficiaryId: f.coverage.id, kyc: kycFor(f, { aadhaar: other }) });
    const [row] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, draft.id));
    const kyc = (row!.clinical as { kyc: Record<string, unknown> }).kyc;
    expect(kyc.aadhaarLast4).toBe(other.slice(-4));
    expect(kyc).not.toHaveProperty("aadhaar");
    expect(JSON.stringify(row)).not.toContain(other);
    let w = await PreauthService.wizard(as("insurerA"), draft.id);
    expect(w.scrutiny.findings.map((x) => x.key)).toContain("kyc:aadhaar");
    // Blank keeps the one on the case; the matching number clears the finding.
    await PreauthService.saveKyc(as("insurerA"), draft.id, kycFor(f));
    expect(((await PreauthService.wizard(as("insurerA"), draft.id)).kyc as Record<string, unknown>).aadhaarLast4).toBe(other.slice(-4));
    await PreauthService.saveKyc(as("insurerA"), draft.id, kycFor(f, { aadhaar: onRecord }));
    w = await PreauthService.wizard(as("insurerA"), draft.id);
    expect(w.scrutiny.findings.map((x) => x.key)).not.toContain("kyc:aadhaar");
    await expect(PreauthService.saveKyc(as("insurerA"), draft.id, kycFor(f, { aadhaar: "12345" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("Register Case: refuses an incomplete or unsigned form; Submit files the signed PDF with the case and the patient record, once", async () => {
    const { draft, patient } = await raised();
    await expect(RegistrationService.submit(as("insurerA"), draft.id, { signature: SIGNATURE })).rejects.toThrow(/Complete the form first/);
    await PreauthService.saveClinical(as("insurerA"), draft.id, pkg());
    await expect(RegistrationService.submit(as("insurerA"), draft.id, { signature: null })).rejects.toThrow(/Sign/);
    await expect(RegistrationService.submit(as("insurerA"), draft.id, { signature: "data:image/png;base64,bm90IGEgcG5n" })).rejects.toThrow(/couldn't be read/);

    const first = await RegistrationService.submit(as("insurerA"), draft.id, { signature: SIGNATURE });
    expect(first.duplicate).toBe(false);
    const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, first.documentId));
    expect(doc).toMatchObject({ docType: "case_registration_form", patientId: patient.id, subjectId: draft.id, organizationId: DEMO.org.hospitalA, mimeType: "application/pdf" });
    const data = await RegistrationService.data(as("insurerA"), draft.id);
    expect(data.registration).toMatchObject({ documentId: first.documentId, current: true, signerRole: expect.any(String) });
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "preauth.case_registered"), eq(auditLogs.resourceId, draft.id)))).toHaveLength(1);

    // The same content again: no second copy.
    const again = await RegistrationService.submit(as("insurerA"), draft.id, { signature: SIGNATURE });
    expect(again).toEqual({ documentId: first.documentId, duplicate: true });

    // On the patient's record for the raiser and the hospital; never for another insurer.
    expect((await DocumentService.registrationForms(as("insurerA"), patient.id)).map((r) => r.id)).toContain(first.documentId);
    expect((await DocumentService.registrationForms(as("staffA"), patient.id)).map((r) => r.id)).toContain(first.documentId);
    await expect(DocumentService.registrationForms(as("insurerB"), patient.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(RegistrationService.submit(as("insurerB"), draft.id, { signature: SIGNATURE })).rejects.toThrow();

    // Later edits keep the registration but mark it out of date; the PDF downloads.
    await PreauthService.saveClinical(as("insurerA"), draft.id, { ...pkg(), symptoms: "Changed after registration." });
    expect((await RegistrationService.data(as("insurerA"), draft.id)).registration?.current).toBe(false);
    const { pdf } = await RegistrationService.pdf(as("insurerA"), draft.id);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const copy = await RegistrationService.saveCopy(as("insurerA"), draft.id, { signature: null });
    expect(copy.documentId).toBeTruthy();
  });
});
