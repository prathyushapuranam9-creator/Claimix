"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { WIZARD_STEPS } from "./steps";
import styles from "./NewClaimWizard.module.css";

export { WIZARD_STEPS };

export type StepState = "active" | "done" | "error" | "upcoming";

/** Horizontal stepper. Every step name is a button that opens that step (when `onGo` is given). */
export function WizardStepper({ current, states, onGo }: { current: number; states?: StepState[]; onGo?: (n: number) => void }) {
  return (
    <nav aria-label="New claim steps">
      <ol className={styles.stepper}>
        {WIZARD_STEPS.map((label, i) => {
          const n = i + 1;
          const state: StepState = n === current ? "active" : (states?.[i] ?? "upcoming");
          const stateText = state === "error" ? "Needs attention" : state === "done" ? "Completed" : state === "active" ? "Current step" : "Not started";
          return (
            <li key={label} className={styles.stepItem} data-state={state}>
              <button
                type="button"
                className={styles.stepButton}
                aria-current={n === current ? "step" : undefined}
                // Phones show only the current step's name; every step keeps its name for screen readers and as a tooltip.
                aria-label={`${label} — step ${n}: ${stateText}`}
                title={label}
                disabled={!onGo}
                onClick={() => onGo?.(n)}
              >
                <span className={styles.stepNum} aria-hidden="true">{state === "done" ? "✓" : state === "error" ? "!" : n}</span>
                <span>
                  <span className={styles.stepLabel}>{label}</span>
                  <span className={styles.stepState}>
                    <span className="visually-hidden">Step {n}: </span>
                    {stateText}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** "[Patient Name] · [Mobile Number] · case [Case ID]" shown on steps 2–5. */
export function CaseBanner({ name, mobile, reference }: { name: string; mobile?: string | null; reference: string }) {
  return (
    <p className={styles.caseBanner} data-testid="case-banner">
      <strong>{name}</strong> · {mobile || "Mobile not recorded"} · case <span className="mono">{reference}</span>
    </p>
  );
}

/** Sticky action bar. */
export function WizardFooter({ info, children }: { info: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.footer} role="group" aria-label="Wizard actions">
      <span className={styles.footerInfo}>{info}</span>
      <div className={styles.footerActions}>{children}</div>
    </div>
  );
}

/** The closing line: cases already under way and reimbursements go through the full form (the hospital's). */
export function FullFormNote({ href }: { href: string | null }) {
  return (
    <p className={styles.fullForm}>
      A case already under way, or a reimbursement?{" "}
      {href ? <Link href={href}>Register it with the full form</Link> : <>The treating hospital registers it with the full pre-authorization form.</>}
    </p>
  );
}

/** The claim form: the patient / case line above it, then the form (always fully shown). */
export function FormPanel({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel} aria-label="New claim form">
      <div className={styles.panelTitle}>{heading}</div>
      {children}
    </section>
  );
}
