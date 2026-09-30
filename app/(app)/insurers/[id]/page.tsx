import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { OrgActiveToggle } from "@/components/admin/OrgActiveToggle";
import { ButtonLink } from "@/components/ui/Button";
import { Details } from "@/components/ui/Form";
import { Badge, Card, PageHeader, Stack } from "@/components/ui/Surface";
import { setOrganizationActiveAction } from "../../admin/actions";

export const metadata: Metadata = { title: "Insurer · Claimix" };

export default async function InsurerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("insurer:read");
  const { id } = await params;
  const x = await orNotFound(InsurerService.get(ctx, id));
  return (
    <>
      <PageHeader
        title={x.name}
        description={<>Insurance company · <span className="mono">{x.insurer.code}</span> {!x.isActive && <Badge tone="danger">Inactive</Badge>}</>}
        actions={
          <>
            {can(ctx.principal, "insurer:manage") && <ButtonLink href={`/insurers/${x.insurer.id}/edit`} variant="secondary">Edit</ButtonLink>}
            {can(ctx.principal, "organization:manage") && (
              <OrgActiveToggle active={x.isActive} name={x.name} action={setOrganizationActiveAction.bind(null, x.insurer.id, !x.isActive, `/insurers/${x.insurer.id}`)} />
            )}
          </>
        }
      />
      <Stack>
        <Card title="Contact">
          <Details
            columns={3}
            items={[
              ["Claims helpline", x.insurer.claimsPhone],
              ["Claims email", x.insurer.claimsEmail],
              ["Website", x.insurer.website],
            ]}
          />
        </Card>
        <Card title="Network hospitals">
          <ButtonLink href={`/hospitals?insurer=${x.insurer.id}`} variant="secondary">View network hospitals</ButtonLink>
        </Card>
      </Stack>
    </>
  );
}
