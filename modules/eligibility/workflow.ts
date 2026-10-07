import type { Evaluation, Outcome } from "@/modules/rules/engine/types";
import { groupResults } from "./eligibility.sections";

export type StepState = "done" | "attention" | "blocked" | "current" | "upcoming";

export interface WorkflowStep {
  key: string;
  label: string;
  state: StepState;
  hint?: string;
}

const fromOutcome = (o: Outcome | undefined): StepState => (o === "PASS" ? "done" : o === "FAIL" ? "blocked" : o ? "attention" : "upcoming");

const DECIDED = ["approved", "partially_approved", "final_approved", "settled"];

/**
 * The hospital workflow (registration → settlement) as a progress tracker.
 * Check steps reflect the latest rules evaluation; later steps follow the pre-auth status.
 */
export function workflowSteps(input: { evaluation?: Evaluation | null; preauthStatus?: string | null; hasPatient?: boolean }): WorkflowStep[] {
  const sec = new Map(groupResults(input.evaluation?.results ?? []).map((s) => [s.key, s.outcome]));
  const worst = (...keys: string[]): Outcome | undefined => {
    const os = keys.map((k) => sec.get(k)).filter((o): o is Outcome => !!o);
    if (!os.length) return undefined;
    return os.includes("FAIL") ? "FAIL" : os.includes("NEEDS_VERIFICATION") ? "NEEDS_VERIFICATION" : "PASS";
  };
  const evaluated = !!input.evaluation;
  const s = input.preauthStatus ?? null;
  const submitted = !!s && s !== "draft";

  const steps: WorkflowStep[] = [
    { key: "patient", label: "Patient registered", state: input.hasPatient === false ? "current" : "done" },
    { key: "payer", label: "Payer identified", state: "done" },
    { key: "eligibility", label: "Eligibility & policy active", state: evaluated ? fromOutcome(worst("active", "patient")) : "current" },
    { key: "hospital", label: "Hospital network", state: evaluated ? fromOutcome(worst("hospital")) : "upcoming" },
    { key: "coverage", label: "Treatment coverage", state: evaluated ? fromOutcome(worst("coverage")) : "upcoming" },
    { key: "waiting", label: "Waiting period, PED, exclusions", state: evaluated ? fromOutcome(worst("waiting", "ped", "exclusion")) : "upcoming" },
    { key: "limits", label: "Sum insured & limits", state: evaluated ? fromOutcome(worst("balance", "limits")) : "upcoming" },
    { key: "documents", label: "Documents", state: evaluated ? fromOutcome(worst("documents")) : "upcoming" },
    { key: "submit", label: "Pre-auth submitted", state: submitted ? "done" : evaluated && s === "draft" ? "current" : "upcoming" },
    {
      key: "decision",
      label: "Payer decision",
      state: !submitted ? "upcoming" : s === "rejected" ? "blocked" : s === "query" ? "attention" : DECIDED.includes(s!) ? "done" : s === "cancelled" ? "blocked" : "current",
      hint: s === "query" ? "Query raised — respond with the requested information" : undefined,
    },
    { key: "treatment", label: "Treatment", state: s && DECIDED.includes(s) ? (s === "approved" || s === "partially_approved" ? "current" : "done") : "upcoming" },
    { key: "claim", label: "Final bill & claim", state: s === "final_approved" ? "current" : s === "settled" ? "done" : "upcoming" },
    { key: "settlement", label: "Settlement", state: s === "settled" ? "done" : "upcoming" },
  ];
  return steps;
}

/**
 * The first half of the hospital workflow, as shown on a patient's page: registration → insurance
 * document → coverage → eligibility → request. The insurance document step is marked optional
 * because coverage can always be recorded by hand; it never blocks the steps after it.
 */
export function coverageWorkflowSteps(input: {
  hasInsuranceDocument: boolean;
  coverageCount: number;
  /** Outcome of the most recent recorded eligibility check on any of this patient's coverage. */
  lastCheck?: Outcome | null;
  requestCount: number;
}): WorkflowStep[] {
  const hasCover = input.coverageCount > 0;
  return [
    { key: "patient", label: "Patient registered", state: "done" },
    {
      key: "document",
      label: "Insurance document",
      state: input.hasInsuranceDocument ? "done" : hasCover ? "upcoming" : "current",
      hint: input.hasInsuranceDocument ? undefined : "Optional — coverage can also be added manually",
    },
    { key: "coverage", label: "Coverage recorded", state: hasCover ? "done" : "current" },
    {
      key: "eligibility",
      label: "Eligibility checked",
      state: !hasCover ? "upcoming" : input.lastCheck ? fromOutcome(input.lastCheck) : "current",
    },
    {
      key: "request",
      label: "Pre-authorization / claim",
      state: input.requestCount > 0 ? "done" : input.lastCheck === "PASS" ? "current" : "upcoming",
    },
  ];
}
