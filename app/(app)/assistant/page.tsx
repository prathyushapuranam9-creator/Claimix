import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { param } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { AssistantService } from "@/modules/assistant/assistant.service";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Surface";
import { askAction, requestReviewAction } from "./actions";

export const metadata: Metadata = { title: "Insurance Assistant · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AssistantPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("assistant:use");
  const sp = await searchParams;
  const pre = param(sp, "preauth");
  const claim = param(sp, "claim");
  const initial = pre && UUID.test(pre) ? { type: "preauth" as const, id: pre } : claim && UUID.test(claim) ? { type: "claim" as const, id: claim } : undefined;
  const subjects = await AssistantService.subjects(ctx);
  // Keep a linked request selectable even if it isn't among the most recent.
  if (initial && !subjects.some((s) => s.id === initial.id)) subjects.unshift({ ...initial, label: "(selected request)" });

  return (
    <>
      <PageHeader
        title="Insurance Assistant"
        description="Answers questions about a pre-authorization or claim from its records and the policy's own rules. It never guarantees approval or overrides a payer's decision."
        actions={can(ctx.principal, "assistant:review") && <ButtonLink href="/assistant/reviews" variant="secondary">Human review queue</ButtonLink>}
      />
      <AssistantPanel subjects={subjects} initial={initial} ask={askAction} requestReview={requestReviewAction} />
    </>
  );
}
