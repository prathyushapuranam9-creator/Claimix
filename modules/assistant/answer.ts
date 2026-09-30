import { documentLabel } from "@/modules/documents/document-types";
import { groupResults } from "@/modules/eligibility/eligibility.sections";
import type { Evaluation, Outcome, RuleResult } from "@/modules/rules/engine/types";
import { INTENTS, type Intent } from "./intents";

/**
 * Deterministic answer engine for the Insurance Assistant. It only reports what
 * the records say — the policy's recorded rule evaluation, the payer's recorded
 * responses, documents and workflow status — and labels every statement with
 * its source. It never decides coverage, never predicts approval, and never
 * reports a rejection that the payer hasn't recorded.
 */
export type Source = "rules" | "payer" | "record" | "guidance";

export interface Fact {
  text: string;
  source: Source;
}

export type StepState = "pass" | "fail" | "verify" | "pending" | "na";

export interface SequenceStep {
  key: string;
  label: string;
  state: StepState;
}

export interface Answer {
  intent: Intent | null;
  question: string;
  headline: string;
  status: "answered" | "needs_information" | "needs_human_review";
  facts: Fact[];
  /** Information the assistant needs before it can answer. */
  askFor: string[];
  nextSteps: string[];
  sequence: SequenceStep[];
  /** Why this should go to a person, when it should. */
  reviewReason?: string;
}

export interface PayerDecisionRecord {
  decision: string;
  reasonTitle: string | null;
  reasonMeaning: string | null;
  reasonCheck: string | null;
  reasonAction: string | null;
  remarks: string | null;
  amount: string | null;
  at: string;
}

export interface AssistantContext {
  kind: "preauth" | "claim";
  reference: string;
  status: string;
  statusLabel: string;
  claimType: "cashless" | "reimbursement";
  policyName: string;
  category: "private" | "government";
  payerName: string | null;
  evaluation: Evaluation | null;
  ruleVersion: number | null;
  documents: { docType: string; status: string }[];
  openQueries: { reasonTitle: string | null; reasonAction: string | null; message: string; requiredDocuments: string[] }[];
  /** Newest first. */
  decisions: PayerDecisionRecord[];
  /** "Next" from the latest timeline entry, and who is responsible for it. */
  nextAction: string | null;
  nextTeam?: string | null;
}

const NOT_A_DECISION = "This is platform information from the policy's configured rules, not a payer decision. The insurer/TPA or scheme makes the final decision.";

const inr = (v: string | null) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : "—");
const stateOf = (o: Outcome | undefined): StepState => (o === "PASS" ? "pass" : o === "FAIL" ? "fail" : o === "NEEDS_VERIFICATION" ? "verify" : "pending");

function worst(rs: RuleResult[]): Outcome | undefined {
  if (!rs.length) return undefined;
  return rs.some((r) => r.outcome === "FAIL") ? "FAIL" : rs.some((r) => r.outcome === "NEEDS_VERIFICATION") ? "NEEDS_VERIFICATION" : "PASS";
}

/** Spec decision sequence: PAYER → ELIGIBILITY → POLICY/SCHEME → HOSPITAL → TREATMENT → WAITING/PED/EXCLUSION → LIMITS → DOCUMENTS → AUTHORIZATION → CLAIM. */
export function decisionSequence(ctx: AssistantContext): SequenceStep[] {
  const sec = new Map(groupResults(ctx.evaluation?.results ?? []).map((s) => [s.key, s]));
  const of = (...keys: string[]) => worst(keys.flatMap((k) => sec.get(k)?.results ?? []));
  const auth: StepState =
    ctx.kind === "preauth"
      ? ["approved", "partially_approved", "final_approved", "settled"].includes(ctx.status) ? "pass"
        : ctx.status === "rejected" ? "fail"
        : ctx.status === "query" ? "verify"
        : "pending"
      : ctx.claimType === "cashless" ? "pass" : "na";
  const claim: StepState =
    ctx.kind === "claim"
      ? ctx.status === "settled" || ctx.status === "approved" || ctx.status === "partially_approved" ? "pass"
        : ctx.status === "rejected" ? "fail"
        : ctx.status === "query" ? "verify"
        : "pending"
      : "pending";
  return [
    { key: "payer", label: "Payer", state: ctx.payerName ? "pass" : "pending" },
    { key: "eligibility", label: "Eligibility", state: stateOf(of("patient")) },
    { key: "policy", label: "Policy / scheme", state: stateOf(of("active")) },
    { key: "hospital", label: "Hospital", state: stateOf(of("hospital")) },
    { key: "treatment", label: "Treatment", state: stateOf(of("coverage")) },
    { key: "waiting", label: "Waiting / PED / exclusion", state: stateOf(of("waiting", "ped", "exclusion")) },
    { key: "limits", label: "Limits", state: stateOf(of("balance", "limits")) },
    { key: "documents", label: "Documents", state: stateOf(of("documents")) },
    { key: "authorization", label: "Authorization", state: auth },
    { key: "claim", label: "Claim", state: claim },
  ];
}

/** Rule-result based answer for a set of rule kinds / categories. */
function fromRules(ctx: AssistantContext, base: Omit<Answer, "facts" | "askFor" | "status" | "headline" | "sequence" | "nextSteps">, pick: (r: RuleResult) => boolean, labels: Record<Outcome, string>, extra: Fact[] = []): Answer {
  const sequence = decisionSequence(ctx);
  if (!ctx.evaluation) {
    return {
      ...base,
      headline: "The rule checks haven't been run for this request yet.",
      status: "needs_information",
      facts: [{ text: "Nothing is assumed until the policy's rules have been checked against this case.", source: "guidance" }],
      askFor: ["Enter the case details and upload documents, then run the checks on this request."],
      nextSteps: [],
      sequence,
    };
  }
  const rs = ctx.evaluation.results.filter(pick);
  if (!rs.length) {
    return {
      ...base,
      headline: "This policy has no configured rule for this check.",
      status: "needs_human_review",
      facts: [{ text: "Without a configured rule the platform can't answer this; it must be confirmed with the payer.", source: "guidance" }],
      askFor: [],
      nextSteps: ["Confirm this point with the insurer/TPA or scheme and record the outcome."],
      sequence,
      reviewReason: "No rule is configured for this check.",
    };
  }
  const w = worst(rs)!;
  const missing = [...new Set(rs.flatMap((r) => r.missing))];
  return {
    ...base,
    headline: labels[w],
    status: w === "NEEDS_VERIFICATION" ? "needs_information" : "answered",
    facts: [
      ...rs.map((r) => ({ text: `${r.title}: ${r.message}`, source: "rules" as const })),
      ...extra,
      { text: `${NOT_A_DECISION} (Rules v${ctx.ruleVersion ?? "?"} of ${ctx.policyName}.)`, source: "guidance" },
    ],
    askFor: missing,
    nextSteps: w === "FAIL" ? ["Review the failed check with the payer before proceeding; the patient may need to pay or use another cover."] : [],
    sequence,
    reviewReason: w === "NEEDS_VERIFICATION" ? "Some information is missing or needs confirmation with the payer." : undefined,
  };
}

function uploadedTypes(ctx: AssistantContext) {
  return new Set(ctx.documents.filter((d) => d.status === "uploaded" || d.status === "verified").map((d) => d.docType));
}

export function answer(intent: Intent | null, question: string, ctx: AssistantContext): Answer {
  const base = { intent, question };
  const sequence = decisionSequence(ctx);

  if (!intent) {
    return {
      ...base,
      headline: "I can't match this question to something I can answer from the records.",
      status: "needs_human_review",
      facts: [{ text: `I can answer: ${Object.values(INTENTS).join(" · ")}`, source: "guidance" }],
      askFor: [],
      nextSteps: ["Rephrase using one of the suggested questions, or send it for human review."],
      sequence,
      reviewReason: "The question didn't match a supported topic.",
    };
  }

  switch (intent) {
    case "policy_active":
      return fromRules(ctx, base, (r) => r.kind === "cover_active", {
        PASS: "Yes — the cover is active on the admission date.",
        FAIL: "No — the cover is not active on the admission date.",
        NEEDS_VERIFICATION: "Not confirmed — some dates are missing.",
      }, [{ text: "An active policy does not mean automatic approval.", source: "guidance" }]);

    case "patient_eligible":
      return fromRules(ctx, base, (r) => ["age_range", "relationship_allowed", "cover_active"].includes(r.kind), {
        PASS: "The patient meets the policy's configured eligibility conditions.",
        FAIL: "The patient does not meet one or more eligibility conditions.",
        NEEDS_VERIFICATION: "Eligibility can't be confirmed yet — information is missing.",
      });

    case "hospital_eligible":
      return fromRules(ctx, base, (r) => r.kind === "hospital_network", {
        PASS: ctx.category === "government" ? "The hospital is recorded as empanelled for this scheme." : "The hospital is recorded as in the payer's network.",
        FAIL: "The hospital is not eligible for this payer under the policy rules.",
        NEEDS_VERIFICATION: "The hospital's network status needs to be verified with the payer.",
      }, [{ text: "Network and empanelment status change; re-verify with the payer before admission.", source: "guidance" }]);

    case "cashless_available": {
      const a = fromRules(ctx, base, (r) => r.kind === "hospital_network" || r.kind === "preauth_required", {
        PASS: ctx.claimType === "cashless" ? "Cashless is possible here, subject to the payer's pre-authorization." : "This request is set up as reimbursement, not cashless.",
        FAIL: "Cashless is not available for this case under the policy rules.",
        NEEDS_VERIFICATION: "Cashless availability can't be confirmed yet.",
      }, [{ text: "Cashless does not mean everything is free: co-pay, deductibles, non-payable items and amounts above limits are paid by the patient.", source: "guidance" }]);
      return a;
    }

    case "preauth_required": {
      const req = ctx.evaluation?.preauthRequired;
      return fromRules(ctx, base, (r) => r.kind === "preauth_required", {
        PASS: req === true ? "Yes — pre-authorization is required before admission." : req === false ? "No — pre-authorization is not required for this case." : "The requirement couldn't be determined.",
        FAIL: "The requirement couldn't be determined.",
        NEEDS_VERIFICATION: "Not confirmed — the claim type or estimate is missing.",
      }, [{ text: "A pre-authorization approval is not the final settlement; the final amount is decided on the final bill.", source: "guidance" }]);
    }

    case "documents_required": {
      if (!ctx.evaluation) return fromRules(ctx, base, () => false, { PASS: "", FAIL: "", NEEDS_VERIFICATION: "" });
      const stage = ctx.kind === "claim" ? "claim" : "preauth";
      const docs = ctx.evaluation.requiredDocuments.filter((d) => d.stage === stage);
      if (!docs.length) return fromRules(ctx, base, (r) => r.kind === "required_documents", { PASS: "", FAIL: "", NEEDS_VERIFICATION: "" });
      const have = uploadedTypes(ctx);
      return {
        ...base,
        headline: `${docs.filter((d) => d.mandatory).length} mandatory documents are required at this stage.`,
        status: "answered",
        facts: [
          ...docs.map((d) => ({ text: `${d.label}${d.mandatory ? "" : " (if applicable)"} — ${have.has(d.type) ? "uploaded" : "not uploaded"}`, source: "rules" as const })),
          { text: `From the document rules of ${ctx.policyName}. The payer may still ask for more.`, source: "guidance" },
        ],
        askFor: [],
        nextSteps: docs.filter((d) => d.mandatory && !have.has(d.type)).map((d) => `Upload: ${d.label}`),
        sequence,
      };
    }

    case "missing_documents": {
      const have = uploadedTypes(ctx);
      const stage = ctx.kind === "claim" ? "claim" : "preauth";
      const mandatoryMissing = (ctx.evaluation?.requiredDocuments ?? []).filter((d) => d.stage === stage && d.mandatory && !have.has(d.type)).map((d) => d.label);
      const reupload = ctx.documents.filter((d) => d.status === "requires_reupload" || d.status === "rejected").map((d) => documentLabel(d.docType));
      const requested = [...new Set(ctx.openQueries.flatMap((q) => q.requiredDocuments))];
      const facts: Fact[] = [
        ...mandatoryMissing.map((l) => ({ text: `Not uploaded (mandatory by the policy rules): ${l}`, source: "rules" as const })),
        ...reupload.map((l) => ({ text: `Needs re-upload or was rejected by the payer: ${l}`, source: "payer" as const })),
        ...requested.map((l) => ({ text: `Requested in the payer's open query: ${l}`, source: "payer" as const })),
      ];
      if (!ctx.evaluation && !facts.length) return fromRules(ctx, base, () => false, { PASS: "", FAIL: "", NEEDS_VERIFICATION: "" });
      return {
        ...base,
        headline: facts.length ? `${facts.length} document item(s) need attention.` : "No missing documents are recorded for this request.",
        status: "answered",
        facts: facts.length ? facts : [{ text: "All mandatory documents from the policy's rules are uploaded, and no re-upload or query is open.", source: "record" }],
        askFor: [],
        nextSteps: [...mandatoryMissing, ...reupload, ...requested].map((l) => `Upload: ${l}`),
        sequence,
      };
    }

    case "why_query": {
      const q = ctx.openQueries[0];
      const last = ctx.decisions.find((d) => d.decision === "query");
      if (!q && !last) {
        return { ...base, headline: "No query has been recorded on this request.", status: "answered", facts: [{ text: `Current status: ${ctx.statusLabel}.`, source: "record" }], askFor: [], nextSteps: [], sequence };
      }
      const facts: Fact[] = [];
      if (last?.reasonTitle) facts.push({ text: `Reason recorded by the payer: ${last.reasonTitle}.`, source: "payer" });
      if (q?.message ?? last?.remarks) facts.push({ text: `Payer's message: “${q?.message ?? last?.remarks}”`, source: "payer" });
      if (last?.reasonMeaning) facts.push({ text: `What it means: ${last.reasonMeaning}`, source: "guidance" });
      if (last?.reasonCheck) facts.push({ text: `What to check: ${last.reasonCheck}`, source: "guidance" });
      if (q?.requiredDocuments.length) facts.push({ text: `Documents requested: ${q.requiredDocuments.join(", ")}`, source: "payer" });
      return {
        ...base,
        headline: q ? "The payer has an open query on this request." : "The payer raised a query earlier (now answered).",
        status: "answered",
        facts,
        askFor: [],
        nextSteps: [q?.reasonAction ?? last?.reasonAction ?? "Respond to the query with the requested information."].filter(Boolean) as string[],
        sequence,
      };
    }

    case "why_rejected": {
      const rej = ctx.decisions.find((d) => d.decision === "rejected");
      if (ctx.status !== "rejected" || !rej) {
        return {
          ...base,
          headline: "This request has not been rejected.",
          status: "answered",
          facts: [
            { text: `Current status: ${ctx.statusLabel}.`, source: "record" },
            { text: "A request is only rejected when the payer's recorded response says so. Failed checks on the platform are not a rejection.", source: "guidance" },
          ],
          askFor: [],
          nextSteps: [],
          sequence,
        };
      }
      return {
        ...base,
        headline: `Rejected by the payer: ${rej.reasonTitle ?? "reason not specified"}.`,
        status: "answered",
        facts: [
          ...(rej.remarks ? [{ text: `Payer's remarks: “${rej.remarks}”`, source: "payer" as const }] : []),
          ...(rej.reasonMeaning ? [{ text: `What it means: ${rej.reasonMeaning}`, source: "guidance" as const }] : []),
          ...(rej.reasonCheck ? [{ text: `What to check: ${rej.reasonCheck}`, source: "guidance" as const }] : []),
        ],
        askFor: [],
        nextSteps: [rej.reasonAction ?? "Discuss the decision with the payer; an appeal or reconsideration follows the payer's own process."],
        sequence,
      };
    }

    case "what_to_check": {
      if (!ctx.evaluation) return fromRules(ctx, base, () => false, { PASS: "", FAIL: "", NEEDS_VERIFICATION: "" });
      const open = ctx.evaluation.results.filter((r) => r.outcome !== "PASS");
      return {
        ...base,
        headline: open.length ? `${open.length} check(s) need attention, in decision order below.` : "All configured checks passed. The payer still makes the decision.",
        status: open.some((r) => r.outcome === "NEEDS_VERIFICATION") ? "needs_information" : "answered",
        facts: open.length ? open.map((r) => ({ text: `${r.title}: ${r.message}`, source: "rules" as const })) : [{ text: NOT_A_DECISION, source: "guidance" }],
        askFor: [...new Set(open.flatMap((r) => r.missing))],
        nextSteps: open.filter((r) => r.outcome === "FAIL").map((r) => `Resolve or confirm with the payer: ${r.title}`),
        sequence,
        reviewReason: open.some((r) => r.outcome === "NEEDS_VERIFICATION") ? "Some checks need verification." : undefined,
      };
    }

    case "next_step": {
      const firstOpen = sequence.find((s) => s.state === "fail" || s.state === "verify" || s.state === "pending");
      const latest = ctx.decisions[0];
      const facts: Fact[] = [{ text: `Current status: ${ctx.statusLabel}.`, source: "record" }];
      if (latest) facts.push({ text: `Latest payer response: ${latest.decision.replace("_", " ")}${latest.amount ? ` (${inr(latest.amount)})` : ""}${latest.reasonTitle ? ` — ${latest.reasonTitle}` : ""}.`, source: "payer" });
      if (firstOpen) facts.push({ text: `First open step in the decision sequence: ${firstOpen.label}.`, source: "rules" });
      return {
        ...base,
        headline: ctx.nextAction ? `${ctx.nextTeam ? `${ctx.nextTeam}: ` : ""}${ctx.nextAction}` : firstOpen ? `Next: ${firstOpen.label}.` : "No further action is recorded.",
        status: "answered",
        facts,
        askFor: [],
        nextSteps: ctx.nextAction ? [ctx.nextAction] : [],
        sequence,
      };
    }
  }
}
