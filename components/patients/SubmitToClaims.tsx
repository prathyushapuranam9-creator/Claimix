"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

/**
 * Patient Details "Submit": starts the claim from the patient's approved pre-authorization, which moves the patient
 * from Patients → Pre-Auth to Patients → Claims. The server re-checks everything (approved status, the caller's
 * hospital, no live claim on that pre-auth) and never creates a second claim for it.
 */
export function SubmitToClaims({
  patientId,
  preauth,
  reason,
  submit,
}: {
  patientId: string;
  /** The approved pre-authorization the claim is started from (null: nothing is eligible). */
  preauth: { reference: string } | null;
  /** Why Submit is unavailable, shown as its tooltip. */
  reason: string;
  /** Bound server action; absent when nothing is eligible. */
  submit?: () => Promise<ActionResult<string>>;
}) {
  const router = useRouter();
  const claimId = useRef<string | null>(null);
  if (!preauth || !submit) {
    return (
      <span title={reason}>
        <Button type="button" variant="secondary" disabled>
          Submit
        </Button>
      </span>
    );
  }
  return (
    <ConfirmButton
      label="Submit"
      title="Move this patient to Claims?"
      body={
        <p>
          A claim is started from the approved pre-authorization <span className="mono">{preauth.reference}</span>. The patient&apos;s policy, medical and
          pre-authorization details carry over, and the patient moves from Pre-Auth to Claims. No new patient record is created.
        </p>
      }
      confirmLabel="Submit to Claims"
      action={async () => {
        const r = await submit();
        if (r.ok) claimId.current = r.data;
        return r;
      }}
      onDone={() => {
        router.replace(`/patients/${patientId}?claim=${claimId.current ?? ""}`, { scroll: false });
        router.refresh();
      }}
    />
  );
}
