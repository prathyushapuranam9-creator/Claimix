import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { TpaService } from "@/modules/tpas/tpas.service";
import { TpaForm } from "@/components/insurers/PayerForms";
import { Card, PageHeader } from "@/components/ui/Surface";
import { updateTpaAction } from "../../../insurers/actions";

export const metadata: Metadata = { title: "Edit TPA · Claimix" };

export default async function EditTpaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("insurer:manage");
  const { id } = await params;
  const x = await orNotFound(TpaService.get(ctx, id));
  return (
    <>
      <PageHeader title={`Edit ${x.name}`} />
      <Card>
        <TpaForm
          action={updateTpaAction.bind(null, x.tpa.id)}
          defaults={{ name: x.name, code: x.tpa.code, phone: x.tpa.phone ?? "", email: x.tpa.email ?? "" }}
          cancelHref={`/tpas/${x.tpa.id}`}
          submitLabel="Save changes"
        />
      </Card>
    </>
  );
}
