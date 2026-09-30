import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { rejectionReasons } from "@/db/schema";

type K = "query" | "rejection" | "both";

/** General guidance (not insurer-specific): reason → meaning → what to check → required action. */
export const REASONS: [code: string, title: string, meaning: string, check: string, action: string, kind: K][] = [
  ["policy_inactive", "Policy inactive", "The policy or scheme enrolment was not in force on the admission date.", "Policy start/end dates, renewal payment, grace period, break in cover.", "Confirm renewal status with the payer; if lapsed, treat as self-pay or another cover.", "rejection"],
  ["patient_not_eligible", "Patient not eligible", "The patient is not a covered member or falls outside the age/relationship terms.", "Member list on the policy, age on admission, relationship, beneficiary status.", "Verify the member ID and relationship; use the correct policy or scheme.", "both"],
  ["hospital_not_eligible", "Hospital not eligible", "The hospital is not in the payer's network or not empanelled for this scheme/treatment.", "Network/empanelment status and date of last verification; speciality empanelment.", "Confirm network status; switch to reimbursement if the policy allows it.", "rejection"],
  ["treatment_not_covered", "Treatment not covered", "The treatment is outside the policy's coverage.", "Exact procedure against covered treatments and packages.", "Check with the payer whether an alternative covered treatment applies.", "rejection"],
  ["waiting_period", "Waiting period", "The condition or treatment is still within an initial or specific waiting period.", "Inception date, continuous renewals, specific-illness waiting periods, accident exemption.", "Provide proof of continuity (previous policies) if applicable; otherwise self-pay.", "both"],
  ["ped", "Pre-existing disease (PED)", "The treatment is related to a pre-existing disease within its waiting period, or the PED was not disclosed.", "Proposal form declaration, past medical records, PED waiting period.", "Provide treating doctor's certificate on onset/duration if the condition is new.", "both"],
  ["exclusion", "Policy exclusion", "The condition or treatment is a permanent or specific exclusion.", "Exclusions list in the policy wording.", "Explain to the patient; claim is not payable under this policy.", "rejection"],
  ["insufficient_sum_insured", "Insufficient sum insured", "The available balance is lower than the requested amount.", "Sum insured, earlier claims in the policy year, restoration benefits.", "Patient pays the balance, or add another policy/top-up.", "both"],
  ["room_rent_limit", "Room rent limit", "The chosen room is above the eligible room rent.", "Room rent limit and whether proportionate deduction applies.", "Shift to an eligible room category or inform the patient of deductions.", "query"],
  ["sub_limit", "Treatment sub-limit", "The treatment has a cap below the requested amount.", "Sub-limits for the procedure/disease.", "Revise the estimate; patient pays the amount above the cap.", "query"],
  ["co_pay", "Co-pay", "A co-payment share applies to this claim.", "Co-pay percentage and conditions (age, zone, network).", "Collect the co-pay share from the patient at discharge.", "query"],
  ["deductible", "Deductible", "The admissible amount is within the deductible.", "Deductible amount and whether another policy has paid it.", "Submit the base policy settlement letter if the deductible was met elsewhere.", "both"],
  ["non_medical_expenses", "Non-medical expenses", "Some billed items are non-payable consumables or administrative charges.", "Itemised bill against the non-payable items list.", "Remove non-payable items from the claim or collect them from the patient.", "query"],
  ["missing_documents", "Missing documents", "Required documents were not provided.", "Document checklist for this stage.", "Upload the listed documents and resubmit.", "query"],
  ["incorrect_documents", "Incorrect documents", "Documents are illegible, unsigned, incomplete or belong to another patient.", "Names, dates, signatures, stamps and legibility on each document.", "Upload corrected, clear, signed copies.", "query"],
  ["patient_policy_mismatch", "Patient/policy mismatch", "Patient details differ between the ID, insurance card and hospital records.", "Name spelling, DOB, gender, member ID on all documents.", "Correct the hospital record or provide an endorsement/affidavit as the payer requires.", "query"],
  ["diagnosis_mismatch", "Diagnosis mismatch", "The diagnosis doesn't match the reports or the treatment requested.", "Clinical notes, investigation findings and diagnosis codes.", "Provide supporting reports or a clarified diagnosis from the treating doctor.", "query"],
  ["insufficient_medical_info", "Insufficient medical information", "The payer needs more clinical detail to assess medical necessity.", "History, examination findings, investigations, line of treatment.", "Send detailed clinical notes and reports.", "query"],
  ["treatment_mismatch", "Treatment mismatch", "The treatment given differs from what was authorized.", "Pre-auth approval vs operation notes and final bill.", "Request an enhancement or explain the change with clinical justification.", "query"],
  ["package_mismatch", "Package mismatch", "The package chosen doesn't match the procedure performed or the scheme's package list.", "Package code, procedure notes, scheme package master.", "Select the correct package and resubmit.", "query"],
  ["authorization_issue", "Authorization issue", "The admission was not authorized, the authorization expired, or amounts exceed the approval.", "Pre-auth status, validity, approved amount, enhancement requests.", "Raise an enhancement or late-intimation request with reasons.", "both"],
  ["other_policy_conditions", "Other policy conditions", "Another specific policy condition applies.", "The payer's remarks and the policy wording clause quoted.", "Read the payer's remarks and respond with the requested information.", "both"],
];

export async function seedReasons(db: DbOrTx) {
  await db
    .insert(rejectionReasons)
    .values(REASONS.map(([code, title, meaning, whatToCheck, requiredAction, kind]) => ({ code, title, meaning, whatToCheck, requiredAction, kind })))
    .onConflictDoUpdate({
      target: rejectionReasons.code,
      set: { title: sql`excluded.title`, meaning: sql`excluded.meaning`, whatToCheck: sql`excluded.what_to_check`, requiredAction: sql`excluded.required_action`, kind: sql`excluded.kind` },
    });
}
