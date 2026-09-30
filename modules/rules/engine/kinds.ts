import { z } from "zod";
import { ageOn, codeMatches, daysBetween, fact, inr, missing } from "./facts";
import type { CaseFacts, Outcome, RuleCategory } from "./types";

/**
 * Declarative rule kinds. Each has a strict config schema, the categories it may
 * be filed under, an evaluator and a plain-language describer used by the UI.
 * Insurer specifics live only in rule configs stored in the database.
 */
interface Eval {
  outcome: Outcome;
  message: string;
  missing?: string[];
  applicable?: boolean;
  data?: Record<string, unknown>;
}

interface KindDef<S extends z.ZodType> {
  label: string;
  categories: RuleCategory[];
  schema: S;
  example: z.infer<S>;
  describe: (c: z.infer<S>) => string;
  evaluate: (c: z.infer<S>, f: CaseFacts) => Eval;
}

const codes = z.array(z.string().trim().min(1).max(20)).max(200);
const days = z.number().int().min(0).max(3650);
const money = z.number().min(0).max(1_000_000_000);
const pct = z.number().min(0).max(100);

const needs = (m: string[]): Eval => ({
  outcome: "NEEDS_VERIFICATION",
  message: "Additional verification required: some information needed for this check is missing.",
  missing: m,
});
const notApplicable = (message: string): Eval => ({ outcome: "PASS", message, applicable: false });

function yearsDays(d: number) {
  return d % 365 === 0 && d >= 365 ? `${d / 365} year${d === 365 ? "" : "s"}` : `${d} days`;
}

/** Whether a code-list rule applies; undefined when required facts are missing. */
function applies(f: CaseFacts, dx: string[] | undefined, px: string[] | undefined): { applies?: boolean; missing: string[] } {
  const need: ("diagnosisCode" | "procedureCode")[] = [];
  if (dx?.length) need.push("diagnosisCode");
  if (px?.length) need.push("procedureCode");
  const m = missing(f, ...need);
  const dxHit = !!dx?.length && !!f.diagnosisCode && codeMatches(f.diagnosisCode, dx);
  const pxHit = !!px?.length && !!f.procedureCode && codeMatches(f.procedureCode, px);
  if (dxHit || pxHit) return { applies: true, missing: [] };
  // A miss only counts as "not applicable" when every relevant fact was known.
  return m.length ? { missing: m } : { applies: false, missing: [] };
}

const k = <S extends z.ZodType>(d: KindDef<S>) => d;

export const RULE_KINDS = {
  age_range: k({
    label: "Age range",
    categories: ["eligibility"],
    schema: z.object({ minAge: z.number().int().min(0).max(120).optional(), maxAge: z.number().int().min(0).max(120).optional() }).strict()
      .refine((c) => c.minAge !== undefined || c.maxAge !== undefined, "Set a minimum or maximum age."),
    example: { minAge: 18, maxAge: 65 },
    describe: (c) => `Patient age must be ${c.minAge !== undefined ? `at least ${c.minAge}` : ""}${c.minAge !== undefined && c.maxAge !== undefined ? " and " : ""}${c.maxAge !== undefined ? `at most ${c.maxAge}` : ""} years on the admission date.`,
    evaluate: (c, f) => {
      const m = missing(f, "dob", "admissionDate");
      if (m.length) return needs(m);
      const age = ageOn(f.patient!.dob!, f.admissionDate!);
      const ok = (c.minAge === undefined || age >= c.minAge) && (c.maxAge === undefined || age <= c.maxAge);
      return ok
        ? { outcome: "PASS", message: `Patient is ${age} on admission, within the policy's age range.`, data: { age } }
        : { outcome: "FAIL", message: `Patient is ${age} on admission, outside the policy's age range.`, data: { age } };
    },
  }),

  relationship_allowed: k({
    label: "Covered relationships",
    categories: ["eligibility"],
    schema: z.object({ allowed: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(20) }).strict(),
    example: { allowed: ["self", "spouse", "child", "parent"] },
    describe: (c) => `Covers these members: ${c.allowed.join(", ")}.`,
    evaluate: (c, f) => {
      const m = missing(f, "relationship");
      if (m.length) return needs(m);
      const rel = f.patient!.relationship!.toLowerCase();
      return c.allowed.includes(rel)
        ? { outcome: "PASS", message: `"${rel}" is a covered relationship.` }
        : { outcome: "FAIL", message: `"${rel}" is not a covered relationship under this policy.` };
    },
  }),

  cover_active: k({
    label: "Policy / scheme active",
    categories: ["eligibility"],
    schema: z.object({}).strict(),
    example: {},
    describe: () => "Cover must be in force on the admission date.",
    evaluate: (_c, f) => {
      const m = missing(f, "coverStart", "coverEnd", "admissionDate");
      if (m.length) return needs(m);
      const a = f.admissionDate!;
      if (a < f.cover!.start!) return { outcome: "FAIL", message: `Cover starts on ${f.cover!.start}, after the admission date.` };
      if (a > f.cover!.end!) return { outcome: "FAIL", message: `Cover ended on ${f.cover!.end}, before the admission date.` };
      return { outcome: "PASS", message: `Cover is active on the admission date (valid until ${f.cover!.end}).` };
    },
  }),

  hospital_network: k({
    label: "Hospital network / empanelment",
    categories: ["eligibility"],
    schema: z.object({
      reimbursementAtNonNetwork: z.boolean(),
      staleAfterDays: days.default(180),
    }).strict(),
    example: { reimbursementAtNonNetwork: true, staleAfterDays: 180 },
    describe: (c) =>
      `Cashless needs a network (or empanelled) hospital verified within ${c.staleAfterDays} days.${c.reimbursementAtNonNetwork ? " Reimbursement is possible at non-network hospitals, subject to policy terms." : " Treatment at non-network hospitals is not payable."}`,
    evaluate: (c, f) => {
      const m = missing(f, "claimType", "networkStatus");
      if (fact(f, "claimType") === "reimbursement" && c.reimbursementAtNonNetwork) {
        return { outcome: "PASS", message: "Reimbursement can be claimed at non-network hospitals, subject to the policy terms." };
      }
      if (m.length) return needs(m);
      const s = f.hospital!.networkStatus!;
      if (s === "suspended") return { outcome: "FAIL", message: "This hospital's network status with the payer is suspended." };
      if (s === "non_network") {
        return f.claimType === "cashless"
          ? { outcome: "FAIL", message: "Hospital is not in the payer's network, so cashless is not available." + (c.reimbursementAtNonNetwork ? " Reimbursement may be possible." : "") }
          : { outcome: "FAIL", message: "Treatment at non-network hospitals is not payable under this policy." };
      }
      if (s === "unverified") return needs(["Confirmation of the hospital's network status with the payer"]);
      const verified = f.hospital?.lastVerifiedAt;
      if (!verified || daysBetween(verified.slice(0, 10), f.asOf) > c.staleAfterDays) {
        return needs([`Network status re-verified within the last ${c.staleAfterDays} days`]);
      }
      if (f.claimType === "cashless" && !f.hospital?.cashlessAvailable) {
        return { outcome: "FAIL", message: "Hospital is in network but cashless is not available for this payer." };
      }
      return { outcome: "PASS", message: s === "empanelled" ? "Hospital is empanelled for this scheme." : "Hospital is in the payer's network." };
    },
  }),

  procedure_coverage: k({
    label: "Covered treatments",
    categories: ["coverage"],
    schema: z.object({ covered: codes.min(1), unlisted: z.enum(["fail", "needs_verification"]) }).strict(),
    example: { covered: ["PTCA", "LAP-CHOLE"], unlisted: "needs_verification" },
    describe: (c) =>
      `Listed covered treatments: ${c.covered.join(", ")}. Treatments not on the list ${c.unlisted === "fail" ? "are not covered" : "need confirmation from the payer"}.`,
    evaluate: (c, f) => {
      const m = missing(f, "procedureCode");
      if (m.length) return needs(m);
      if (codeMatches(f.procedureCode!, c.covered)) return { outcome: "PASS", message: `${f.procedureCode} is a listed covered treatment.` };
      return c.unlisted === "fail"
        ? { outcome: "FAIL", message: `${f.procedureCode} is not on this policy's list of covered treatments.` }
        : needs([`Payer confirmation that ${f.procedureCode} is covered (not on the listed treatments)`]);
    },
  }),

  initial_waiting: k({
    label: "Initial waiting period",
    categories: ["waiting_period"],
    schema: z.object({ days, exceptAccident: z.boolean() }).strict(),
    example: { days: 30, exceptAccident: true },
    describe: (c) => `No claims in the first ${yearsDays(c.days)} from inception${c.exceptAccident ? ", except for accidents" : ""}.`,
    evaluate: (c, f) => {
      const m = missing(f, "inception", "admissionDate");
      if (m.length) return needs(m);
      const served = daysBetween(fact(f, "inception") as string, f.admissionDate!);
      if (served >= c.days) return { outcome: "PASS", message: `Initial waiting period of ${yearsDays(c.days)} is complete.`, data: { daysServed: served } };
      if (c.exceptAccident) {
        if (f.isAccident === undefined) return needs(missing(f, "isAccident"));
        if (f.isAccident) return { outcome: "PASS", message: "Within the initial waiting period, but accidents are exempt." };
      }
      return { outcome: "FAIL", message: `Admission is ${served} days after inception; the initial waiting period is ${yearsDays(c.days)}.`, data: { daysServed: served } };
    },
  }),

  specific_waiting: k({
    label: "Specific-illness waiting period",
    categories: ["waiting_period"],
    schema: z.object({ label: z.string().trim().min(2).max(120), days, diagnosisCodes: codes.optional(), procedureCodes: codes.optional() }).strict()
      .refine((c) => (c.diagnosisCodes?.length ?? 0) + (c.procedureCodes?.length ?? 0) > 0, "List at least one diagnosis or procedure code."),
    example: { label: "Cataract", days: 730, diagnosisCodes: ["H25"], procedureCodes: ["CATARACT-PHACO"] },
    describe: (c) => `${c.label}: ${yearsDays(c.days)} waiting period from inception.`,
    evaluate: (c, f) => {
      const a = applies(f, c.diagnosisCodes, c.procedureCodes);
      if (a.applies === undefined) return needs(a.missing);
      if (!a.applies) return notApplicable(`${c.label} waiting period does not apply to this treatment.`);
      const m = missing(f, "inception", "admissionDate");
      if (m.length) return needs(m);
      const served = daysBetween(fact(f, "inception") as string, f.admissionDate!);
      return served >= c.days
        ? { outcome: "PASS", message: `${c.label} waiting period (${yearsDays(c.days)}) is complete.` }
        : { outcome: "FAIL", message: `${c.label} has a ${yearsDays(c.days)} waiting period; only ${served} days have passed since inception.` };
    },
  }),

  ped_waiting: k({
    label: "Pre-existing disease (PED) waiting period",
    categories: ["ped"],
    schema: z.object({ days }).strict(),
    example: { days: 1095 },
    describe: (c) => (c.days === 0 ? "Declared pre-existing diseases are covered from day one." : `Treatment related to a declared pre-existing disease is covered after ${yearsDays(c.days)} of continuous cover.`),
    evaluate: (c, f) => {
      const d = fact(f, "pedDeclared");
      if (d === undefined) return needs(missing(f, "pedDeclared"));
      if (d === false) {
        return { outcome: "PASS", message: "No pre-existing disease declared. Note: an undeclared pre-existing condition found later can lead to rejection." };
      }
      const r = fact(f, "pedRelated");
      if (r === undefined) return needs(missing(f, "pedRelated"));
      if (r === false) return { outcome: "PASS", message: "Treatment is not related to the declared pre-existing disease." };
      if (c.days === 0) return { outcome: "PASS", message: "Pre-existing diseases are covered from day one under this cover." };
      const m = missing(f, "inception", "admissionDate");
      if (m.length) return needs(m);
      const served = daysBetween(fact(f, "inception") as string, f.admissionDate!);
      return served >= c.days
        ? { outcome: "PASS", message: `PED waiting period (${yearsDays(c.days)}) is complete.` }
        : { outcome: "FAIL", message: `Treatment is related to a declared PED; the PED waiting period is ${yearsDays(c.days)} and ${served} days have passed.` };
    },
  }),

  excluded_diagnoses: k({
    label: "Excluded conditions",
    categories: ["exclusion"],
    schema: z.object({ codes: codes.min(1), reason: z.string().trim().min(2).max(200) }).strict(),
    example: { codes: ["Z41.1"], reason: "Cosmetic treatment" },
    describe: (c) => `Not covered: ${c.reason} (${c.codes.join(", ")}).`,
    evaluate: (c, f) => {
      const m = missing(f, "diagnosisCode");
      if (m.length) return needs(m);
      return codeMatches(f.diagnosisCode!, c.codes)
        ? { outcome: "FAIL", message: `Diagnosis ${f.diagnosisCode} falls under a permanent exclusion: ${c.reason}.` }
        : { outcome: "PASS", message: `Diagnosis is not in the "${c.reason}" exclusion.` };
    },
  }),

  excluded_procedures: k({
    label: "Excluded treatments",
    categories: ["exclusion"],
    schema: z.object({ codes: codes.min(1), reason: z.string().trim().min(2).max(200) }).strict(),
    example: { codes: ["BARIATRIC"], reason: "Weight-loss surgery" },
    describe: (c) => `Not covered: ${c.reason} (${c.codes.join(", ")}).`,
    evaluate: (c, f) => {
      const m = missing(f, "procedureCode");
      if (m.length) return needs(m);
      return codeMatches(f.procedureCode!, c.codes)
        ? { outcome: "FAIL", message: `Treatment ${f.procedureCode} is excluded: ${c.reason}.` }
        : { outcome: "PASS", message: `Treatment is not in the "${c.reason}" exclusion.` };
    },
  }),

  sum_insured: k({
    label: "Sum insured / available balance",
    categories: ["limit"],
    schema: z.object({}).strict(),
    example: {},
    describe: () => "The payable amount cannot exceed the available sum insured balance.",
    evaluate: (_c, f) => {
      const m = missing(f, "estimatedCost", "availableBalance");
      if (m.length) return needs(m);
      const cost = f.estimatedCost!;
      const bal = f.cover!.availableBalance!;
      return cost <= bal
        ? { outcome: "PASS", message: `Estimated cost ${inr(cost)} is within the available balance of ${inr(bal)}.`, data: { availableBalance: bal } }
        : { outcome: "FAIL", message: `Estimated cost exceeds the available balance by ${inr(cost - bal)}; the difference would be payable by the patient.`, data: { availableBalance: bal, shortfall: cost - bal } };
    },
  }),

  room_rent_limit: k({
    label: "Room rent limit",
    categories: ["limit"],
    schema: z.object({ basis: z.enum(["percent_of_sum_insured", "fixed_per_day"]), value: z.number().positive().max(1_000_000), proportionateDeduction: z.boolean() }).strict(),
    example: { basis: "percent_of_sum_insured", value: 1, proportionateDeduction: true },
    describe: (c) =>
      `Room rent up to ${c.basis === "percent_of_sum_insured" ? `${c.value}% of sum insured` : inr(c.value)} per day.${c.proportionateDeduction ? " A costlier room can reduce other payable charges proportionately." : ""}`,
    evaluate: (c, f) => {
      const m = missing(f, "roomRentPerDay", ...(c.basis === "percent_of_sum_insured" ? (["sumInsured"] as const) : []));
      if (m.length) return needs(m);
      const limit = c.basis === "percent_of_sum_insured" ? (f.cover!.sumInsured! * c.value) / 100 : c.value;
      const rent = f.roomRentPerDay!;
      if (rent <= limit) return { outcome: "PASS", message: `Room rent ${inr(rent)}/day is within the limit of ${inr(limit)}/day.`, data: { limitPerDay: limit } };
      return {
        outcome: "FAIL",
        message: `Room rent ${inr(rent)}/day exceeds the limit of ${inr(limit)}/day.${c.proportionateDeduction ? " Other charges may be reduced proportionately — consider an eligible room category." : " The excess rent is payable by the patient."}`,
        data: { limitPerDay: limit, excessPerDay: rent - limit },
      };
    },
  }),

  sub_limit: k({
    label: "Treatment sub-limit",
    categories: ["limit"],
    schema: z.object({ label: z.string().trim().min(2).max(120), maxAmount: money, diagnosisCodes: codes.optional(), procedureCodes: codes.optional() }).strict()
      .refine((c) => (c.diagnosisCodes?.length ?? 0) + (c.procedureCodes?.length ?? 0) > 0, "List at least one diagnosis or procedure code."),
    example: { label: "Cataract (per eye)", maxAmount: 40000, diagnosisCodes: ["H25"], procedureCodes: ["CATARACT-PHACO"] },
    describe: (c) => `${c.label}: payable up to ${inr(c.maxAmount)}.`,
    evaluate: (c, f) => {
      const a = applies(f, c.diagnosisCodes, c.procedureCodes);
      if (a.applies === undefined) return needs(a.missing);
      if (!a.applies) return notApplicable(`${c.label} sub-limit does not apply.`);
      const m = missing(f, "estimatedCost");
      if (m.length) return needs(m);
      const cost = f.estimatedCost!;
      return cost <= c.maxAmount
        ? { outcome: "PASS", message: `Within the ${c.label} sub-limit of ${inr(c.maxAmount)}.`, data: { subLimit: c.maxAmount, excess: 0 } }
        : { outcome: "FAIL", message: `${c.label} is capped at ${inr(c.maxAmount)}; about ${inr(cost - c.maxAmount)} would be payable by the patient.`, data: { subLimit: c.maxAmount, excess: cost - c.maxAmount } };
    },
  }),

  co_pay: k({
    label: "Co-payment",
    categories: ["limit"],
    schema: z.object({ percent: pct, minAge: z.number().int().min(0).max(120).optional() }).strict(),
    example: { percent: 20, minAge: 60 },
    describe: (c) => `Patient pays ${c.percent}% of each admissible claim${c.minAge !== undefined ? ` when aged ${c.minAge} or above` : ""}.`,
    evaluate: (c, f) => {
      if (c.minAge !== undefined) {
        const m = missing(f, "dob", "admissionDate");
        if (m.length) return needs(m);
        if (ageOn(f.patient!.dob!, f.admissionDate!) < c.minAge) return notApplicable(`Co-pay applies only from age ${c.minAge}.`);
      }
      return { outcome: "PASS", message: `A ${c.percent}% co-payment applies; the patient pays this share of the admissible amount.`, data: { copayPercent: c.percent } };
    },
  }),

  deductible: k({
    label: "Deductible",
    categories: ["limit"],
    schema: z.object({ amount: money }).strict(),
    example: { amount: 300000 },
    describe: (c) => `The first ${inr(c.amount)} of admissible expenses is not payable by this cover.`,
    evaluate: (c) => ({ outcome: "PASS", message: `A deductible of ${inr(c.amount)} applies before this cover pays.`, data: { deductible: c.amount } }),
  }),

  required_documents: k({
    label: "Required documents",
    categories: ["document"],
    schema: z.object({
      stage: z.enum(["preauth", "claim"]),
      documents: z.array(z.object({ type: z.string().trim().regex(/^[a-z0-9_]+$/).max(60), label: z.string().trim().min(2).max(120), mandatory: z.boolean() }).strict()).min(1).max(50),
    }).strict(),
    example: { stage: "preauth", documents: [{ type: "id_proof", label: "Photo ID proof", mandatory: true }] },
    describe: (c) => `For ${c.stage === "preauth" ? "pre-authorization" : "the final claim"}: ${c.documents.map((d) => d.label + (d.mandatory ? "" : " (if applicable)")).join(", ")}.`,
    evaluate: (c, f) => {
      const list = c.documents.map((d) => ({ ...d, stage: c.stage }));
      if (f.stage === "eligibility") {
        return { outcome: "PASS", applicable: true, message: `${list.filter((d) => d.mandatory).length} mandatory documents will be needed for ${c.stage === "preauth" ? "pre-authorization" : "the claim"}.`, data: { documents: list } };
      }
      if (f.stage !== c.stage) return { ...notApplicable("Documents for a different stage."), data: { documents: list } };
      const up = fact(f, "uploadedDocuments") as string[] | undefined;
      if (!up) return { ...needs(missing(f, "uploadedDocuments")), data: { documents: list } };
      const absent = c.documents.filter((d) => d.mandatory && !up.includes(d.type));
      return absent.length
        ? { outcome: "FAIL", message: `Missing mandatory documents: ${absent.map((d) => d.label).join(", ")}.`, data: { documents: list, missingDocuments: absent.map((d) => d.type) } }
        : { outcome: "PASS", message: "All mandatory documents are uploaded.", data: { documents: list } };
    },
  }),

  preauth_required: k({
    label: "Pre-authorization requirement",
    categories: ["preauth"],
    schema: z.object({ claimTypes: z.array(z.enum(["cashless", "reimbursement"])).min(1), aboveAmount: money.optional() }).strict(),
    example: { claimTypes: ["cashless"] },
    describe: (c) => `Pre-authorization is required for ${c.claimTypes.join(" and ")} admissions${c.aboveAmount !== undefined ? ` above ${inr(c.aboveAmount)}` : ""}.`,
    evaluate: (c, f) => {
      const m = missing(f, "claimType", ...(c.aboveAmount !== undefined ? (["estimatedCost"] as const) : []));
      if (m.length) return needs(m);
      const required = c.claimTypes.includes(f.claimType!) && (c.aboveAmount === undefined || f.estimatedCost! > c.aboveAmount);
      return { outcome: "PASS", message: required ? "Pre-authorization is required before admission." : "Pre-authorization is not required for this admission.", data: { preauthRequired: required } };
    },
  }),

  claim_submission_window: k({
    label: "Claim submission deadline",
    categories: ["claim"],
    schema: z.object({ daysAfterDischarge: days }).strict(),
    example: { daysAfterDischarge: 30 },
    describe: (c) => `Submit the final claim within ${c.daysAfterDischarge} days of discharge.`,
    evaluate: (c, f) => {
      if (f.stage !== "claim") return notApplicable("Checked when the claim is submitted.");
      const m = missing(f, "dischargeDate", "submissionDate");
      if (m.length) return needs(m);
      const d = daysBetween(f.dischargeDate!, f.submissionDate!);
      return d <= c.daysAfterDischarge
        ? { outcome: "PASS", message: `Submitted ${d} days after discharge, within the ${c.daysAfterDischarge}-day window.` }
        : { outcome: "FAIL", message: `Submitted ${d} days after discharge; the window is ${c.daysAfterDischarge} days. Delay condonation may be requested from the payer.` };
    },
  }),
} as const;

export type RuleKind = keyof typeof RULE_KINDS;

export const RULE_KIND_KEYS = Object.keys(RULE_KINDS) as RuleKind[];

/** Rule config as stored: { kind, ...kindConfig }. */
export function parseRuleConfig(raw: unknown): { ok: true; kind: RuleKind; config: unknown } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Rule config must be an object." };
  const { kind, ...rest } = raw as { kind?: unknown };
  if (typeof kind !== "string" || !(kind in RULE_KINDS)) return { ok: false, error: `Unknown rule kind "${String(kind)}".` };
  const def = RULE_KINDS[kind as RuleKind];
  const parsed = (def.schema as z.ZodType).safeParse(rest);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || kind}: ${i.message}`).join("; ") };
  return { ok: true, kind: kind as RuleKind, config: parsed.data };
}

/** Plain-language description of a stored rule, or null if misconfigured. */
export function describeRule(raw: unknown): string | null {
  const p = parseRuleConfig(raw);
  if (!p.ok) return null;
  return (RULE_KINDS[p.kind].describe as (c: unknown) => string)(p.config);
}
