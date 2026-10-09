"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./PatientDialog.module.css";

/**
 * A Details-block button that opens server-rendered patient content in a centred popup: a native modal
 * <dialog> (focus stays inside, the page behind is inert), closed with the X, Escape or a click outside.
 */
export function PatientDialogButton({ label, title, size = "md", children }: { label: string; title: string; size?: "md" | "lg"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <PatientDialog title={title} size={size} onClose={() => setOpen(false)}>
          {children}
        </PatientDialog>
      )}
    </>
  );
}

function PatientDialog({ title, size, onClose, children }: { title: string; size: "md" | "lg"; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-size={size}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Clicking the dimmed area outside the popup closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.frame}>
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} aria-label="Close" title="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}
