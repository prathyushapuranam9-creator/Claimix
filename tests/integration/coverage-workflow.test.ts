import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, beneficiaries, documents, patients, preAuthorizations } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { randomToken } from "@/lib/security/crypto";
import { DocumentService } from "@/modules/documents/documents.service";
import { InsuranceExtractionService } from "@/modules/documents/insurance-extraction.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { PatientEligibilityService } from "@/modules/eligibility/patient-eligibility.service";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { CHECKLIST } from "@/modules/preauth/preauth.checklist";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { AAROGYA_CARD, insuranceCardPdf, SPARSE_CARD } from "@/tests/fixtures/insurance-card";
import { codes, file, useTempStorage } from "./fixtures";
import { demoPrincipals, svc, testContext } from "./helpers";

/**
 * The Hospital Staff workflow end to end, on the server:
 * register patient -> (optionally) insurance document -> coverage -> eligibility -> pre-authorization
 * -> treatment documents -> submit -> awaiting payer, in both insurance scenarios, plus the data-integrity
 * rules that keep patient, coverage, policy, payer and documents correctly linked.
 */
const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const ALL = { page: 1, pageSize: 100 };
const TREATMENT_DOCS = ["id_proof", "insurance_card", "doctor_consultation", "investigation_reports", "treatment_estimate"];
const MANUAL = CHECKLIST.filter((x) => x.source.type === "manual").map((x) => x.key);

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(async () => {
  setStorageForTests(undefined);
  await ctx.close();
});

const alpha = () => randomToken(6).replace(/[^a-zA-Z]/g, "x").slice(0, 6);

/** Asserts a raw statement was refused, matching the message the database trigger raised. */
async function refusedBy(statement: Promise<unknown>, reason: RegExp) {
  const err = await statement.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "the statement was expected to be refused").not.toBeNull();
  const chain: string[] = [];
  for (let e = err as { message?: string; cause?: unknown } | null; e; e = (e.cause ?? null) as typeof e) chain.push(e.message ?? "");
  expect(chain.join(" | ")).toMatch(reason);
}
const uniqueMember = (p: string) => `${p}-${randomToken(10).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;

/** A patient registered by Hospital A's staff, with nothing else. */
async function registerPatient(label: string, over: Record<string, unknown> = {}) {
  return PatientService.create(as("staffA"), { fullName: `${label} ${alpha()}`, dob: "1984-05-05", gender: "female", ...over });
}

const uploadCard = (patientId: string, lines = AAROGYA_CARD, docType = "insurance_card") =>
  DocumentService.uploadInsuranceDocument(as("staffA"), patientId, { docType, file: file("card.pdf", insuranceCardPdf(lines)) });

/** Manual coverage on the fictional family floater, with an unused member ID. */
const manualCoverage = (over: Record<string, unknown> = {}) => ({
  policyId: DEMO.policy.aarogyaFloater,
  memberId: uniqueMember("MAN"),
  relationship: "self",
  coverStart: "2026-04-01",
  coverEnd: "2027-03-31",
  inceptionDate: "2021-04-01",
  sumInsured: 500000,
  sumInsuredAvailable: 400000,
  ...over,
});

const caseDetails = (beneficiaryId: string) => ({
  beneficiaryId,
  claimType: "cashless" as const,
  diagnosisId: c.dx.K35,
  procedureId: c.px.APPENDECTOMY,
  admissionDate: "2026-10-20",
  isAccident: "no" as const,
  pedDeclared: "no" as const,
  pedRelated: "unknown" as const,
  estimatedCost: 100000,
  expectedInsuranceAmount: 100000,
  roomRentPerDay: 4000,
});

/** Treatment documents, rule checks, checklist and submission — the hospital half of the request. */
async function completeAndSubmit(preauthId: string) {
  const staff = as("staffA");
  for (const t of TREATMENT_DOCS) await DocumentService.upload(staff, { subjectType: "preauth", subjectId: preauthId, docType: t, file: file() });
  await PreauthService.runChecks(staff, preauthId);
  for (const key of MANUAL) await PreauthService.confirmItem(staff, preauthId, { key, confirmed: true });
  return PreauthService.submit(staff, preauthId, {});
}

// ----------------------------------------------------------- Scenario A: the document is available

describe("Scenario A: patient has an insurance document", () => {
  it("runs register -> upload -> extract -> verify -> coverage -> eligibility -> pre-auth -> documents -> submit", async () => {
    const patient = await registerPatient("Card Journey");
    expect(patient.hospitalId).toBe(DEMO.org.hospitalA);
    // Registering creates the patient only: no coverage is invented.
    expect(await CoverageService.forPatient(as("staffA"), patient.id)).toHaveLength(0);
    expect(await DocumentService.insuranceDocuments(as("staffA"), patient.id)).toHaveLength(0);

    // Step 2: the insurance document is filed against this patient, with no request subject.
    const doc = await uploadCard(patient.id);
    expect(doc.patientId).toBe(patient.id);
    expect(doc.subjectType).toBeNull();
    expect(doc.subjectId).toBeNull();
    expect(doc.organizationId).toBe(DEMO.org.hospitalA);
    expect(doc.category).toBe("patient");
    const onRecord = await DocumentService.insuranceDocuments(as("staffA"), patient.id);
    expect(onRecord.map((d) => d.id)).toEqual([doc.id]);

    // Step 3: the details are read from the document and offered for checking.
    const extracted = await InsuranceExtractionService.fromDocument(as("staffA"), patient.id, doc.id);
    expect(extracted.noReadableText).toBe(false);
    expect(extracted.matchedPolicy?.id).toBe(DEMO.policy.aarogyaFloater);
    expect(extracted.values).toMatchObject({
      policyId: DEMO.policy.aarogyaFloater,
      memberId: "AAR-FF-778901",
      relationship: "self",
      coverStart: "2026-04-01",
      coverEnd: "2027-03-31",
      inceptionDate: "2021-04-01",
      sumInsured: "500000",
      sumInsuredAvailable: "400000",
    });
    expect(extracted.read.length).toBeGreaterThan(3);
    expect(extracted.missing).toHaveLength(0);
    // The names on the card are reported for checking, but are not coverage fields and are never saved.
    expect(extracted.namesOnDocument.map((n) => n.value)).toContain("Test Card Patient");
    expect(Object.keys(extracted.values)).not.toContain("patientName");

    // Step 4: staff correct a value before saving. Only what they submit is recorded.
    const corrected = uniqueMember("AAR-FF");
    const coverage = await CoverageService.add(as("staffA"), patient.id, {
      ...extracted.values,
      memberId: corrected,
      verificationStatus: "verified",
      sourceDocumentId: doc.id,
    });
    expect(coverage.memberId).toBe(corrected);
    expect(coverage.memberId).not.toBe("AAR-FF-778901");
    expect(coverage.patientId).toBe(patient.id);
    expect(coverage.policyId).toBe(DEMO.policy.aarogyaFloater);
    expect(coverage.verificationStatus).toBe("verified");
    expect(coverage.sourceDocumentId).toBe(doc.id);

    // Step 5: it is on the patient's record, so nothing has to be typed again.
    const listed = await CoverageService.forPatient(as("staffA"), patient.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: coverage.id, memberId: corrected, policyName: expect.stringContaining("Aarogya Family Floater Plus") });

    // Step 6: eligibility runs against this patient's own coverage.
    const elig = await PatientEligibilityService.check(as("staffA"), patient.id, coverage.id);
    expect(elig.beneficiaryId).toBe(coverage.id);
    expect(elig.patientId).toBe(patient.id);
    expect(elig.memberId).toBe(corrected);
    expect(elig.coverageStatus).toBe("in_force");
    expect(elig.verificationStatus).toBe("verified");
    // The profile check names no treatment, so coverage rules ask for verification rather than passing;
    // nothing failed, so the request can still be started.
    expect(elig.outcome).not.toBe("FAIL");
    expect(elig.status).not.toBe("not_eligible");
    expect(elig.canStartRequest).toBe(true);

    // Step 6/7: the pre-authorization links everything by itself.
    const pre = await PreauthService.create(as("staffA"), caseDetails(coverage.id));
    expect(pre).toMatchObject({
      patientId: patient.id,
      beneficiaryId: coverage.id,
      policyId: DEMO.policy.aarogyaFloater,
      insurerId: DEMO.org.insurerA,
      hospitalId: DEMO.org.hospitalA,
      status: "draft",
    });

    // Step 7: the request's documents and the patient's insurance documents stay separate.
    await completeAndSubmit(pre.id);
    const requestDocs = await DocumentService.forPreauth(as("staffA"), pre.id);
    expect(requestDocs.map((d) => d.id)).not.toContain(doc.id);
    expect(requestDocs).toHaveLength(TREATMENT_DOCS.length);
    const insuranceDocs = await DocumentService.insuranceDocuments(as("staffA"), patient.id);
    expect(insuranceDocs.map((d) => d.id)).toEqual([doc.id]);

    // Steps 9/10: submitted and waiting for the payer, visible to that payer only.
    const [stored] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, pre.id));
    expect(stored!.status).toBe("submitted");
    expect(stored!.submittedAt).not.toBeNull();

    const awaiting = await PreauthService.list(as("staffA"), ALL, { status: ["submitted", "pending"] });
    expect(awaiting.rows.map((r) => r.id)).toContain(pre.id);
    const payerSees = await PreauthService.list(as("insurerA"), ALL, {});
    expect(payerSees.rows.map((r) => r.id)).toContain(pre.id);
    const otherPayer = await PreauthService.list(as("insurerB"), ALL, {});
    expect(otherPayer.rows.map((r) => r.id)).not.toContain(pre.id);
    await expect(PreauthService.workspace(as("insurerB"), pre.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records what was read, and that it is not verified by itself, in the audit log", async () => {
    const patient = await registerPatient("Card Audit");
    const doc = await uploadCard(patient.id);
    await InsuranceExtractionService.fromDocument(as("staffA"), patient.id, doc.id);
    const rows = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "coverage.details_extracted"), eq(auditLogs.resourceId, doc.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.newState).toMatchObject({ patientId: patient.id, readableText: true });
    // Nothing was written to the patient's coverage by reading the document.
    expect(await CoverageService.forPatient(as("staffA"), patient.id)).toHaveLength(0);
  });

  it("leaves unreadable or sparse documents to be typed in, without guessing", async () => {
    const patient = await registerPatient("Sparse Card");
    const sparse = await uploadCard(patient.id, SPARSE_CARD, "policy_copy");
    const r = await InsuranceExtractionService.fromDocument(as("staffA"), patient.id, sparse.id);
    expect(r.values.memberId).toBe("XYZ-001-22");
    expect(r.values.coverStart).toBeUndefined();
    expect(r.matchedPolicy).toBeNull();
    expect(r.missing).toContain("Cover start");
    expect(r.missing).toContain("Policy / scheme");

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(7)]);
    const photo = await DocumentService.uploadInsuranceDocument(as("staffA"), patient.id, { docType: "insurance_card", file: file("card.png", png) });
    const fromPhoto = await InsuranceExtractionService.fromDocument(as("staffA"), patient.id, photo.id);
    expect(fromPhoto.noReadableText).toBe(true);
    expect(Object.keys(fromPhoto.values)).toHaveLength(0);
  });

  it("refuses to read a treatment document as coverage evidence", async () => {
    const patient = await registerPatient("Stage Mix");
    const coverage = await CoverageService.add(as("staffA"), patient.id, manualCoverage());
    const pre = await PreauthService.create(as("staffA"), caseDetails(coverage.id));
    const estimate = await DocumentService.upload(as("staffA"), { subjectType: "preauth", subjectId: pre.id, docType: "treatment_estimate", file: file() });
    await expect(InsuranceExtractionService.fromDocument(as("staffA"), patient.id, estimate.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("only accepts insurance document types against a patient", async () => {
    const patient = await registerPatient("Wrong Type");
    await expect(
      DocumentService.uploadInsuranceDocument(as("staffA"), patient.id, { docType: "discharge_summary", file: file() }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ----------------------------------------------------------- Scenario B: no document yet

describe("Scenario B: the insurance document is not available", () => {
  it("records coverage manually, checks eligibility and submits, with no document at any point", async () => {
    const patient = await registerPatient("Manual Journey");
    const coverage = await CoverageService.add(as("staffA"), patient.id, manualCoverage());
    // No document was needed, and none exists.
    expect(await DocumentService.insuranceDocuments(as("staffA"), patient.id)).toHaveLength(0);
    expect(coverage.sourceDocumentId).toBeNull();
    // Unconfirmed by default, which is a note on the record and nothing more.
    expect(coverage.verificationStatus).toBe("requires_verification");

    const elig = await PatientEligibilityService.check(as("staffA"), patient.id, coverage.id);
    // "Requires verification" is a note on the record: the check runs and the request can go ahead.
    expect(elig.verificationStatus).toBe("requires_verification");
    expect(elig.outcome).not.toBe("FAIL");
    expect(elig.canStartRequest).toBe(true);

    const pre = await PreauthService.create(as("staffA"), caseDetails(coverage.id));
    await completeAndSubmit(pre.id);
    const [stored] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, pre.id));
    expect(stored!.status).toBe("submitted");
    expect(stored!.insurerId).toBe(DEMO.org.insurerA);
  });

  it("lets staff add the document later and confirm the coverage against it", async () => {
    const patient = await registerPatient("Late Document");
    const coverage = await CoverageService.add(as("staffA"), patient.id, manualCoverage({ memberId: uniqueMember("LATE") }));
    expect(coverage.verificationStatus).toBe("requires_verification");

    const doc = await uploadCard(patient.id);
    const extracted = await InsuranceExtractionService.fromDocument(as("staffA"), patient.id, doc.id);
    const updated = await CoverageService.update(as("staffA"), coverage.id, {
      ...extracted.values,
      policyId: DEMO.policy.aarogyaFloater,
      memberId: coverage.memberId,
      verificationStatus: "verified",
      sourceDocumentId: doc.id,
    });
    expect(updated.verificationStatus).toBe("verified");
    expect(updated.sourceDocumentId).toBe(doc.id);
    expect(updated.id).toBe(coverage.id);
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "coverage.updated"), eq(auditLogs.resourceId, patient.id)))).not.toHaveLength(0);
  });

  it("keeps the payer a coverage was used for: the policy can't be swapped once a request exists", async () => {
    const patient = await registerPatient("Policy Swap");
    const coverage = await CoverageService.add(as("staffA"), patient.id, manualCoverage());
    // Before any request, correcting the policy is allowed.
    const moved = await CoverageService.update(as("staffA"), coverage.id, manualCoverage({ memberId: coverage.memberId, policyId: DEMO.policy.surakshaIndividual }));
    expect(moved.policyId).toBe(DEMO.policy.surakshaIndividual);

    await PreauthService.create(as("staffA"), caseDetails(coverage.id));
    await expect(
      CoverageService.update(as("staffA"), coverage.id, manualCoverage({ memberId: coverage.memberId, policyId: DEMO.policy.aarogyaFloater })),
    ).rejects.toThrow(/already used by/);
  });
});

// ----------------------------------------------------------- existing patients

describe("Existing patient, new visit", () => {
  it("warns about a repeat registration and reuses the record for new coverage and a new request", async () => {
    const name = `Repeat Patient ${alpha()}`;
    const first = await PatientService.create(as("staffA"), { fullName: name, dob: "1979-07-07", gender: "male" });

    // Same name and date of birth again: a warning naming the existing record, not a silent second patient.
    const again = PatientService.create(as("staffA"), { fullName: name, dob: "1979-07-07", gender: "male" });
    await expect(again).rejects.toBeInstanceOf(ValidationError);
    await again.catch((e: ValidationError) => {
      expect(e.fieldErrors?._duplicate?.[0]).toContain(first.id);
      expect(e.message).toContain(first.patientNo);
    });
    const sameName = await ctx.db.select().from(patients).where(and(eq(patients.hospitalId, DEMO.org.hospitalA), eq(patients.fullName, name)));
    expect(sameName).toHaveLength(1);

    // The existing patient takes new coverage and a new pre-authorization for this visit.
    const coverage = await CoverageService.add(as("staffA"), first.id, manualCoverage({ memberId: uniqueMember("REP") }));
    const pre = await PreauthService.create(as("staffA"), caseDetails(coverage.id));
    expect(pre.patientId).toBe(first.id);
    const stillOne = await ctx.db.select().from(patients).where(and(eq(patients.hospitalId, DEMO.org.hospitalA), eq(patients.fullName, name)));
    expect(stillOne).toHaveLength(1);
  });
});

// ----------------------------------------------------------- coverage that isn't usable

describe("Invalid or expired coverage", () => {
  it("reports an expired cover and refuses a pre-authorization on it", async () => {
    const patient = await registerPatient("Expired Cover");
    const coverage = await CoverageService.add(
      as("staffA"),
      patient.id,
      manualCoverage({ memberId: uniqueMember("EXP"), coverStart: "2024-04-01", coverEnd: "2025-03-31", inceptionDate: "2024-04-01" }),
    );
    const elig = await PatientEligibilityService.check(as("staffA"), patient.id, coverage.id);
    expect(elig.coverageStatus).toBe("expired");
    expect(elig.status).toBe("expired");
    expect(elig.canStartRequest).toBe(false);
    await expect(PreauthService.create(as("staffA"), caseDetails(coverage.id))).rejects.toThrow(/cover ended/);
    expect(await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.beneficiaryId, coverage.id))).toHaveLength(0);
  });

  it("refuses a pre-authorization on cover that has not started, and allows the correction", async () => {
    const patient = await registerPatient("Future Cover");
    const coverage = await CoverageService.add(
      as("staffA"),
      patient.id,
      manualCoverage({ memberId: uniqueMember("FUT"), coverStart: "2030-01-01", coverEnd: "2031-01-01", inceptionDate: "2030-01-01" }),
    );
    const elig = await PatientEligibilityService.check(as("staffA"), patient.id, coverage.id);
    expect(elig.coverageStatus).toBe("not_started");
    expect(elig.canStartRequest).toBe(false);
    await expect(PreauthService.create(as("staffA"), caseDetails(coverage.id))).rejects.toThrow(/cover starts on/);

    // Correcting the recorded dates makes the request possible, without a second patient or coverage.
    await CoverageService.update(as("staffA"), coverage.id, manualCoverage({ memberId: coverage.memberId }));
    const pre = await PreauthService.create(as("staffA"), caseDetails(coverage.id));
    expect(pre.beneficiaryId).toBe(coverage.id);
  });
});

// ----------------------------------------------------------- data integrity

describe("Patient, coverage, document and request stay correctly linked", () => {
  it("refuses coverage that cites another patient's insurance document", async () => {
    const [mine, theirs] = await Promise.all([registerPatient("Doc Owner"), registerPatient("Doc Other")]);
    const doc = await uploadCard(theirs.id);
    await expect(
      CoverageService.add(as("staffA"), mine.id, manualCoverage({ memberId: uniqueMember("XDOC"), sourceDocumentId: doc.id })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await CoverageService.forPatient(as("staffA"), mine.id)).toHaveLength(0);
  });

  it("refuses to read one patient's document for another patient", async () => {
    const [a, b] = await Promise.all([registerPatient("Read A"), registerPatient("Read B")]);
    const doc = await uploadCard(b.id);
    await expect(InsuranceExtractionService.fromDocument(as("staffA"), a.id, doc.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses an eligibility check against another patient's coverage", async () => {
    const [a, b] = await Promise.all([registerPatient("Elig A"), registerPatient("Elig B")]);
    const coverage = await CoverageService.add(as("staffA"), b.id, manualCoverage({ memberId: uniqueMember("XELG") }));
    await expect(PatientEligibilityService.check(as("staffA"), a.id, coverage.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps another hospital's patients, documents and coverage out of reach", async () => {
    const patient = await registerPatient("Isolation");
    const doc = await uploadCard(patient.id);
    const coverage = await CoverageService.add(as("staffA"), patient.id, manualCoverage({ memberId: uniqueMember("ISO") }));
    // Hospital B sees none of it, and cannot add to it.
    await expect(DocumentService.insuranceDocuments(as("staffB"), patient.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(InsuranceExtractionService.fromDocument(as("staffB"), patient.id, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(DocumentService.uploadInsuranceDocument(as("staffB"), patient.id, { docType: "insurance_card", file: file() })).rejects.toBeInstanceOf(NotFoundError);
    await expect(CoverageService.update(as("staffB"), coverage.id, manualCoverage({ memberId: coverage.memberId }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(PreauthService.create(as("staffB"), caseDetails(coverage.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the database itself refuses a request that mixes patients, coverage or hospitals", async () => {
    const [a, b] = await Promise.all([registerPatient("DB Link A"), registerPatient("DB Link B")]);
    const covA = await CoverageService.add(as("staffA"), a.id, manualCoverage({ memberId: uniqueMember("DBA") }));
    const insert = (over: Record<string, unknown>) => {
      const v = {
        reference: `PA-TRG-${randomToken(6).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`,
        hospital_id: DEMO.org.hospitalA,
        patient_id: a.id,
        beneficiary_id: covA.id,
        policy_id: DEMO.policy.aarogyaFloater,
        created_by: who.staffA.userId,
        ...over,
      };
      return ctx.db.execute(sql`
        insert into pre_authorizations (reference, hospital_id, patient_id, beneficiary_id, policy_id, created_by)
        values (${v.reference}, ${v.hospital_id}, ${v.patient_id}, ${v.beneficiary_id}, ${v.policy_id}, ${v.created_by})
      `);
    };
    // Another patient with this coverage, a policy the coverage isn't under, another hospital's patient.
    await refusedBy(insert({ patient_id: b.id }), /belongs to patient/);
    await refusedBy(insert({ policy_id: DEMO.policy.surakshaIndividual }), /is under policy/);
    await refusedBy(insert({ hospital_id: DEMO.org.hospitalB }), /is registered at hospital/);
    // The same row without the mix-up is accepted, so the trigger isn't simply refusing everything.
    await expect(insert({})).resolves.toBeDefined();
  });

  it("the database itself refuses a document filed against another patient's request", async () => {
    const [a, b] = await Promise.all([registerPatient("DB Doc A"), registerPatient("DB Doc B")]);
    const covA = await CoverageService.add(as("staffA"), a.id, manualCoverage({ memberId: uniqueMember("DBD") }));
    const pre = await PreauthService.create(as("staffA"), caseDetails(covA.id));
    const doc = await DocumentService.uploadInsuranceDocument(as("staffA"), b.id, { docType: "insurance_card", file: file() });
    await refusedBy(ctx.db.execute(sql`update documents set subject_type = 'preauth', subject_id = ${pre.id} where id = ${doc.id}`), /cannot be filed against/);
    const [after] = await ctx.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(after!.subjectId).toBeNull();
  });

  it("the database itself refuses coverage citing another patient's document", async () => {
    const [a, b] = await Promise.all([registerPatient("DB Cov A"), registerPatient("DB Cov B")]);
    const covA = await CoverageService.add(as("staffA"), a.id, manualCoverage({ memberId: uniqueMember("DBC") }));
    const docB = await uploadCard(b.id);
    await refusedBy(ctx.db.execute(sql`update beneficiaries set source_document_id = ${docB.id} where id = ${covA.id}`), /does not belong to patient/);
    const [row] = await ctx.db.select().from(beneficiaries).where(eq(beneficiaries.id, covA.id));
    expect(row!.sourceDocumentId).toBeNull();
  });
});
