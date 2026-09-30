import { computeChecklist as compute, type ChecklistDef, type ChecklistInput } from "@/modules/workflow/checklist";

export type { Checklist, ChecklistItem, ItemState } from "@/modules/workflow/checklist";

/** The 20-point pre-authorization checklist (spec §15). */
export const CHECKLIST: ChecklistDef[] = [
  { key: "patient_identified", label: "Patient identified (photo ID checked)", source: { type: "manual" }, failSeverity: "blocker" },
  { key: "payer_identified", label: "Payer identified", source: { type: "data", field: "policy", missingText: "Link the patient's policy or scheme." }, failSeverity: "blocker" },
  { key: "policy_active", label: "Policy / scheme active", source: { type: "rules", kinds: ["cover_active"] }, failSeverity: "hard" },
  { key: "patient_eligible", label: "Patient eligible", source: { type: "rules", kinds: ["age_range", "relationship_allowed"] }, failSeverity: "hard" },
  { key: "hospital_network", label: "Hospital network checked", source: { type: "rules", kinds: ["hospital_network"] }, failSeverity: "hard" },
  { key: "sum_insured", label: "Sum insured checked", source: { type: "rules", kinds: ["sum_insured"] }, failSeverity: "warning" },
  { key: "available_balance", label: "Available balance checked", source: { type: "rules", kinds: ["sum_insured"] }, failSeverity: "warning" },
  { key: "waiting_period", label: "Waiting period checked", source: { type: "rules", category: "waiting_period" }, failSeverity: "hard" },
  { key: "ped", label: "PED checked", source: { type: "rules", category: "ped" }, failSeverity: "hard" },
  { key: "exclusions", label: "Exclusions checked", source: { type: "rules", category: "exclusion" }, failSeverity: "hard" },
  { key: "diagnosis_confirmed", label: "Diagnosis confirmed by treating doctor", source: { type: "manual", requires: "diagnosis", requiresText: "Select the diagnosis first." }, failSeverity: "blocker" },
  { key: "procedure_confirmed", label: "Procedure confirmed", source: { type: "manual", requires: "procedure", requiresText: "Select the procedure first." }, failSeverity: "blocker" },
  { key: "package_checked", label: "Treatment / package checked", source: { type: "rules", category: "coverage" }, failSeverity: "hard" },
  { key: "room_eligibility", label: "Room eligibility checked", source: { type: "rules", kinds: ["room_rent_limit"] }, failSeverity: "warning" },
  { key: "sub_limit", label: "Sub-limit checked", source: { type: "rules", kinds: ["sub_limit"] }, failSeverity: "warning" },
  { key: "co_pay", label: "Co-pay checked", source: { type: "rules", kinds: ["co_pay"] }, failSeverity: "warning" },
  { key: "deductible", label: "Deductible checked", source: { type: "rules", kinds: ["deductible"] }, failSeverity: "warning" },
  { key: "documents_uploaded", label: "Required documents uploaded", source: { type: "rules", kinds: ["required_documents"] }, failSeverity: "blocker" },
  { key: "details_match", label: "Patient / policy information matches (name, DOB, member ID)", source: { type: "manual" }, failSeverity: "blocker" },
  { key: "estimate_entered", label: "Estimated cost entered", source: { type: "data", field: "estimate", missingText: "Enter the estimated treatment cost." }, failSeverity: "blocker" },
];

export interface PreauthChecklistInput {
  evaluation: ChecklistInput["evaluation"];
  hasPolicy: boolean;
  hasDiagnosis: boolean;
  hasProcedure: boolean;
  hasEstimate: boolean;
  manual: ChecklistInput["manual"];
}

export function computePreauthChecklist(i: PreauthChecklistInput) {
  return compute(CHECKLIST, {
    evaluation: i.evaluation,
    data: { policy: i.hasPolicy, diagnosis: i.hasDiagnosis, procedure: i.hasProcedure, estimate: i.hasEstimate },
    manual: i.manual,
  });
}
