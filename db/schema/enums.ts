import { pgEnum } from "drizzle-orm/pg-core";

export const orgType = pgEnum("org_type", ["platform", "hospital", "insurer", "tpa"]);
export const permissionScope = pgEnum("permission_scope", ["own", "organization", "all"]);
export const policyCategory = pgEnum("policy_category", ["private", "government"]);
export const networkStatus = pgEnum("network_status", ["network", "non_network", "empanelled", "suspended", "unverified"]);
export const ruleCategory = pgEnum("rule_category", [
  "eligibility", "coverage", "waiting_period", "ped", "exclusion", "limit", "document", "preauth", "claim",
]);
export const ruleResult = pgEnum("rule_result", ["PASS", "FAIL", "NEEDS_VERIFICATION"]);
export const ruleSetStatus = pgEnum("rule_set_status", ["draft", "active", "retired"]);
export const preauthStatus = pgEnum("preauth_status", [
  "draft", "submitted", "pending", "query", "approved", "partially_approved",
  "rejected", "cancelled", "final_approved", "settled",
]);
export const claimStatus = pgEnum("claim_status", [
  "draft", "submitted", "pending", "query", "approved", "partially_approved",
  "rejected", "settled", "cancelled",
]);
export const claimType = pgEnum("claim_type", ["cashless", "reimbursement"]);
export const documentStatus = pgEnum("document_status", ["missing", "uploaded", "verified", "rejected", "requires_reupload"]);
export const documentScanStatus = pgEnum("document_scan_status", ["pending", "clean", "infected", "failed"]);
export const documentCategory = pgEnum("document_category", ["patient", "medical", "hospital", "final_claim"]);
/** Whether recorded coverage has been checked against the insurance card / policy document. */
export const coverageVerification = pgEnum("coverage_verification", ["verified", "requires_verification"]);
export const payerDecision = pgEnum("payer_decision", ["approved", "partially_approved", "rejected", "query", "pending"]);
export const queryStatus = pgEnum("query_status", ["open", "responded", "closed"]);
export const settlementStatus = pgEnum("settlement_status", ["pending", "processing", "paid", "failed"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed"]);
export const gender = pgEnum("gender", ["female", "male", "other", "undisclosed"]);
/**
 * What a patient is being registered for at the front desk. "pre_auth" is a planned treatment the
 * hospital wants the payer to approve before admission; the visit is recorded here either way.
 */
export const visitType = pgEnum("visit_type", ["opd_consultation", "ip_admission", "pre_auth"]);
export const appointmentStatus = pgEnum("appointment_status", ["booked", "cancelled", "completed"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "upi", "card"]);
/** Whether the consultation amount was collected at the desk or is still to be collected. */
export const paymentState = pgEnum("payment_state", ["paid", "pending"]);
/** Where an inpatient admission has got to. */
export const admissionStatus = pgEnum("admission_status", ["admitted", "discharged", "cancelled"]);
export const reviewStatus = pgEnum("review_status", ["open", "answered", "closed"]);
export const accessRequestStatus = pgEnum("access_request_status", ["pending", "approved", "declined"]);
