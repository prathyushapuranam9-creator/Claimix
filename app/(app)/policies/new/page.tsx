import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { TpaService } from "@/modules/tpas/tpas.service";
import { PolicyForm } from "@/components/policies/PolicyForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { createPolicyAction } from "../actions";

export const metadata: Metadata = { title: "Add policy · Claimix" };

export default async function NewPolicyPage() {
  const ctx = await pageContext("policy:manage");
  const [insurers, tpas, schemes] = await Promise.all([InsurerService.options(ctx), TpaService.options(ctx), SchemeRepository.options(ctx.db)]);
  return (
    <>
      <PageHeader title="Add policy or scheme cover" description="After saving, you'll add and publish its rules." />
      <Card>
        <PolicyForm action={createPolicyAction} insurers={insurers} tpas={tpas} schemes={schemes} cancelHref="/policies" submitLabel="Save and add rules" />
      </Card>
    </>
  );
}
