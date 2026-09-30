import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { PolicyService } from "@/modules/policies/policies.service";
import type { PolicyInfo, PolicyInput } from "@/modules/policies/policies.validation";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { TpaService } from "@/modules/tpas/tpas.service";
import { PolicyForm } from "@/components/policies/PolicyForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { updatePolicyAction } from "../../actions";

export const metadata: Metadata = { title: "Edit policy · Claimix" };

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("policy:manage");
  const { id } = await params;
  const [p, insurers, tpas, schemes] = await Promise.all([orNotFound(PolicyService.get(ctx, id)), InsurerService.options(ctx), TpaService.options(ctx), SchemeRepository.options(ctx.db)]);
  const x = p.policy;
  const defaults: Partial<PolicyInput> = {
    category: x.category,
    insurerId: x.insurerId ?? "",
    tpaId: x.tpaId ?? "",
    schemeId: x.schemeId ?? "",
    name: x.name,
    productType: x.productType,
    sumInsuredMin: x.sumInsuredMin ?? "",
    sumInsuredMax: x.sumInsuredMax ?? "",
    summary: x.summary ?? "",
    ...(x.info as PolicyInfo),
  };
  return (
    <>
      <PageHeader title={`Edit ${x.name}`} />
      <Card>
        <PolicyForm action={updatePolicyAction.bind(null, x.id)} defaults={defaults} insurers={insurers} tpas={tpas} schemes={schemes} lockCategory cancelHref={`/policies/${x.id}`} submitLabel="Save changes" />
      </Card>
    </>
  );
}
