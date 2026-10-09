import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diagnoses, procedures, rejectionReasons } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { randomToken } from "@/lib/security/crypto";
import { DocumentService } from "@/modules/documents/documents.service";
import { localStorageAdapter, setStorageForTests } from "@/modules/documents/storage";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { CHECKLIST } from "@/modules/preauth/preauth.checklist";
import { PreauthService } from "@/modules/preauth/preauth.service";
import type { Db } from "@/db/client";
import { insuranceDesk, svc } from "./helpers";
import type { Principal } from "@/lib/permissions/principal";

export const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
export const file = (name = "doc.pdf", bytes = PDF) => ({ name, size: bytes.length, bytes });

export function useTempStorage() {
  setStorageForTests(localStorageAdapter(mkdtempSync(path.join(tmpdir(), "claimix-docs-"))));
}

export async function codes(db: Db) {
  const [dx, px, rs] = await Promise.all([db.select().from(diagnoses), db.select().from(procedures), db.select().from(rejectionReasons)]);
  return {
    dx: Object.fromEntries(dx.map((d) => [d.code, d.id])) as Record<string, string>,
    px: Object.fromEntries(px.map((p) => [p.code, p.id])) as Record<string, string>,
    reason: Object.fromEntries(rs.map((r) => [r.code, r.id])) as Record<string, string>,
  };
}

const alpha = () => randomToken(6).replace(/[^a-zA-Z]/g, "x").slice(0, 6);

/**
 * A fresh patient at hospital A on the family floater (so balances aren't shared between runs).
 * Recording coverage is an insurance action that Hospital Staff no longer holds, so the setup runs as the
 * test-only insurance desk of the same hospital (see insuranceDesk); the patient is still the hospital's own.
 */
export async function freshFloaterPatient(db: Db, staffA: Principal, balance = 400000) {
  const ctx = svc(db, insuranceDesk(staffA));
  const p = await PatientService.create(ctx, { fullName: `Claims Test ${alpha()}`, dob: "1982-02-02", gender: "female" });
  const cov = await CoverageService.add(ctx, p.id, {
    policyId: DEMO.policy.aarogyaFloater, memberId: `CLT-${randomToken(8).replace(/[^A-Za-z0-9]/g, "")}`, relationship: "self",
    coverStart: "2026-04-01", coverEnd: "2027-03-31", inceptionDate: "2021-04-01", sumInsured: 500000, sumInsuredAvailable: balance,
  });
  return { patient: p, coverage: cov };
}

const PREAUTH_DOCS = ["id_proof", "insurance_card", "doctor_consultation", "investigation_reports", "treatment_estimate"];

/** Full path to an approved cashless pre-authorization for a fresh patient. */
export async function approvedPreauth(db: Db, who: { staffA: Principal; insurerA: Principal }, c: Awaited<ReturnType<typeof codes>>, amount = 100000) {
  const { coverage, patient } = await freshFloaterPatient(db, who.staffA);
  const staff = svc(db, insuranceDesk(who.staffA));
  const p = await PreauthService.create(staff, {
    beneficiaryId: coverage.id, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, admissionDate: "2026-09-20",
    isAccident: "no", pedDeclared: "no", pedRelated: "unknown", estimatedCost: amount, expectedInsuranceAmount: amount, roomRentPerDay: 4000,
  });
  for (const t of PREAUTH_DOCS) await DocumentService.upload(staff, { subjectType: "preauth", subjectId: p.id, docType: t, file: file() });
  await PreauthService.runChecks(staff, p.id);
  for (const key of CHECKLIST.filter((x) => x.source.type === "manual").map((x) => x.key)) await PreauthService.confirmItem(staff, p.id, { key, confirmed: true });
  await PreauthService.submit(staff, p.id, {});
  await PreauthService.decide(svc(db, who.insurerA), p.id, { to: "approved", amount });
  return { preauth: p, coverage, patient };
}
