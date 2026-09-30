"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { Checklist, ChecklistItem } from "@/modules/workflow/checklist";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Alert, Badge, type Tone } from "@/components/ui/Surface";
import styles from "./ChecklistPanel.module.css";

const STATE: Record<ChecklistItem["state"], { tone: Tone; text: string; icon: string }> = {
  done: { tone: "success", text: "Done", icon: "✓" },
  failed: { tone: "danger", text: "Failed", icon: "✕" },
  needs_verification: { tone: "warning", text: "Verify", icon: "!" },
  pending: { tone: "neutral", text: "To do", icon: "○" },
};

function Item({ item, confirm, editable }: { item: ChecklistItem; confirm: (i: { key: string; confirmed: boolean; note?: string }) => Promise<ActionResult>; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const s = STATE[item.state];
  const needsNote = item.state === "needs_verification";
  const run = (confirmed: boolean) =>
    start(async () => {
      setError(null);
      const r = await confirm({ key: item.key, confirmed, note: note || undefined });
      if (r.ok) { setNote(""); router.refresh(); } else setError(r.error);
    });

  return (
    <li className={styles.item} data-state={item.state}>
      <span className={styles.icon} aria-hidden="true">{s.icon}</span>
      <div className={styles.body}>
        <p className={styles.label}>
          {item.label} <Badge tone={s.tone}>{s.text}</Badge>
          {item.state === "failed" && item.severity === "warning" && <Badge tone="info">Patient pays difference</Badge>}
        </p>
        <p className={styles.detail}>{item.detail}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {editable && item.confirmable && (
          <div className={styles.controls}>
            {needsNote && (
              <TextField label="Verification note" placeholder="Who confirmed with the payer, how, reference no." value={note} onChange={(e) => setNote(e.target.value)} />
            )}
            {item.complete ? (
              <Button size="sm" variant="ghost" onClick={() => run(false)} loading={pending}>Undo</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => run(true)} loading={pending}>{needsNote ? "Record verification" : "Confirm"}</Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function ChecklistPanel({
  checklist,
  editable,
  checked,
  confirm,
  runChecks,
  submit,
  submitLabel = "Submit Pre-Authorization",
}: {
  submitLabel?: string;
  checklist: Checklist;
  editable: boolean;
  /** Whether a current rules check exists for this draft. */
  checked: boolean;
  confirm: (i: { key: string; confirmed: boolean; note?: string }) => Promise<ActionResult>;
  runChecks: () => Promise<ActionResult>;
  submit: (i: { overrideReason?: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [override, setOverride] = useState("");
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const done = checklist.items.filter((i) => i.complete).length;

  const act = (fn: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tone: "success", text: ok } : { tone: "danger", text: r.error });
      router.refresh();
    });

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <p>
          <strong>{done} of {checklist.items.length}</strong> checks complete
        </p>
        <progress max={checklist.items.length} value={done} aria-label="Checklist progress" className={styles.progress} />
        {editable && <Button variant="secondary" onClick={() => act(runChecks, "Checks updated from the policy's rules.")} loading={pending}>{checked ? "Re-run checks" : "Run checks"}</Button>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!checked && <Alert tone="info">Run the checks after entering case details and uploading documents. Checks use this policy&apos;s own rules.</Alert>}
      <ul className={styles.list}>
        {checklist.items.map((i) => <Item key={i.key} item={i} confirm={confirm} editable={editable} />)}
      </ul>
      {editable && (
        <div className={styles.submit}>
          {checklist.hardFailures.length > 0 && (
            <>
              <Alert tone="danger" title="Some eligibility checks failed">
                The payer is likely to query or reject this request. You can still submit if there is a genuine reason; the payer makes the decision.
              </Alert>
              <TextAreaField label="Reason for submitting anyway" hint="At least 20 characters. This is recorded in the audit trail." value={override} onChange={(e) => setOverride(e.target.value)} />
            </>
          )}
          {!checklist.canSubmit && <p className={styles.detail}>Complete every item above to enable submission.</p>}
          <Button
            disabled={!checklist.canSubmit || (checklist.hardFailures.length > 0 && override.trim().length < 20)}
            loading={pending}
            onClick={() => act(() => submit({ overrideReason: override || undefined }), "Submitted to the payer.")}
          >
            {submitLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
