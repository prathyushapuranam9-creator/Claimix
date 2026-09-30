"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { DocumentReviewInput } from "@/modules/documents/documents.validation";
import { Button } from "@/components/ui/Button";
import styles from "./DocumentReview.module.css";

/** Payer's per-document review: verify, or ask for a re-upload / reject with a note. */
export function DocumentReview({ action, current }: { action: (i: DocumentReviewInput) => Promise<ActionResult<unknown>>; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<DocumentReviewInput["status"]>("verified");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{current === "verified" ? "Change review" : "Review"}</Button>;
  }
  return (
    <div className={styles.box}>
      <label className="visually-hidden" htmlFor={`rv-${current}`}>Outcome</label>
      <select className={styles.control} value={status} onChange={(e) => setStatus(e.target.value as DocumentReviewInput["status"])} aria-label="Review outcome">
        <option value="verified">Verified</option>
        <option value="requires_reupload">Needs re-upload</option>
        <option value="rejected">Rejected</option>
      </select>
      {status !== "verified" && (
        <input className={styles.control} placeholder="What's wrong? (shown to the hospital)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason" maxLength={500} />
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await action({ status, note: note || undefined });
              if (r.ok) { setOpen(false); setError(null); router.refresh(); } else setError(r.fieldErrors?.note?.[0] ?? r.error);
            })
          }
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
