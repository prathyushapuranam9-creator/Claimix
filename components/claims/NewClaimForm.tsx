"use client";

import type { ActionResult } from "@/lib/action-result";
import type { CashlessClaimInput, ClaimDetailsInput, ReimbursementClaimInput } from "@/modules/claims/claims.validation";
import { ClaimForm } from "./ClaimForm";

type Coded = { id: string; code: string; name: string };
type Result = Promise<ActionResult>;

/** Binds the chosen source (approved pre-auth or coverage) to the claim details form. */
export function NewClaimForm({
  source,
  createCashless,
  createReimbursement,
  defaults,
  diagnoses,
  procedures,
}: {
  source: { preAuthId: string } | { beneficiaryId: string };
  createCashless: (i: CashlessClaimInput) => Result;
  createReimbursement: (i: ReimbursementClaimInput) => Result;
  defaults: Partial<ClaimDetailsInput>;
  diagnoses: Coded[];
  procedures: Coded[];
}) {
  const action = (v: ClaimDetailsInput) => ("preAuthId" in source ? createCashless({ ...v, preAuthId: source.preAuthId }) : createReimbursement({ ...v, beneficiaryId: source.beneficiaryId }));
  return <ClaimForm action={action} defaults={defaults} diagnoses={diagnoses} procedures={procedures} submitLabel="Create claim draft" />;
}
