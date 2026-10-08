import type { CSSProperties } from "react";
import type { StepState, WorkflowStep } from "@/modules/eligibility/workflow";
import styles from "./WorkflowStepper.module.css";

const STATE_TEXT: Record<StepState, string> = {
  done: "Complete",
  attention: "Needs attention",
  blocked: "Blocked",
  current: "In progress",
  upcoming: "Not started",
};

const ICON: Record<StepState, string> = { done: "✓", attention: "!", blocked: "✕", current: "•", upcoming: "" };

/** Few steps spread across the whole width; many steps wrap into rows on narrow cards (see the module CSS). */
const sizeOf = (n: number) => (n <= 5 ? "s" : n <= 7 ? "m" : "l");

/** Progress tracker for the hospital workflow. The steps share the card width evenly and wrap into rows on narrow screens. */
export function WorkflowStepper({ steps, label = "Hospital workflow progress" }: { steps: WorkflowStep[]; label?: string }) {
  return (
    <nav aria-label={label} className={styles.wrap}>
      <ol className={styles.steps} data-size={sizeOf(steps.length)} style={{ "--n": steps.length } as CSSProperties}>
        {steps.map((s, i) => (
          <li key={s.key} className={styles.step} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span className={styles.marker} aria-hidden="true">{ICON[s.state] || i + 1}</span>
            <span className={styles.text}>
              <span className={styles.label}>{s.label}</span>
              <span className={styles.state}>{s.hint ?? STATE_TEXT[s.state]}</span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
