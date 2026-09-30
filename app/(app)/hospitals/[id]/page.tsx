import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/india";
import { can } from "@/lib/permissions/principal";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { TpaService } from "@/modules/tpas/tpas.service";
import { NetworkForm } from "@/components/hospitals/NetworkForm";
import { NetworkStatusBadge } from "@/components/hospitals/NetworkStatusBadge";
import { ButtonLink } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { OrgActiveToggle } from "@/components/admin/OrgActiveToggle";
import { setOrganizationActiveAction } from "../../admin/actions";
import { setNetworkAction } from "../actions";

export const metadata: Metadata = { title: "Hospital · Claimix" };

export default async function HospitalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("hospital:read");
  const { id } = await params;
  const h = await orNotFound(HospitalService.get(ctx, id));
  const manage = can(ctx.principal, "hospital:manage");
  const [insurers, tpas, schemes] = manage
    ? await Promise.all([InsurerService.options(ctx), TpaService.options(ctx), SchemeRepository.options(ctx.db)])
    : [[], [], []];

  const privateRows = h.networks.filter((n) => !n.schemeId);
  const schemeRows = h.networks.filter((n) => n.schemeId);
  const networkColumns = [
    { key: "payer", header: "Payer", cell: (n: (typeof h.networks)[number]) => n.payerName },
    { key: "status", header: "Status", cell: (n: (typeof h.networks)[number]) => <NetworkStatusBadge status={n.status} /> },
    { key: "cashless", header: "Cashless", cell: (n: (typeof h.networks)[number]) => (n.cashlessAvailable ? <Badge tone="success">Available</Badge> : <Badge tone="neutral">No</Badge>) },
    { key: "verified", header: "Last verified", nowrap: true, cell: (n: (typeof h.networks)[number]) => formatDate(n.lastVerifiedAt) },
  ];

  return (
    <>
      <PageHeader
        title={h.name}
        description={<>{h.hospital.city}, {h.hospital.state} {!h.isActive && <Badge tone="danger">Inactive</Badge>}</>}
        actions={
          <>
            {manage && <ButtonLink href={`/hospitals/${h.hospital.id}/edit`} variant="secondary">Edit</ButtonLink>}
            {can(ctx.principal, "organization:manage") && (
              <OrgActiveToggle active={h.isActive} name={h.name} action={setOrganizationActiveAction.bind(null, h.hospital.id, !h.isActive, `/hospitals/${h.hospital.id}`)} />
            )}
          </>
        }
      />
      <Stack>
        <Card title="Details">
          <Details
            columns={3}
            items={[
              ["Registration no.", h.hospital.registrationNo],
              ["Phone", h.hospital.phone],
              ["Email", h.hospital.email],
              ["Address", h.hospital.address],
              ["Departments", h.hospital.departments.join(", ") || null],
            ]}
          />
        </Card>
        <Alert tone="warning" title="Verify before admission">
          Network and empanelment status changes. Confirm with the insurer, TPA or scheme before promising cashless treatment.
        </Alert>
        <Card title="Private insurance network" padded={false}>
          <DataTable caption="Insurer and TPA network" rows={privateRows} rowKey={(n) => n.id} columns={networkColumns} empty={<EmptyState title="No insurer or TPA network recorded" />} />
        </Card>
        <Card title="Government scheme empanelment" padded={false}>
          <DataTable caption="Scheme empanelment" rows={schemeRows} rowKey={(n) => n.id} columns={networkColumns} empty={<EmptyState title="No scheme empanelment recorded" />} />
        </Card>
        {manage && (
          <Card title="Record or verify network status">
            <NetworkForm action={setNetworkAction.bind(null, h.hospital.id)} insurers={insurers} tpas={tpas} schemes={schemes} />
          </Card>
        )}
      </Stack>
    </>
  );
}
