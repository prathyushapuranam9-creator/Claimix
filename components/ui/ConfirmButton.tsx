"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "./Button";
import { Alert } from "./Surface";
import styles from "./ConfirmButton.module.css";

/**
 * Button that asks for confirmation in a native modal <dialog> (focus-trapped,
 * Escape to cancel) before running a server action.
 */
export function ConfirmButton({
  label,
  icon,
  title,
  body,
  confirmLabel,
  tone = "primary",
  action,
  onDone,
}: {
  label: string;
  /** When given, the trigger is this icon alone (the label stays as its accessible name and tooltip). */
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  action: () => Promise<ActionResult<unknown>>;
  onDone?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const titleId = useId();

  return (
    <>
      {icon ? (
        <button type="button" className={`${styles.iconTrigger} ${tone === "danger" ? styles.iconDanger : ""}`} aria-label={label} title={label} aria-haspopup="dialog" onClick={() => { setError(null); ref.current?.showModal(); }}>
          {icon}
        </button>
      ) : (
        <Button type="button" variant="secondary" onClick={() => { setError(null); ref.current?.showModal(); }}>
          {label}
        </Button>
      )}
      <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <div className={styles.body}>{body}</div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={() => ref.current?.close()} disabled={pending}>Cancel</Button>
          <Button
            type="button"
            variant={tone}
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await action();
                if (r.ok) {
                  ref.current?.close();
                  onDone?.();
                } else setError(r.error);
              })
            }
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
