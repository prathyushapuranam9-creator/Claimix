import { inr } from "./facts";
import { parseRuleConfig, RULE_KINDS } from "./kinds";
import type { CaseFacts, Evaluation, Outcome, RuleCategory, RuleInput, RuleResult } from "./types";

/**
 * Categories that must each have at least one rule for a stage. If a policy has
 * no rule for one, the engine cannot confirm it and says so — it never assumes.
 */
export const REQUIRED_CATEGORIES: Record<CaseFacts["stage"], RuleCategory[]> = {
  eligibility: ["eligibility", "coverage", "waiting_period", "ped", "exclusion", "limit"],
  preauth: ["eligibility", "coverage", "waiting_period", "ped", "exclusion", "limit", "document", "preauth"],
  claim: ["eligibility", "coverage", "waiting_period", "ped", "exclusion", "limit", "document"],
};

export const CATEGORY_LABEL: Record<RuleCategory, string> = {
  eligibility: "Eligibility",
  coverage: "Coverage",
  waiting_period: "Waiting period",
  ped: "Pre-existing disease",
  exclusion: "Exclusions",
  limit: "Limits",
  document: "Documents",
  preauth: "Pre-authorization",
  claim: "Claim",
};

const RANK: Record<Outcome, number> = { PASS: 0, NEEDS_VERIFICATION: 1, FAIL: 2 };

export function combine(outcomes: Outcome[]): Outcome {
  // Empty input is never a PASS: nothing was verified.
  if (outcomes.length === 0) return "NEEDS_VERIFICATION";
  return outcomes.reduce<Outcome>((a, b) => (RANK[b] > RANK[a] ? b : a), "PASS");
}

/**
 * Pure, deterministic evaluation of one policy's rules against case facts.
 * Same inputs always give the same output; no I/O, no clock (facts.asOf).
 */
export function evaluate(rules: RuleInput[], facts: CaseFacts): Evaluation {
  const results: RuleResult[] = rules.map((r) => evaluateOne(r, facts));

  for (const cat of REQUIRED_CATEGORIES[facts.stage]) {
    if (!rules.some((r) => r.category === cat)) {
      results.push({
        code: `missing_${cat}_rules`,
        title: `${CATEGORY_LABEL[cat]} rules`,
        category: cat,
        kind: "system",
        outcome: "NEEDS_VERIFICATION",
        message: `No ${CATEGORY_LABEL[cat].toLowerCase()} rules are configured for this policy. Additional verification required with the payer.`,
        missing: [`${CATEGORY_LABEL[cat]} terms for this policy`],
        applicable: true,
      });
    }
  }

  const missingInformation = [...new Set(results.flatMap((r) => r.missing))];
  const requiredDocuments = results.flatMap((r) => (Array.isArray(r.data?.documents) ? (r.data.documents as Evaluation["requiredDocuments"]) : []));
  const pre = results.filter((r) => r.kind === "preauth_required");
  const preauthRequired = pre.length === 0 || pre.some((r) => r.outcome !== "PASS") ? null : pre.some((r) => r.data?.preauthRequired === true);

  return {
    overall: combine(results.map((r) => r.outcome)),
    results,
    missingInformation,
    requiredDocuments,
    preauthRequired,
    estimate: estimate(results, facts),
  };
}

function evaluateOne(rule: RuleInput, facts: CaseFacts): RuleResult {
  const base = { ruleId: rule.id, code: rule.code, title: rule.title, category: rule.category };
  const parsed = parseRuleConfig(rule.config);
  if (!parsed.ok) {
    return { ...base, kind: "invalid", outcome: "NEEDS_VERIFICATION", message: "This rule is misconfigured, so it could not be checked. Additional verification required.", missing: [`Valid configuration for rule "${rule.title}"`], applicable: true, data: { error: parsed.error } };
  }
  const def = RULE_KINDS[parsed.kind];
  if (!(def.categories as RuleCategory[]).includes(rule.category)) {
    return { ...base, kind: parsed.kind, outcome: "NEEDS_VERIFICATION", message: `Rule kind "${def.label}" cannot be filed under ${CATEGORY_LABEL[rule.category]}. Additional verification required.`, missing: [`Correct category for rule "${rule.title}"`], applicable: true };
  }
  try {
    const r = (def.evaluate as (c: unknown, f: CaseFacts) => ReturnType<typeof def.evaluate>)(parsed.config, facts);
    return { ...base, kind: parsed.kind, outcome: r.outcome, message: r.message, missing: r.missing ?? [], applicable: r.applicable ?? true, data: r.data };
  } catch {
    // Fail closed: an evaluator error can never become a PASS.
    return { ...base, kind: parsed.kind, outcome: "NEEDS_VERIFICATION", message: "This check could not be completed. Additional verification required.", missing: [`Manual check of "${rule.title}"`], applicable: true };
  }
}

/** Indicative split of the estimate. Returned only when every limit rule could be evaluated. */
function estimate(results: RuleResult[], facts: CaseFacts): Evaluation["estimate"] {
  const cost = facts.estimatedCost;
  const limits = results.filter((r) => r.category === "limit");
  if (cost === undefined || limits.some((r) => r.outcome === "NEEDS_VERIFICATION")) return null;

  const notes: string[] = [];
  let patient = 0;
  for (const r of limits.filter((r) => r.kind === "sub_limit" && r.applicable)) {
    const excess = Number(r.data?.excess ?? 0);
    if (excess > 0) { patient += excess; notes.push(`${inr(excess)} above the ${r.title.toLowerCase()} sub-limit`); }
  }
  const ded = limits.find((r) => r.kind === "deductible");
  if (ded) {
    const d = Math.min(Number(ded.data?.deductible ?? 0), cost - patient);
    if (d > 0) { patient += d; notes.push(`${inr(d)} deductible`); }
  }
  const cp = limits.find((r) => r.kind === "co_pay" && r.applicable);
  if (cp) {
    const c = ((cost - patient) * Number(cp.data?.copayPercent ?? 0)) / 100;
    if (c > 0) { patient += c; notes.push(`${inr(c)} co-payment`); }
  }
  let payer = cost - patient;
  const si = limits.find((r) => r.kind === "sum_insured");
  if (si && typeof si.data?.availableBalance === "number" && payer > si.data.availableBalance) {
    notes.push(`${inr(payer - si.data.availableBalance)} beyond the available balance`);
    patient += payer - si.data.availableBalance;
    payer = si.data.availableBalance;
  }
  if (limits.some((r) => r.kind === "room_rent_limit" && r.outcome === "FAIL")) {
    notes.push("Room rent is above the limit: proportionate deductions may reduce the payable amount further");
  }
  notes.push("Non-medical items (consumables, registration, etc.) are usually not payable and are not included here");
  return { estimatedCost: cost, indicativePayerAmount: Math.round(payer), indicativePatientAmount: Math.round(patient), notes };
}
