import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { TpaService } from "@/modules/tpas/tpas.service";
import { OrgActiveToggle } from "@/components/admin/OrgActiveToggle";
import { ButtonLink } from "@/components/ui/Button";
import { Details } from "@/components/ui/Form";
import { Badge, Card, PageHeader } from "@/components/ui/Surface";
import { setOrganizationActiveAction } from "../../admin/actions";

export const metadata: Metadata = { title: "TPA · Claimix" };

export default async function TpaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("insurer:read");
  const { id } = await params;
  const x = await orNotFound(TpaService.get(ctx, id));
  return (
    <>
      <PageHeader
        title={x.name}
        description={<>Third-party administrator · <span className="mono">{x.tpa.code}</span> {!x.isActive && <Badge tone="danger">Inactive</Badge>}</>}
        actions={
          <>
            {can(ctx.principal, "insurer:manage") && <ButtonLink href={`/tpas/${x.tpa.id}/edit`} variant="secondary">Edit</ButtonLink>}
            {can(ctx.principal, "organization:manage") && (
              <OrgActiveToggle active={x.isActive} name={x.name} action={setOrganizationActiveAction.bind(null, x.tpa.id, !x.isActive, `/tpas/${x.tpa.id}`)} />
            )}
          </>
        }
      />
      <Card title="Contact">
        <Details items={[["Phone", x.tpa.phone], ["Email", x.tpa.email]]} />
      </Card>
    </>
  );
}
