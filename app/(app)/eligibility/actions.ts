"use server";

import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { EligibilityService, type EligibilityOutcome } from "@/modules/eligibility/eligibility.service";
import type { EligibilityInput } from "@/modules/eligibility/eligibility.validation";

export async function checkEligibilityAction(input: EligibilityInput): Promise<ActionResult<EligibilityOutcome>> {
  return runAction("eligibility.check", async () => EligibilityService.check(await actionContext(), input));
}
