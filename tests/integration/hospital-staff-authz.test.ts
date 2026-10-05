import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { AuditViewer } from "@/modules/audit/audit.viewer";
import { ClinicalService } from "@/modules/clinical/clinical.service";
import { AssistantService } from "@/modules/assistant/assistant.service";
import { ClaimService } from "@/modules/claims/claims.service";
import { DocumentService } from "@/modules/documents/documents.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { EligibilityService } from "@/modules/eligibility/eligibility.service";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { randomToken } from "@/lib/security/crypto";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { approvedPreauth, codes, file, freshFloaterPatient, useTempStorage } from "./fixtures";
import { createThrowawayUser, demoPrincipals, principalFor, svc, testContext } from "./helpers";

/** Server-side guarantees for the hospital-staff role: no frontend is involved, so a manipulated request meets exactly this. */
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

const draftFor = async (beneficiaryId: string) =>
  PreauthService.create(as("staffA"), { beneficiaryId, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, admissionDate: "2026-10-12", isAccident: "no", pedDeclared: "no", estimatedCost: 50000, roomRentPerDay: 3000 });

describe("pre-authorization status changes by hospital staff", () => {
  it("cannot approve, reject, query or settle an insurer-backed request (payer decisions are payer-only)", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.staffA);
    const p = await draftFor(coverage.id);
    for (const to of ["approved", "rejected", "query", "pending", "final_approved"] as const) {
      await expect(PreauthService.decide(as("staffA"), p.id, { to, amount: 50000, message: "Self-service attempt from hospital", reasonId: c.reason.insufficient_medical_info })).rejects.toThrow();
    }
  });

  it("cannot submit a draft whose checklist is incomplete, and cannot skip draft → approved", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.staffA);
    const p = await draftFor(coverage.id);
    await expect(PreauthService.submit(as("staffA"), p.id, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it("cannot answer a query that does not exist, and cannot cancel twice", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.staffA);
    const p = await draftFor(coverage.id);
    await expect(PreauthService.respondToQuery(as("staffA"), p.id, { message: "Answering nothing at all" })).rejects.toBeInstanceOf(InvalidTransitionError);
    await PreauthService.cancel(as("staffA"), p.id, { message: "Patient chose another hospital" });
    await expect(PreauthService.cancel(as("staffA"), p.id, { message: "Cancelling again should fail" })).rejects.toThrow();
    await expect(PreauthService.update(as("staffA"), p.id, { claimType: "cashless" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot edit a submitted request or re-submit it", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    await expect(PreauthService.update(as("staffA"), preauth.id, { claimType: "cashless" })).rejects.toBeInstanceOf(ConflictError);
    await expect(PreauthService.submit(as("staffA"), preauth.id, {})).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe("claim status changes by hospital staff", () => {
  it("cannot decide or settle an insurer-backed claim", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const claim = await ClaimService.createCashless(as("staffA"), { preAuthId: preauth.id, admissionDate: "2026-09-20", dischargeDate: "2026-09-23", billNumber: "B-1", claimedAmount: 90000 });
    await expect(ClaimService.decide(as("staffA"), claim.id, { to: "approved", amount: 90000 })).rejects.toThrow();
    await expect(ClaimService.settle(as("staffA"), claim.id, { amount: 90000, utr: "UTR000001", settledAt: "2026-09-25" })).rejects.toThrow();
    await expect(ClaimService.respondToQuery(as("staffA"), claim.id, { message: "No query is open here" })).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe("tenant isolation for hospital staff (Hospital B must not touch Hospital A)", () => {
  it("cannot read or modify another hospital's patient, coverage, pre-auth, claim or documents", async () => {
    const { coverage, patient } = await freshFloaterPatient(ctx.db, who.staffA);
    const p = await draftFor(coverage.id);
    await expect(PatientService.get(as("staffB"), patient.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PatientService.update(as("staffB"), patient.id, { fullName: "Hijacked Name", dob: "1990-01-01", gender: "female" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(CoverageService.get(as("staffB"), coverage.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(CoverageService.add(as("staffB"), patient.id, { policyId: DEMO.policy.aarogyaFloater, memberId: "HIJACK-1", relationship: "self", coverStart: "2026-04-01", coverEnd: "2027-03-31" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(PreauthService.workspace(as("staffB"), p.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PreauthService.create(as("staffB"), { beneficiaryId: coverage.id, claimType: "cashless" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(DocumentService.upload(as("staffB"), { subjectType: "preauth", subjectId: p.id, docType: "id_proof", file: file() })).rejects.toThrow();
    await expect(EligibilityService.check(as("staffB"), { beneficiaryId: coverage.id, claimType: "cashless" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("registering a patient always lands in the caller's own hospital, even if another hospital id is sent", async () => {
    const p = await PatientService.create(as("staffA"), { fullName: `Scoped Patient ${randomToken(6).replace(/[^a-zA-Z]/g, "x")}`, dob: "1990-02-02", gender: "female", hospitalId: DEMO.org.hospitalB });
    expect(p.hospitalId).toBe(DEMO.org.hospitalA);
  });
});

describe("what hospital staff are not allowed to do", () => {
  it("patient users cannot create pre-auths, claims or patients", async () => {
    await expect(PatientService.create(as("patientA1"), { fullName: "Not Allowed", dob: "1990-01-01", gender: "female" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PreauthService.create(as("patientA1"), { beneficiaryId: DEMO.beneficiary.a1Floater, claimType: "cashless" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("staff can neither read the medical-code maintenance lists nor change medical codes (admin only)", async () => {
    await expect(ClinicalService.lists(as("staffA"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ClinicalService.lists(as("admin"))).resolves.toBeTruthy();
    await expect(ClinicalService.addDiagnosis(as("staffA"), { code: "Z99", name: "Not allowed" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ClinicalService.addProcedure(as("staffA"), { code: "NOPE", name: "Not allowed" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("staff cannot read the audit log (admin-only)", async () => {
    await expect(AuditViewer.list(as("staffA"), { page: 1, pageSize: 10 }, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("assistant human-review workflow (needs a second staff member in the same hospital)", () => {
  it("asker sends a question for review; a colleague answers; the asker is notified; strangers can't answer", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const asked = await AssistantService.ask(as("staffA"), { subjectType: "preauth", subjectId: preauth.id, question: "Tell me a joke about elephants." });
    expect(asked.status).not.toBe("answered");
    const review = await AssistantService.requestReview(as("staffA"), { interactionId: asked.interactionId, note: "Please advise" });
    expect(review.status).toBe("open");

    // The asker cannot answer their own review; another hospital cannot see or answer it.
    await expect(AssistantService.respond(as("staffA"), review.id, { response: "I will answer my own question." })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(AssistantService.respond(as("staffB"), review.id, { response: "Hospital B should not answer this." })).rejects.toBeInstanceOf(NotFoundError);

    // A second member of Hospital A answers it.
    const colleague = await createThrowawayUser(ctx.db, ctx.demoPassword, "hospital_staff");
    const colleaguePrincipal = await principalFor(ctx.auth, colleague.email, ctx.demoPassword);
    const open = await AssistantService.reviews(svc(ctx.db, colleaguePrincipal), "open");
    expect(open.some((r) => r.review.id === review.id)).toBe(true);
    const answered = await AssistantService.respond(svc(ctx.db, colleaguePrincipal), review.id, { response: "Please check the payer's policy wording for this." });
    expect(answered.status).toBe("answered");
    await expect(AssistantService.respond(svc(ctx.db, colleaguePrincipal), review.id, { response: "Answering twice must fail now." })).rejects.toBeInstanceOf(ValidationError);
    const done = await AssistantService.reviews(as("staffA"), "answered");
    expect(done.some((r) => r.review.id === review.id && r.review.response)).toBe(true);
  });
});
