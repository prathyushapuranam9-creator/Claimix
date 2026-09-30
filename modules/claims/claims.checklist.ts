import { computeChecklist, type ChecklistDef, type ChecklistInput } from "@/modules/workflow/checklist";

/** Final claim readiness. Same engine and enforcement as the pre-auth checklist. */
export const CLAIM_CHECKLIST: ChecklistDef[] = [
  { key: "preauth_approved", label: "Pre-authorization approved (cashless)", source: { type: "data", field: "preauth", missingText: "Cashless claims need an approved pre-authorization." }, failSeverity: "blocker" },
  { key: "dates_entered", label: "Admission and discharge dates entered", source: { type: "data", field: "dates", missingText: "Enter admission and discharge dates." }, failSeverity: "blocker" },
  { key: "treatment_entered", label: "Final diagnosis and procedure recorded", source: { type: "data", field: "treatment", missingText: "Select the final diagnosis and procedure." }, failSeverity: "blocker" },
  { key: "bill_entered", label: "Final bill amount entered", source: { type: "data", field: "bill", missingText: "Enter the final bill amount." }, failSeverity: "blocker" },
  { key: "policy_active", label: "Policy / scheme active on admission", source: { type: "rules", kinds: ["cover_active"] }, failSeverity: "hard" },
  { key: "patient_eligible", label: "Patient eligible", source: { type: "rules", kinds: ["age_range", "relationship_allowed"] }, failSeverity: "hard" },
  { key: "hospital_network", label: "Hospital network / empanelment", source: { type: "rules", kinds: ["hospital_network"] }, failSeverity: "hard" },
  { key: "coverage", label: "Treatment covered", source: { type: "rules", category: "coverage" }, failSeverity: "hard" },
  { key: "waiting_ped_exclusions", label: "Waiting period, PED and exclusions", source: { type: "rules", kinds: ["initial_waiting", "specific_waiting", "ped_waiting", "excluded_diagnoses", "excluded_procedures"] }, failSeverity: "hard" },
  { key: "limits", label: "Sum insured, room rent and sub-limits", source: { type: "rules", kinds: ["sum_insured", "room_rent_limit", "sub_limit"] }, failSeverity: "warning" },
  { key: "copay_deductible", label: "Co-pay and deductible", source: { type: "rules", kinds: ["co_pay", "deductible"] }, failSeverity: "warning" },
  { key: "documents_uploaded", label: "Final claim documents uploaded", source: { type: "rules", kinds: ["required_documents"] }, failSeverity: "blocker" },
  { key: "submission_window", label: "Submitted within the claim deadline", source: { type: "rules", kinds: ["claim_submission_window"] }, failSeverity: "hard" },
  { key: "bill_matches", label: "Final bill, discharge summary and patient details checked and match", source: { type: "manual" }, failSeverity: "blocker" },
  { key: "non_payables", label: "Non-payable items identified and explained to the patient", source: { type: "manual" }, failSeverity: "blocker" },
];

export interface ClaimChecklistInput {
  evaluation: ChecklistInput["evaluation"];
  isCashless: boolean;
  preauthApproved: boolean;
  hasDates: boolean;
  hasTreatment: boolean;
  hasBill: boolean;
  manual: ChecklistInput["manual"];
}

export function computeClaimChecklist(i: ClaimChecklistInput) {
  return computeChecklist(CLAIM_CHECKLIST, {
    evaluation: i.evaluation,
    // Reimbursement claims don't need a pre-auth, so the item is satisfied.
    data: { preauth: !i.isCashless || i.preauthApproved, dates: i.hasDates, treatment: i.hasTreatment, bill: i.hasBill },
    manual: i.manual,
  });
}
