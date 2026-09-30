import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { ReasonService } from "@/modules/reasons/reasons.service";
import { ReasonForm } from "@/components/claims/ReasonForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { updateReasonAction } from "../../actions";

export const metadata: Metadata = { title: "Edit reason · Claimix" };

export default async function EditReasonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("policy:manage");
  const { id } = await params;
  const r = await orNotFound(ReasonService.get(ctx, id));
  return (
    <>
      <PageHeader title={`Edit: ${r.title}`} description="Changes apply to guidance shown on all requests; past payer decisions are unchanged." />
      <Card>
        <ReasonForm
          action={updateReasonAction.bind(null, r.id)}
          defaults={{ title: r.title, kind: r.kind as "query" | "rejection" | "both", meaning: r.meaning, whatToCheck: r.whatToCheck, requiredAction: r.requiredAction }}
        />
      </Card>
    </>
  );
}
