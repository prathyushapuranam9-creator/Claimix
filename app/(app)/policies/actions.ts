"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { PolicyService } from "@/modules/policies/policies.service";
import type { PolicyInput } from "@/modules/policies/policies.validation";
import { RuleService } from "@/modules/rules/rules.service";
import type { RuleFormInput } from "@/modules/rules/rules.validation";

export async function createPolicyAction(input: PolicyInput): Promise<ActionResult> {
  const r = await runAction("policy.create", async () => (await PolicyService.create(await actionContext(), input)).id);
  if (r.ok) redirect(`/policies/${r.data}/rules`);
  return r;
}

export async function updatePolicyAction(id: string, input: PolicyInput): Promise<ActionResult> {
  const r = await runAction("policy.update", async () => (await PolicyService.update(await actionContext(), id, input)).id);
  if (r.ok) redirect(`/policies/${r.data}`);
  return r;
}

const rulesPath = (policyId: string) => `/policies/${policyId}/rules`;

export async function createDraftAction(policyId: string): Promise<ActionResult> {
  const r = await runAction("rules.create_draft", async () => {
    await RuleService.createDraft(await actionContext(), policyId);
    return undefined;
  });
  if (r.ok) revalidatePath(rulesPath(policyId));
  return r;
}

export async function saveRuleAction(policyId: string, versionId: string, ruleId: string | undefined, input: RuleFormInput): Promise<ActionResult> {
  const r = await runAction("rules.save_rule", async () => {
    await RuleService.saveRule(await actionContext(), versionId, input, ruleId);
    return undefined;
  });
  if (r.ok) revalidatePath(rulesPath(policyId));
  return r;
}

export async function deleteRuleAction(policyId: string, ruleId: string): Promise<ActionResult> {
  const r = await runAction("rules.delete_rule", async () => {
    await RuleService.deleteRule(await actionContext(), ruleId);
    return undefined;
  });
  if (r.ok) revalidatePath(rulesPath(policyId));
  return r;
}

export async function publishDraftAction(policyId: string, versionId: string, input: { effectiveFrom: string }): Promise<ActionResult> {
  const r = await runAction("rules.publish", async () => {
    await RuleService.publish(await actionContext(), versionId, input);
    return undefined;
  });
  if (r.ok) revalidatePath(rulesPath(policyId));
  return r;
}

export async function discardDraftAction(policyId: string, versionId: string): Promise<ActionResult> {
  const r = await runAction("rules.discard", async () => {
    await RuleService.discardDraft(await actionContext(), versionId);
    return undefined;
  });
  if (r.ok) revalidatePath(rulesPath(policyId));
  return r;
}
