export type Outcome = "PASS" | "FAIL" | "NEEDS_VERIFICATION";

export type RuleCategory =
  | "eligibility"
  | "coverage"
  | "waiting_period"
  | "ped"
  | "exclusion"
  | "limit"
  | "document"
  | "preauth"
  | "claim";

export type Stage = "eligibility" | "preauth" | "claim";

export type NetworkStatus = "network" | "non_network" | "empanelled" | "suspended" | "unverified";

/**
 * Everything the engine may look at. Every field is optional on purpose:
 * a rule that needs an absent fact returns NEEDS_VERIFICATION — it never guesses.
 * Dates are YYYY-MM-DD; money is rupees.
 */
export interface CaseFacts {
  stage: Stage;
  /** "Today" for the evaluation; injected so results are reproducible. */
  asOf: string;
  claimType?: "cashless" | "reimbursement";
  patient?: { dob?: string; relationship?: string };
  cover?: {
    start?: string;
    end?: string;
    /** First inception with continuous renewals; waiting periods run from here. */
    inceptionDate?: string;
    sumInsured?: number;
    availableBalance?: number;
  };
  admissionDate?: string;
  dischargeDate?: string;
  submissionDate?: string;
  hospital?: { networkStatus?: NetworkStatus | null; cashlessAvailable?: boolean; lastVerifiedAt?: string | null };
  diagnosisCode?: string;
  procedureCode?: string;
  isAccident?: boolean;
  ped?: { declared?: boolean; related?: boolean };
  estimatedCost?: number;
  roomRentPerDay?: number;
  uploadedDocuments?: string[];
}

export interface RuleInput {
  id?: string;
  code: string;
  title: string;
  category: RuleCategory;
  config: unknown;
}

export interface RuleResult {
  ruleId?: string;
  code: string;
  title: string;
  category: RuleCategory;
  kind: string;
  outcome: Outcome;
  /** Plain-language explanation of this outcome. */
  message: string;
  /** Human labels of facts that were needed but absent. */
  missing: string[];
  /** False when the rule doesn't apply to this case (outcome is then PASS). */
  applicable: boolean;
  data?: Record<string, unknown>;
}

export interface Evaluation {
  overall: Outcome;
  results: RuleResult[];
  missingInformation: string[];
  requiredDocuments: { type: string; label: string; mandatory: boolean; stage: string }[];
  preauthRequired: boolean | null;
  /** Indicative only; null when any money-related fact is missing. The payer decides the real amount. */
  estimate: { estimatedCost: number; indicativePayerAmount: number; indicativePatientAmount: number; notes: string[] } | null;
}
