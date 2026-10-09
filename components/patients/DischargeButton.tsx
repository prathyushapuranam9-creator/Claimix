"use client";

import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

/**
 * Ends an inpatient stay. Confirmed first, because a discharge is what closes the admission and frees
 * the patient from the ward list.
 */
export function DischargeButton({ action, patientName }: { action: () => Promise<ActionResult<unknown>>; patientName: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Record discharge"
      title="Record discharge"
      body={`${patientName} will be marked as discharged and will leave the list of patients in hospital. The visit and its payment stay on the patient's record.`}
      confirmLabel="Record discharge"
      action={action}
      onDone={() => router.refresh()}
    />
  );
}
