"use client";

import type { ActionResult } from "@/lib/action-result";
import type { PreauthCreateInput, PreauthDetailsInput } from "@/modules/preauth/preauth.validation";
import { PreauthForm } from "./PreauthForm";

type Coded = { id: string; code: string; name: string };

/** Binds the chosen coverage to the details form for creation. */
export function NewPreauthForm({
  beneficiaryId,
  create,
  defaults,
  diagnoses,
  procedures,
}: {
  beneficiaryId: string;
  create: (i: PreauthCreateInput) => Promise<ActionResult>;
  defaults: Partial<PreauthDetailsInput>;
  diagnoses: Coded[];
  procedures: Coded[];
}) {
  return (
    <PreauthForm
      action={(v) => create({ ...v, beneficiaryId })}
      defaults={defaults}
      diagnoses={diagnoses}
      procedures={procedures}
      submitLabel="Create draft"
    />
  );
}
