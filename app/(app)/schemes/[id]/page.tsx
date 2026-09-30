import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatINR } from "@/lib/india";
import { SchemeService } from "@/modules/schemes/schemes.service";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, DataTable } from "@/components/ui/DataTable";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";

export const metadata: Metadata = { title: "Scheme · Claimix" };

export default async function SchemePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("policy:read");
  const { id } = await params;
  const { scheme, covers } = await orNotFound(SchemeService.get(ctx, id));
  return (
    <>
      <PageHeader
        title={scheme.name}
        description={scheme.authority}
        actions={<ButtonLink href={`/hospitals?scheme=${scheme.id}`} variant="secondary">Empanelled hospitals</ButtonLink>}
      />
      <Stack>
        {scheme.description && <Card>{scheme.description}</Card>}
        <Card title="Scheme covers" padded={false}>
          <DataTable
            caption="Scheme covers"
            rows={covers}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No scheme covers configured" />}
            columns={[
              { key: "n", header: "Cover", cell: (r) => <CellLink href={`/policies/${r.id}`} sub="Eligibility, packages, documents, authorization and claim process">{r.name}</CellLink> },
              { key: "si", header: "Entitlement", nowrap: true, cell: (r) => (r.sumInsuredMax ? formatINR(r.sumInsuredMax) : "As per scheme") },
              { key: "r", header: "Rules", cell: (r) => (r.activeVersion ? <Badge tone="success">Version {r.activeVersion}</Badge> : <Badge tone="warning">Not published</Badge>) },
            ]}
          />
        </Card>
        <Disclaimer compact />
      </Stack>
    </>
  );
}
