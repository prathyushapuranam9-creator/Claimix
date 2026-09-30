"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import type { AccessRequestDecisionInput } from "@/modules/access-requests/access-requests.validation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import styles from "./AccessRequestDecision.module.css";

/** Approve / decline a pending access request. Approval only records the decision; the admin then invites the person. */
export function AccessRequestDecision({
  name,
  action,
}: {
  name: string;
  action: (input: AccessRequestDecisionInput) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const decide = (decision: "approved" | "declined") =>
    start(async () => {
      setError(null);
      const r = await action({ decision, note });
      if (r.ok) router.refresh();
      else setError(r.error);
    });

  return (
    <div className={styles.box} role="group" aria-label={`Decision for ${name}`}>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField id={noteId} label="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <div className={styles.actions}>
        <Button type="button" size="sm" loading={pending} onClick={() => decide("approved")}>Approve</Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => decide("declined")}>Decline</Button>
      </div>
    </div>
  );
}
