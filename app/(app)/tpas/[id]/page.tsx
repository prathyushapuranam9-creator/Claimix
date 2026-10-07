import type { Metadata } from "next";
import { Suspense } from "react";
import { orNotFound, pageContext, type ServiceContext } from "@/lib/auth/context";
import { formatDateTime, formatINR } from "@/lib/india";
import { logger } from "@/lib/logging/logger";
import { can } from "@/lib/permissions/principal";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE } from "@/modules/claims/claims.workflow";
import { ClaimService } from "@/modules/claims/claims.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { PRODUCT_TYPE_LABEL } from "@/modules/policies/policies.validation";
import { STATUS_LABEL, STATUS_TONE } from "@/modules/preauth/preauth.workflow";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { TpaService } from "@/modules/tpas/tpas.service";
import { OrgActiveToggle } from "@/components/admin/OrgActiveToggle";
import { ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, LoadingState, PageHeader, Stack } from "@/components/ui/Surface";
import { setOrganizationActiveAction } from "../../admin/actions";

export const metadata: Metadata = { title: "TPA · Claimix" };

const RECENT = 5;

export default async function TpaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("insurer:read");
  const { id } = await params;
  const x = await orNotFound(TpaService.get(ctx, id));
  const tpaId = x.tpa.id;
  return (
    <>
      <PageHeader
        title={x.name}
        description={<>Third-party administrator · <span className="mono">{x.tpa.code}</span> {!x.isActive && <Badge tone="danger">Inactive</Badge>}</>}
        actions={
          <>
            {can(ctx.principal, "insurer:manage") && <ButtonLink href={`/tpas/${tpaId}/edit`} variant="secondary">Edit</ButtonLink>}
            {can(ctx.principal, "organization:manage") && (
              <OrgActiveToggle active={x.isActive} name={x.name} action={setOrganizationActiveAction.bind(null, tpaId, !x.isActive, `/tpas/${tpaId}`)} />
            )}
          </>
        }
      />
      <Stack>
        <Card title="Details">
          <Details
            columns={3}
            items={[
              ["Name", x.name],
              ["Code", <span key="code" className="mono">{x.tpa.code}</span>],
              ["Status", x.isActive ? <Badge key="s" tone="success">Active</Badge> : <Badge key="s" tone="neutral">Inactive</Badge>],
              ["Phone", x.tpa.phone],
              ["Email", x.tpa.email],
            ]}
          />
        </Card>
        <Suspense fallback={<Card title="Policies serviced"><LoadingState label="Loading policies…" /></Card>}>
          <LinkedPolicies ctx={ctx} tpaId={tpaId} />
        </Suspense>
        {can(ctx.principal, "preauth:read") && (
          <Suspense fallback={<Card title="Pre-authorizations handled by this TPA"><LoadingState label="Loading pre-authorizations…" /></Card>}>
            <Preauths ctx={ctx} tpaId={tpaId} />
          </Suspense>
        )}
        {can(ctx.principal, "claim:read") && (
          <Suspense fallback={<Card title="Claims handled by this TPA"><LoadingState label="Loading claims…" /></Card>}>
            <Claims ctx={ctx} tpaId={tpaId} />
          </Suspense>
        )}
      </Stack>
    </>
  );
}

/** A section that failed to load: logged, and shown as an error in place of its table. */
function failed(title: string, what: string, error: unknown) {
  logger.error("tpa_section_failed", { section: what, error });
  return (
    <Card title={title}>
      <Alert tone="danger">Unable to load {what}. Please refresh the page.</Alert>
    </Card>
  );
}

/** Policies this TPA administers, within what the viewer may see (an insurer: its own products only). */
async function LinkedPolicies({ ctx, tpaId }: { ctx: ServiceContext; tpaId: string }) {
  let data;
  try {
    data = await PolicyService.list(ctx, { page: 1, pageSize: 100 }, { tpaId });
  } catch (e) {
    return failed("Policies serviced", "policies", e);
  }
  return (
    <Card title={`Policies serviced (${data.total})`} padded={false}>
      <DataTable
        caption="Policies serviced by this TPA"
        rows={data.rows}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No policies are linked to this TPA" />}
        columns={[
          { key: "name", header: "Policy", cell: (r) => <CellLink href={`/policies/${r.id}`} sub={PRODUCT_TYPE_LABEL[r.productType] ?? r.productType}>{r.name}</CellLink> },
          { key: "ins", header: "Insurer", cell: (r) => r.insurerName ?? r.schemeName ?? "—" },
          { key: "si", header: "Sum insured", align: "right", nowrap: true, cell: (r) => (r.sumInsuredMax ? (r.sumInsuredMin === r.sumInsuredMax ? formatINR(r.sumInsuredMax) : `${formatINR(r.sumInsuredMin)} – ${formatINR(r.sumInsuredMax)}`) : "—") },
          { key: "st", header: "Status", cell: (r) => (r.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Withdrawn</Badge>) },
        ]}
      />
    </Card>
  );
}

/** The viewer's own pre-authorizations that this TPA administers (existing scope: hospital, payer or all). */
async function Preauths({ ctx, tpaId }: { ctx: ServiceContext; tpaId: string }) {
  let data;
  try {
    data = await PreauthService.list(ctx, { page: 1, pageSize: RECENT }, { tpaId });
  } catch (e) {
    return failed("Pre-authorizations handled by this TPA", "pre-authorizations", e);
  }
  return (
    <Card
      title={`Pre-authorizations handled by this TPA (${data.total})`}
      actions={data.total > 0 ? <ButtonLink size="sm" variant="secondary" href={`/pre-authorizations?view=all&tpa=${tpaId}`}>View all</ButtonLink> : undefined}
      padded={false}
    >
      <DataTable
        caption="Recent pre-authorizations handled by this TPA"
        rows={data.rows}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No pre-authorizations for this TPA" />}
        columns={[
          { key: "ref", header: "Reference", cell: (r) => <CellLink href={`/pre-authorizations/${r.id}`} sub={r.patientName}><span className="mono">{r.reference}</span></CellLink> },
          { key: "ins", header: "Insurer", cell: (r) => r.insurerName ?? "—" },
          { key: "st", header: "Status", cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
          { key: "upd", header: "Updated", nowrap: true, cell: (r) => <CellText>{formatDateTime(r.updatedAt)}</CellText> },
        ]}
      />
    </Card>
  );
}

/** The viewer's own claims that this TPA administers. */
async function Claims({ ctx, tpaId }: { ctx: ServiceContext; tpaId: string }) {
  let data;
  try {
    data = await ClaimService.list(ctx, { page: 1, pageSize: RECENT }, { tpaId });
  } catch (e) {
    return failed("Claims handled by this TPA", "claims", e);
  }
  return (
    <Card
      title={`Claims handled by this TPA (${data.total})`}
      actions={data.total > 0 ? <ButtonLink size="sm" variant="secondary" href={`/claims?view=all&tpa=${tpaId}`}>View all</ButtonLink> : undefined}
      padded={false}
    >
      <DataTable
        caption="Recent claims handled by this TPA"
        rows={data.rows}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No claims for this TPA" />}
        columns={[
          { key: "ref", header: "Reference", cell: (r) => <CellLink href={`/claims/${r.id}`} sub={r.patientName}><span className="mono">{r.reference}</span></CellLink> },
          { key: "amt", header: "Claimed", align: "right", nowrap: true, cell: (r) => (r.claimedAmount ? formatINR(r.claimedAmount) : "—") },
          { key: "st", header: "Status", cell: (r) => <Badge tone={CLAIM_STATUS_TONE[r.status]}>{CLAIM_STATUS_LABEL[r.status]}</Badge> },
        ]}
      />
    </Card>
  );
}
