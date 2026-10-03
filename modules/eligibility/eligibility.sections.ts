import { combine } from "@/modules/rules/engine/engine";
import type { Outcome, RuleResult } from "@/modules/rules/engine/types";

/**
 * How an evaluation is presented, in the order hospital staff think about it.
 * Pure presentation grouping — decisions come only from rule results.
 */
export const RESULT_SECTIONS: { key: string; label: string; match: (r: RuleResult) => boolean }[] = [
  { key: "active", label: "Policy / scheme active", match: (r) => r.kind === "cover_active" },
  { key: "patient", label: "Patient eligibility", match: (r) => r.kind === "age_range" || r.kind === "relationship_allowed" || (r.kind === "system" && r.category === "eligibility") },
  { key: "hospital", label: "Hospital network / empanelment", match: (r) => r.kind === "hospital_network" },
  { key: "coverage", label: "Treatment coverage", match: (r) => r.category === "coverage" },
  { key: "waiting", label: "Waiting period", match: (r) => r.category === "waiting_period" },
  { key: "ped", label: "Pre-existing disease", match: (r) => r.category === "ped" },
  { key: "exclusion", label: "Exclusions", match: (r) => r.category === "exclusion" },
  { key: "balance", label: "Available coverage", match: (r) => r.kind === "sum_insured" },
  { key: "limits", label: "Limits, co-pay & deductible", match: (r) => r.category === "limit" && r.kind !== "sum_insured" },
  { key: "documents", label: "Required documents", match: (r) => r.category === "document" },
  { key: "preauth", label: "Pre-authorization", match: (r) => r.category === "preauth" },
  { key: "claim", label: "Claim conditions", match: (r) => r.category === "claim" },
];

export interface Section {
  key: string;
  label: string;
  outcome: Outcome;
  results: RuleResult[];
}

export function groupResults(results: RuleResult[]): Section[] {
  const used = new Set<RuleResult>();
  const sections = RESULT_SECTIONS.map((s) => {
    const rs = results.filter((r) => !used.has(r) && s.match(r));
    rs.forEach((r) => used.add(r));
    return { key: s.key, label: s.label, results: rs, outcome: combine(rs.map((r) => r.outcome)) };
  });
  // Anything unmatched (e.g. misconfigured rules) is still shown, never dropped.
  const rest = results.filter((r) => !used.has(r));
  if (rest.length) sections.push({ key: "other", label: "Other checks", results: rest, outcome: combine(rest.map((r) => r.outcome)) });
  return sections.filter((s) => s.results.length > 0 || s.key !== "claim");
}

export const OVERALL_LABEL: Record<Outcome, { title: string; detail: string }> = {
  PASS: { title: "Eligible", detail: "All configured checks passed. The payer still makes the final decision; approval is not guaranteed." },
  FAIL: { title: "Not eligible", detail: "One or more checks failed under this policy's rules. See the reasons below." },
  NEEDS_VERIFICATION: { title: "Needs verification", detail: "Additional verification required. Some information is missing or needs confirmation with the payer." },
};

/**
 * Plain-language reasons from failed / unverified rules, for a short "Why" list.
 * Several rules can share a generic message, so each reason names its rule and exact
 * repeats are dropped — every line is unique.
 */
export function failureReasons(results: RuleResult[]): string[] {
  return [...new Set(results.filter((r) => r.applicable && r.outcome !== "PASS").map((r) => `${r.title}: ${r.message}`))];
}
