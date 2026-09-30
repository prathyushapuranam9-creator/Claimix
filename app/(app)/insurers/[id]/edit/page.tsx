import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { InsurerForm } from "@/components/insurers/PayerForms";
import { Card, PageHeader } from "@/components/ui/Surface";
import { updateInsurerAction } from "../../actions";

export const metadata: Metadata = { title: "Edit insurer · Claimix" };

export default async function EditInsurerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("insurer:manage");
  const { id } = await params;
  const x = await orNotFound(InsurerService.get(ctx, id));
  return (
    <>
      <PageHeader title={`Edit ${x.name}`} />
      <Card>
        <InsurerForm
          action={updateInsurerAction.bind(null, x.insurer.id)}
          defaults={{ name: x.name, code: x.insurer.code, claimsPhone: x.insurer.claimsPhone ?? "", claimsEmail: x.insurer.claimsEmail ?? "", website: x.insurer.website ?? "" }}
          cancelHref={`/insurers/${x.insurer.id}`}
          submitLabel="Save changes"
        />
      </Card>
    </>
  );
}
