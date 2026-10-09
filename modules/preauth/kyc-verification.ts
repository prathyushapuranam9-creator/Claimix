import { FACT_LABEL } from "@/modules/rules/engine/facts";
import type { Evaluation } from "@/modules/rules/engine/types";

/**
 * Facts that belong to the case (admission, diagnosis, treatment, cost, papers). They don't exist yet at KYC & Policy,
 * so a rule that only lacks these is left to AI Pre-Scrutiny instead of being raised here as a policy warning.
 */
const CASE_FACTS = new Set<string>([
  FACT_LABEL.admissionDate, FACT_LABEL.dischargeDate, FACT_LABEL.submissionDate, FACT_LABEL.diagnosisCode, FACT_LABEL.procedureCode,
  FACT_LABEL.isAccident, FACT_LABEL.pedDeclared, FACT_LABEL.pedRelated, FACT_LABEL.estimatedCost, FACT_LABEL.roomRentPerDay, FACT_LABEL.uploadedDocuments,
]);

/**
 * Step 1 (KYC & Policy) checks for New Claim. Pure: the service supplies the stored records. Nothing here is a UIDAI
 * verification — Claimix has no UIDAI connection. "Re-verify via Aadhaar/UHID" compares what the reviewer entered with
 * the patient's hospital record found by UHID; Aadhaar is compared only as a keyed hash of the number.
 */

export type VerifyStatus = "verified" | "pending" | "failed";
export type FieldResult = "match" | "mismatch" | "not_checked";

export interface KycVerification {
  status: VerifyStatus;
  checkedAt: string;
  items: { field: "uhid" | "name" | "dob" | "gender" | "aadhaar"; label: string; result: FieldResult; note: string }[];
}

export interface KycEntered {
  uhid?: string;
  patientName: string;
  gender?: string;
  dob: string;
  /** Keyed hash of the Aadhaar the reviewer entered (if any). */
  aadhaarHash?: string;
}

export interface PatientRecord {
  patientNo: string;
  fullName: string;
  gender: string;
  dob: string;
  aadhaarHash: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Verified: UHID, name and date of birth match (and Aadhaar, when both are known). Failed: anything differs. Pending: something couldn't be checked. */
export function verifyAgainstRecord(e: KycEntered, r: PatientRecord, now = new Date()): KycVerification {
  const items: KycVerification["items"] = [];
  const add = (field: KycVerification["items"][number]["field"], label: string, result: FieldResult, note: string) => items.push({ field, label, result, note });

  add("uhid", "UHID / IP Number", !e.uhid ? "not_checked" : norm(e.uhid) === norm(r.patientNo) ? "match" : "mismatch", e.uhid ? "Compared with the patient record." : "No UHID entered.");
  add("name", "Name", norm(e.patientName) === norm(r.fullName) ? "match" : "mismatch", "Compared with the patient record (spacing and punctuation ignored).");
  add("dob", "Date of birth", e.dob === r.dob ? "match" : "mismatch", "Compared with the patient record.");
  if (r.gender === "undisclosed") add("gender", "Gender", "not_checked", "Not recorded on the patient record.");
  else add("gender", "Gender", e.gender === r.gender ? "match" : "mismatch", "Compared with the patient record.");
  if (!e.aadhaarHash) add("aadhaar", "Aadhaar", "not_checked", r.aadhaarHash ? "Enter the Aadhaar number to compare it with the record." : "No Aadhaar entered or on record.");
  else if (!r.aadhaarHash) add("aadhaar", "Aadhaar", "not_checked", "No Aadhaar on the patient record to compare with.");
  else add("aadhaar", "Aadhaar", e.aadhaarHash === r.aadhaarHash ? "match" : "mismatch", "Compared with the number on the patient record (never shown).");

  const failed = items.some((i) => i.result === "mismatch");
  const required = items.filter((i) => i.field === "uhid" || i.field === "name" || i.field === "dob");
  const aadhaarUnchecked = !!e.aadhaarHash && !r.aadhaarHash;
  const status: VerifyStatus = failed ? "failed" : required.every((i) => i.result === "match") && !aadhaarUnchecked ? "verified" : "pending";
  return { status, checkedAt: now.toISOString(), items };
}

export interface PolicyWarning {
  key: string;
  /** Blockers stop the claim (existing rule: cover must be in force); warnings need an explicit acknowledgment. */
  severity: "blocker" | "warning";
  title: string;
  explanation: string;
  /** What to do about it. */
  action: string;
}

export interface PolicyFacts {
  coverStatus: "in_force" | "expired" | "not_started";
  coverStart: string;
  coverEnd: string;
  policyActive: boolean;
  policyHasTpa: boolean;
  sumInsured: number | null;
  recordedBalance: number | null;
  holds: { reference: string; amount: number }[];
  estimate: number | null;
  /** The policy's published rules at the eligibility stage (null: no published rules). */
  eligibility: Evaluation | null;
  typed: { policyNumber?: string; memberId?: string };
}

/** Available balance: the recorded balance (already reduced by settled claims) less amounts approved on other open pre-authorizations. */
export function availableBalance(f: Pick<PolicyFacts, "recordedBalance" | "holds">): number | null {
  if (f.recordedBalance === null) return null;
  return Math.max(0, f.recordedBalance - f.holds.reduce((a, h) => a + h.amount, 0));
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** The eligibility rule results to show at Policy Verification (case-dependent ones are left to Pre-Scrutiny). */
export function policyValidations(e: Evaluation | null) {
  if (!e) return [];
  return e.results
    .filter((r) => r.applicable)
    .map((r) => ({
      code: r.code,
      title: r.title,
      category: r.category,
      outcome: r.outcome,
      message: r.message,
      /** Only lacks admission / diagnosis / cost details: checked later, in AI Pre-Scrutiny. */
      atPreScrutiny: r.outcome === "NEEDS_VERIFICATION" && r.missing.every((m) => CASE_FACTS.has(m)),
    }));
}

export function policyWarnings(f: PolicyFacts): PolicyWarning[] {
  const w: PolicyWarning[] = [];
  if (f.coverStatus !== "in_force") {
    w.push({
      key: "cover_period",
      severity: "blocker",
      title: f.coverStatus === "expired" ? "Coverage has expired" : "Coverage hasn't started",
      explanation: `The recorded cover runs ${f.coverStart} to ${f.coverEnd}; a cashless claim needs cover in force today.`,
      action: "Check the policy dates with the member's policy schedule; a renewed policy must be recorded before the claim can go ahead.",
    });
  }
  if (!f.policyActive) w.push({ key: "policy_inactive", severity: "warning", title: "Policy is marked inactive", explanation: "The insurer has marked this policy inactive in Claimix; the payer may not accept new claims on it.", action: "Confirm with the insurer that the policy is still in force before admission." });
  const available = availableBalance(f);
  if (available === null) {
    w.push({ key: "balance_unknown", severity: "warning", title: "Available balance not recorded", explanation: "The member's remaining sum insured isn't recorded, so the claim can't be compared with it.", action: "Record the available balance on the member's coverage, or confirm it with the payer." });
  } else if (available <= 0) {
    w.push({ key: "balance_exhausted", severity: "warning", title: "No balance left", explanation: `After settled claims${f.holds.length ? " and open approvals" : ""}, the available sum insured is ${inr(available)}.`, action: "Tell the patient the cost may not be covered; check for a top-up or another cover." });
  } else if (f.estimate !== null && f.estimate > available) {
    w.push({ key: "balance_insufficient", severity: "warning", title: "Balance may be insufficient", explanation: `The expected cost ${inr(f.estimate)} is more than the available ${inr(available)}.`, action: "Tell the patient the difference may be payable by them." });
  }
  if (f.sumInsured === null) w.push({ key: "sum_insured_missing", severity: "warning", title: "Sum insured not recorded", explanation: "The member's sum insured is missing from the coverage record.", action: "Enter the sum insured from the policy card or schedule (Sum Insured, in 1B)." });
  if (!f.typed.policyNumber?.trim()) w.push({ key: "policy_number_missing", severity: "warning", title: "Policy number missing", explanation: "Enter the policy number from the policy card or schedule.", action: "Fill in Policy Number in 1B." });
  if (f.policyHasTpa && !f.typed.memberId?.trim()) w.push({ key: "tpa_card_missing", severity: "warning", title: "TPA card / member ID missing", explanation: "This policy is run by a TPA; its cashless card number is needed.", action: "Fill in TPA Card / Member ID in 1B." });
  if (f.eligibility === null) {
    w.push({ key: "rules_missing", severity: "warning", title: "Eligibility can't be checked", explanation: "This policy has no published rules in Claimix, so eligibility must be confirmed with the payer.", action: "Confirm eligibility with the payer before admission." });
  } else {
    // Real failures, and rules that need member / policy facts that are missing; case-dependent rules wait for Pre-Scrutiny.
    const relevant = f.eligibility.results.filter(
      (x) => x.applicable && (x.outcome === "FAIL" || (x.outcome === "NEEDS_VERIFICATION" && x.missing.some((m) => !CASE_FACTS.has(m)))),
    );
    for (const r of relevant) {
      w.push({
        key: `eligibility:${r.code}`,
        severity: "warning",
        title: r.outcome === "FAIL" ? `Eligibility: ${r.title}` : `Eligibility needs verification: ${r.title}`,
        explanation: r.message,
        action:
          r.outcome === "FAIL"
            ? "The payer may refuse or reduce the claim on this rule — confirm with the payer before admission."
            : `Provide or confirm: ${r.missing.filter((m) => !CASE_FACTS.has(m)).join(", ")}.`,
      });
    }
  }
  return w;
}
