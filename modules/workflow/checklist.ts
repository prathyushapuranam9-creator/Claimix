import type { Evaluation, Outcome, RuleResult } from "@/modules/rules/engine/types";

/**
 * Generic readiness checklist used by pre-authorizations and claims. Pure: the UI
 * and the server compute it from the same inputs, and the server recomputes it
 * whenever something is submitted — button state in the browser is never trusted.
 */
export type ChecklistSource =
  /** Confirmed by staff; `requires` names a data flag that must be true first. */
  | { type: "manual"; requires?: string; requiresText?: string }
  /** Satisfied when a data flag is true. */
  | { type: "data"; field: string; missingText: string }
  /** Derived from rule results, by rule kind or category. */
  | { type: "rules"; kinds?: string[]; category?: string };

/** What a failing check means: blockers must be fixed; hard failures need an override reason; warnings don't stop submission. */
export type Severity = "blocker" | "hard" | "warning";

export interface ChecklistDef {
  key: string;
  label: string;
  source: ChecklistSource;
  failSeverity: Severity;
}

export type ItemState = "done" | "failed" | "needs_verification" | "pending";

export interface ChecklistItem {
  key: string;
  label: string;
  state: ItemState;
  /** true when the item is satisfied for submission purposes. */
  complete: boolean;
  severity: Severity;
  detail: string;
  /** Manually confirmable (manual items, or rule items awaiting human verification). */
  confirmable: boolean;
}

export interface ChecklistInput {
  evaluation: Evaluation | null;
  data: Record<string, boolean>;
  manual: Record<string, { confirmed: boolean; note?: string } | undefined>;
}

export interface Checklist {
  items: ChecklistItem[];
  /** All mandatory checks complete (hard failures may still need an override reason). */
  canSubmit: boolean;
  hardFailures: ChecklistItem[];
  warnings: ChecklistItem[];
  incomplete: ChecklistItem[];
}

function worst(rs: RuleResult[]): Outcome {
  return rs.some((r) => r.outcome === "FAIL") ? "FAIL" : rs.some((r) => r.outcome === "NEEDS_VERIFICATION") ? "NEEDS_VERIFICATION" : "PASS";
}

export function computeChecklist(defs: ChecklistDef[], input: ChecklistInput): Checklist {
  const items = defs.map((d): ChecklistItem => {
    const m = input.manual[d.key];
    const base = { key: d.key, label: d.label, severity: d.failSeverity };

    if (d.source.type === "manual") {
      if (d.source.requires && !input.data[d.source.requires]) {
        return { ...base, state: "pending", complete: false, confirmable: false, detail: d.source.requiresText ?? "Complete the related details first." };
      }
      return m?.confirmed
        ? { ...base, state: "done", complete: true, confirmable: true, detail: m.note ? `Confirmed: ${m.note}` : "Confirmed by hospital staff." }
        : { ...base, state: "pending", complete: false, confirmable: true, detail: "Needs confirmation by hospital staff." };
    }

    if (d.source.type === "data") {
      const ok = !!input.data[d.source.field];
      return { ...base, state: ok ? "done" : "pending", complete: ok, confirmable: false, detail: ok ? "Recorded." : d.source.missingText };
    }

    if (!input.evaluation) return { ...base, state: "pending", complete: false, confirmable: false, detail: "Run the rule checks." };
    const src = d.source;
    const rs = input.evaluation.results.filter((r) => (src.kinds ? src.kinds.includes(r.kind) : r.category === src.category));
    if (rs.length === 0) return { ...base, state: "done", complete: true, confirmable: false, detail: "Not part of this policy's terms." };
    const w = worst(rs);
    const detail = rs.map((r) => r.message).join(" ");
    if (w === "PASS") return { ...base, state: "done", complete: true, confirmable: false, detail };
    if (w === "FAIL") return { ...base, state: "failed", complete: d.failSeverity !== "blocker", confirmable: false, detail };
    // Needs verification: resolved by supplying the information, or by a recorded human verification.
    return m?.confirmed
      ? { ...base, state: "done", complete: true, confirmable: true, detail: `Verified manually: ${m.note ?? ""}`.trim() }
      : { ...base, state: "needs_verification", complete: false, confirmable: true, detail };
  });

  const incomplete = items.filter((i) => !i.complete);
  return {
    items,
    canSubmit: incomplete.length === 0,
    hardFailures: items.filter((i) => i.state === "failed" && i.severity === "hard"),
    warnings: items.filter((i) => i.state === "failed" && i.severity === "warning"),
    incomplete,
  };
}
