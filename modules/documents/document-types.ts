/** Catalog of document types. Rule configs reference these `type` keys. */
export const DOCUMENT_CATEGORIES = {
  patient: "Patient documents",
  medical: "Medical documents",
  hospital: "Hospital documents",
  final_claim: "Final claim documents",
} as const;

export type DocumentCategory = keyof typeof DOCUMENT_CATEGORIES;

export const DOCUMENT_TYPES: Record<string, { label: string; category: DocumentCategory }> = {
  id_proof: { label: "Photo ID proof", category: "patient" },
  insurance_card: { label: "Insurance / health card", category: "patient" },
  policy_copy: { label: "Policy copy / member ID", category: "patient" },
  employee_id: { label: "Employee / corporate ID", category: "patient" },
  beneficiary_id: { label: "Scheme beneficiary ID / enrolment", category: "patient" },
  insurance_other: { label: "Other insurance document", category: "patient" },
  doctor_consultation: { label: "Doctor consultation note", category: "medical" },
  clinical_notes: { label: "Clinical notes & diagnosis", category: "medical" },
  medical_history: { label: "Past medical history", category: "medical" },
  blood_reports: { label: "Blood reports", category: "medical" },
  xray: { label: "X-ray", category: "medical" },
  ct_scan: { label: "CT scan", category: "medical" },
  mri: { label: "MRI", category: "medical" },
  ultrasound: { label: "Ultrasound", category: "medical" },
  ecg: { label: "ECG", category: "medical" },
  investigation_reports: { label: "Investigation reports", category: "medical" },
  surgery_recommendation: { label: "Surgery recommendation", category: "medical" },
  preauth_form: { label: "Signed pre-authorization form", category: "hospital" },
  admission_details: { label: "Admission details", category: "hospital" },
  treatment_estimate: { label: "Treatment cost estimate", category: "hospital" },
  procedure_details: { label: "Procedure details", category: "hospital" },
  final_bill: { label: "Final itemised bill", category: "final_claim" },
  discharge_summary: { label: "Discharge summary", category: "final_claim" },
  final_diagnosis: { label: "Final diagnosis", category: "final_claim" },
  operation_notes: { label: "Operation notes", category: "final_claim" },
  pharmacy_bills: { label: "Pharmacy bills", category: "final_claim" },
  implant_invoice: { label: "Implant invoice & sticker", category: "final_claim" },
  payment_receipts: { label: "Payment receipts", category: "final_claim" },
  other: { label: "Other document", category: "medical" },
};

export function documentLabel(type: string): string {
  return DOCUMENT_TYPES[type]?.label ?? type;
}

/**
 * Two document stages that are never mixed:
 *
 * - Stage A, *insurance / coverage documents*: establish or verify the patient's cover. They are held
 *   against the patient only (`documents.subject_id IS NULL`) and are what the coverage form reads.
 * - Stage B, *treatment / supporting documents*: evidence for one pre-authorization or claim, held
 *   against that request (`documents.subject_type` = 'preauth' | 'claim').
 *
 * A policy's rules may still ask for an insurance card again as evidence on a request; that is a
 * Stage B copy filed against the request and does not change the patient's coverage documents.
 */
export const INSURANCE_DOCUMENT_TYPES = ["insurance_card", "policy_copy", "beneficiary_id", "insurance_other"] as const;

export type InsuranceDocumentType = (typeof INSURANCE_DOCUMENT_TYPES)[number];

export function isInsuranceDocumentType(type: string): type is InsuranceDocumentType {
  return (INSURANCE_DOCUMENT_TYPES as readonly string[]).includes(type);
}
