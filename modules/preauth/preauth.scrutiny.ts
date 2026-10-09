import type { Checklist } from "@/modules/workflow/checklist";
import { documentLabel } from "@/modules/documents/document-types";

/**
 * New Claim pre-scrutiny. Pure and deterministic: it only reads what is stored on the case, the policy
 * record, the policy's published rule results and the readiness checklist. No AI model is involved and nothing
 * here decides the case; the payer does. Missing information is always reported, never treated as a pass.
 */

export type DocTier = "must" | "expected" | "optional";

export const TIER_LABEL: Record<DocTier, string> = { must: "MUST", expected: "EXPECTED", optional: "OPTIONAL" };

export interface StandardDocument {
  /** The type a new upload from this row is filed as. */
  type: string;
  /** Uploads of any of these types satisfy the row. */
  accepts: string[];
  label: string;
  tier: DocTier;
  /** The row offers the printable pre-authorization form. */
  printable?: boolean;
}

/**
 * The papers every cashless case carries (the standard pre-authorization request), independent of any insurer.
 * A policy's own published document rules are added on top and can only raise a tier.
 */
export const STANDARD_CASHLESS_DOCUMENTS: StandardDocument[] = [
  { type: "id_proof", accepts: ["id_proof"], label: "Photo ID (Aadhaar / PAN / Voter ID / Passport / DL)", tier: "expected" },
  { type: "insurance_card", accepts: ["insurance_card", "policy_copy"], label: "Policy card / e-card / policy schedule", tier: "expected" },
  { type: "preauth_form", accepts: ["preauth_form"], label: "Pre-auth form — signed by the patient and treating doctor, stamped", tier: "must", printable: true },
  {
    type: "doctor_consultation",
    accepts: ["doctor_consultation", "clinical_notes", "investigation_reports"],
    label: "Treating doctor's note (diagnosis and advised treatment) + investigation reports",
    tier: "expected",
  },
  { type: "medical_history", accepts: ["medical_history"], label: "Previous consultation papers (OP card / prescriptions before this admission)", tier: "optional" },
  { type: "treatment_estimate", accepts: ["treatment_estimate"], label: "Treatment cost estimate", tier: "optional" },
];

/** Groups of the Supporting Documents list. */
export type DocCategory = "identity" | "medical" | "financial";
export const DOC_CATEGORIES: { key: DocCategory; label: string }[] = [
  { key: "identity", label: "Identity & Policy" },
  { key: "medical", label: "Medical & Pre-Auth" },
  { key: "financial", label: "Financials & Estimates" },
];
const FINANCIAL = new Set(["treatment_estimate", "final_bill", "pharmacy_bills", "implant_invoice", "payment_receipts"]);
const IDENTITY = new Set(["id_proof", "insurance_card", "policy_copy", "beneficiary_id", "employee_id", "insurance_other", "birth_certificate", "endorsement_letter"]);
export function docCategory(type: string): DocCategory {
  return FINANCIAL.has(type) ? "financial" : IDENTITY.has(type) ? "identity" : "medical";
}

/** Extra papers for a newborn's admission (cover for a newborn usually depends on the baby being endorsed). */
export const NEWBORN_DOCUMENTS: StandardDocument[] = [
  { type: "birth_certificate", accepts: ["birth_certificate"], label: "Birth certificate / hospital birth record", tier: "expected" },
  { type: "endorsement_letter", accepts: ["endorsement_letter"], label: "Endorsement letter adding the newborn to the policy", tier: "expected" },
];

const RANK: Record<DocTier, number> = { optional: 0, expected: 1, must: 2 };

export interface WizardDocument extends StandardDocument {
  /** Where the requirement comes from. */
  source: "policy_rules" | "standard";
  uploaded: number;
}

/** Merges the standard set (plus newborn papers) with the policy rules' list and counts uploads per row. */
export function wizardDocuments(
  ruleDocs: { type: string; label: string; mandatory: boolean }[] | null,
  uploadedTypes: string[],
  opts: { newborn?: boolean } = {},
): WizardDocument[] {
  const rows: WizardDocument[] = [...STANDARD_CASHLESS_DOCUMENTS, ...(opts.newborn ? NEWBORN_DOCUMENTS : [])].map((d) => ({ ...d, accepts: [...d.accepts], source: "standard", uploaded: 0 }));
  for (const d of ruleDocs ?? []) {
    const tier: DocTier = d.mandatory ? "must" : "expected";
    // A rule names one specific type: it raises the row filed as that type, or gets its own row.
    const row = rows.find((r) => r.type === d.type);
    if (!row) rows.push({ type: d.type, accepts: [d.type], label: d.label || documentLabel(d.type), tier, source: "policy_rules", uploaded: 0 });
    else if (RANK[tier] > RANK[row.tier]) Object.assign(row, { tier, source: "policy_rules" });
  }
  for (const r of rows) r.uploaded = uploadedTypes.filter((t) => r.accepts.includes(t)).length;
  return rows;
}

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export const SEVERITY_LABEL: Record<FindingSeverity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Critical and high findings are ones the payer is likely to refuse over; medium and low, ones it may query. */
export const likelyRefusal = (s: FindingSeverity) => s === "critical" || s === "high";

export interface Finding {
  key: string;
  severity: FindingSeverity;
  title: string;
  explanation: string;
  resolution: string;
  /** The wizard step where it is fixed. */
  step: 1 | 2 | 3 | 4;
  /** A checklist item a reviewer can confirm / verify in place. */
  confirmItem?: string;
  /** A rules item that needs a written verification note (not a plain confirmation). */
  needsNote?: boolean;
}

/** What the reviewer recorded at KYC & Policy. */
export interface KycSnapshot {
  patientName: string;
  gender: string;
  dob: string;
  mobile: string;
  policyNumber: string;
  policyFrom: string;
  policyTo: string;
  sumInsured?: number;
  memberId?: string;
  tpaId?: string;
  /** Keyed hash of the Aadhaar entered at KYC (never the number itself). */
  aadhaarHash?: string;
}

/** The member as recorded (patient + coverage). */
export interface MemberRecord {
  fullName: string;
  gender: string;
  dob: string;
  memberId: string;
  coverStart: string;
  coverEnd: string;
  sumInsured: number | null;
  policyHasTpa: boolean;
  /** Keyed hash of the Aadhaar on the patient record, if any. */
  aadhaarHash?: string | null;
}

export interface ScrutinyInput {
  /** Run on the current data (any edit or upload clears the last run). */
  evaluated: boolean;
  /** Messages from the wizard's clinical validation of the stored case. */
  clinicalIssues: { field: string; message: string }[];
  documents: WizardDocument[];
  checklist: Checklist;
  estimatedCost: number | null;
  availableBalance: number | null;
  admissionType?: string;
  admissionDate?: string | null;
  today: string;
  kyc?: KycSnapshot | null;
  record?: MemberRecord | null;
  diagnosisCodes?: string[];
}

export interface Scrutiny {
  findings: Finding[];
  /** Findings the server refuses to submit with (the case details are incomplete). */
  blocking: number;
  /** Likely refusals (critical + high) and likely queries (medium + low). */
  refuse: number;
  query: number;
}

const MANUAL_STEP: Record<string, 1 | 2> = { patient_identified: 1, details_match: 1, diagnosis_confirmed: 2, procedure_confirmed: 2 };
const DATA_STEP: Record<string, 1 | 2> = { payer_identified: 1, estimate_entered: 2 };

/** The wizard step a readiness-checklist item belongs to (for grouping cleared checks). */
export function checklistStep(key: string): 1 | 2 | 3 | 4 {
  return MANUAL_STEP[key] ?? DATA_STEP[key] ?? (key === "documents_uploaded" ? 3 : 4);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Age in days on a date (YYYY-MM-DD), or null. */
export function ageInDays(dob: string, on: string): number | null {
  const a = Date.parse(`${dob}T00:00:00Z`), b = Date.parse(`${on}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.floor((b - a) / 86_400_000);
}

/** A newborn: under 91 days old on the admission date (or today when no date is recorded). */
export const NEWBORN_MAX_DAYS = 90;
export function isNewborn(dob: string | undefined, on: string): boolean {
  if (!dob) return false;
  const d = ageInDays(dob, on);
  return d !== null && d >= 0 && d <= NEWBORN_MAX_DAYS;
}

export function scrutinize(i: ScrutinyInput): Scrutiny {
  const f: Finding[] = [];
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  if (!i.evaluated) {
    f.push({
      key: "not_evaluated",
      severity: "critical",
      title: "The scrutiny engine has not run on the current details",
      explanation: "The policy's rules have not been checked against the details and papers as they are now (any change clears the last run).",
      resolution: "Select Run Checks.",
      step: 4,
    });
  }

  for (const c of i.clinicalIssues) {
    f.push({ key: `clinical:${c.field}`, severity: "critical", title: "Clinical Details & Package incomplete", explanation: c.message, resolution: "Complete it in Clinical Details & Package.", step: 2 });
  }

  // KYC typed at step 1 against the policy record.
  const k = i.kyc, r = i.record;
  if (k && r) {
    if (norm(k.patientName) !== norm(r.fullName)) {
      f.push({ key: "kyc:name", severity: "high", title: "Patient name differs from the policy record", explanation: `Typed "${k.patientName}"; the record has "${r.fullName}".`, resolution: "Check the photo ID. If the record is wrong, the policy needs an endorsement before cashless.", step: 1 });
    }
    if (k.dob !== r.dob) {
      f.push({ key: "kyc:dob", severity: "high", title: "Date of birth differs from the policy record", explanation: `Typed ${k.dob}; the record has ${r.dob}.`, resolution: "Check the photo ID; a corrected date needs an endorsement from the insurer.", step: 1 });
    }
    if (r.gender !== "undisclosed" && k.gender !== r.gender) {
      f.push({ key: "kyc:gender", severity: "high", title: "Gender differs from the policy record", explanation: `Typed ${k.gender}; the record has ${r.gender}.`, resolution: "Check the photo ID and the policy record.", step: 1 });
    }
    if (k.aadhaarHash && r.aadhaarHash && k.aadhaarHash !== r.aadhaarHash) {
      f.push({ key: "kyc:aadhaar", severity: "high", title: "Aadhaar differs from the patient record", explanation: "The Aadhaar number entered at KYC doesn't match the one on the patient's record.", resolution: "Check the Aadhaar card; the hospital corrects the patient record if it is wrong.", step: 1 });
    }
    if (k.memberId && norm(k.memberId) !== norm(r.memberId)) {
      f.push({ key: "kyc:member", severity: "high", title: "Member ID differs from the policy record", explanation: `Typed ${k.memberId}; the record has ${r.memberId}.`, resolution: "Check the card; the case is filed against the member on record.", step: 1 });
    }
    if (k.policyFrom !== r.coverStart || k.policyTo !== r.coverEnd) {
      f.push({
        key: "kyc:dates",
        severity: "medium",
        title: "Date mismatch — an endorsement may be needed",
        explanation: `The card shows ${k.policyFrom} to ${k.policyTo}; the policy record has ${r.coverStart} to ${r.coverEnd}.`,
        resolution: "Confirm the current policy period; a renewal or change in dates needs the insurer's endorsement letter.",
        step: 1,
      });
    }
    if (k.sumInsured !== undefined && r.sumInsured !== null && k.sumInsured !== r.sumInsured) {
      f.push({ key: "kyc:sum", severity: "low", title: "Sum insured differs from the policy record", explanation: `Typed ${inr(k.sumInsured)}; the record has ${inr(r.sumInsured)}.`, resolution: "The payer goes by its record; check the card or schedule.", step: 1 });
    }
    if (r.policyHasTpa && !k.memberId) {
      f.push({ key: "kyc:tpa_card", severity: "medium", title: "Missing TPA cashless card number", explanation: "This policy is run by a TPA, and its cashless card / member ID was not recorded.", resolution: "Enter the TPA card / member ID in Identity & Coverage.", step: 1 });
    }
  }
  if (r && i.admissionDate && (i.admissionDate < r.coverStart || i.admissionDate > r.coverEnd)) {
    f.push({ key: "cover:admission_outside", severity: "high", title: "Admission falls outside the policy period", explanation: `The stay starts ${i.admissionDate}; cover runs ${r.coverStart} to ${r.coverEnd}.`, resolution: "Check the admission date or the policy period.", step: 2 });
  }

  // Newborn admission (age on the admission date, from the date of birth on record).
  const on = i.admissionDate ?? i.today;
  if (r && isNewborn(r.dob, on)) {
    f.push({
      key: "newborn",
      severity: "medium",
      title: "Newborn admission — coverage constraints",
      explanation: `The patient is ${ageInDays(r.dob, on)} days old on admission. Cover for a newborn depends on the policy's newborn terms and on the baby being endorsed on the policy.`,
      resolution: "Upload the birth record and the endorsement letter, or confirm the newborn cover with the payer.",
      step: 3,
    });
    // Retinopathy of prematurity (ICD-10 H35.1x): payers ask for the screening record.
    if ((i.diagnosisCodes ?? []).some((c) => c.toUpperCase().startsWith("H35.1"))) {
      f.push({ key: "newborn:rop", severity: "medium", title: "Neonatal ROP screening confirmation required", explanation: "The diagnosis is retinopathy of prematurity in a newborn.", resolution: "Upload the ROP screening report with the doctor's note.", step: 3 });
    }
  }

  for (const d of i.documents) {
    if (d.uploaded > 0 || d.tier === "optional") continue;
    const must = d.tier === "must";
    f.push({
      key: `document:${d.type}`,
      severity: must ? "critical" : "medium",
      title: `${must ? "Missing compulsory document" : "Expected document missing"}: ${d.label}`,
      explanation: must
        ? `${d.label} is ${d.source === "policy_rules" ? "mandatory under this policy's published rules" : "part of every cashless case"}.`
        : `${d.label} is ${d.source === "policy_rules" ? "listed by this policy's rules" : "normally sent with a cashless case"}; without it the payer is likely to raise a query.`,
      resolution: "Upload it in Supporting Documents.",
      step: 3,
    });
  }

  if (i.evaluated) {
    for (const it of i.checklist.items) {
      // Documents are reported above per row; data items are covered by the clinical checks.
      if (it.key === "documents_uploaded") continue;
      if (!it.complete) {
        const manual = it.key in MANUAL_STEP;
        f.push({
          key: `check:${it.key}`,
          severity: "critical",
          title: it.label,
          explanation: it.detail,
          resolution: manual
            ? it.confirmable ? "Confirm it after checking." : it.detail
            : it.state === "needs_verification"
              ? "Supply the missing information, or verify it with the payer and record who confirmed it and how."
              : it.key in DATA_STEP ? it.detail : "Correct the details this check reads, then run the checks again.",
          step: MANUAL_STEP[it.key] ?? DATA_STEP[it.key] ?? 4,
          ...(it.confirmable ? { confirmItem: it.key, needsNote: !manual } : {}),
        });
      } else if (it.state === "failed") {
        f.push({
          key: `check:${it.key}`,
          severity: it.severity === "hard" ? "high" : "low",
          title: it.label,
          explanation: it.detail,
          resolution:
            it.severity === "hard"
              ? "Correct the data if it is wrong. Otherwise it can still be sent; the payer decides."
              : "No action needed to send; the payer applies this term when deciding.",
          step: 4,
        });
      }
    }
  }

  if (i.estimatedCost !== null && i.availableBalance !== null && i.estimatedCost > i.availableBalance) {
    f.push({
      key: "sum_insured",
      severity: "high",
      title: "Sum insured may be insufficient",
      explanation: `The expected cost is ${inr(i.estimatedCost)} against an available balance of ${inr(i.availableBalance)}.`,
      resolution: "Check the cost heads. Any amount above the balance is usually payable by the patient; the payer decides.",
      step: 2,
    });
  } else if (i.estimatedCost !== null && i.availableBalance === null) {
    f.push({ key: "sum_insured", severity: "medium", title: "Sum insured may be insufficient", explanation: "The available balance is not recorded, so the cost can't be compared with it.", resolution: "Confirm the available balance with the payer.", step: 2 });
  }
  if (i.admissionDate && i.admissionType === "planned" && i.admissionDate < i.today) {
    f.push({ key: "planned_in_past", severity: "medium", title: "Planned admission dated in the past", explanation: `The stay starts ${i.admissionDate}, which has passed, for a planned admission.`, resolution: "Correct the date, or mark the admission as emergency if it was one.", step: 2 });
  }
  if (i.admissionDate && i.admissionType === "emergency" && i.admissionDate > i.today) {
    f.push({ key: "emergency_in_future", severity: "medium", title: "Emergency admission dated in the future", explanation: `An emergency admission starts ${i.admissionDate}.`, resolution: "Correct the date, or mark the admission as planned.", step: 2 });
  }

  const order: FindingSeverity[] = ["critical", "high", "medium", "low"];
  f.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.step - b.step);
  return {
    findings: f,
    blocking: f.filter((x) => x.key.startsWith("clinical:")).length,
    refuse: f.filter((x) => likelyRefusal(x.severity)).length,
    query: f.filter((x) => !likelyRefusal(x.severity)).length,
  };
}
