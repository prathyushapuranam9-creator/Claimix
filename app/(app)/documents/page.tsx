import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { documentLabel } from "@/modules/documents/document-types";
import { DocumentListService } from "@/modules/documents/documents.service";
import type { DocStatus } from "@/modules/documents/documents.queries";
import { CLAIM_STATUS_LABEL, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { STATUS_LABEL, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { DOC_STATUS } from "@/components/documents/DocumentList";
import { DocumentViewButton } from "@/components/documents/DocumentViewer";
import { CellLink, CellText, DataTable, Pagination } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Documents · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATUSES: DocStatus[] = ["uploaded", "verified", "requires_reupload", "rejected"];

export default async function DocumentsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("document:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const s = param(sp, "status");
  const status = STATUSES.includes(s as DocStatus) ? (s as DocStatus) : undefined;
  const [docs, missing] = await Promise.all([DocumentListService.list(ctx, q, { status }), DocumentListService.missing(ctx)]);
  const href = (kind: string, id: string) => (kind === "claim" ? `/claims/${id}` : `/pre-authorizations/${id}`);

  return (
    <>
      <PageHeader title="Documents" description="Uploaded documents and open requests that are still missing mandatory documents." />
      <Stack>
        <Card title={`Missing documents (${missing.length})`} padded={false}>
          <DataTable
            caption="Requests with missing documents"
            rows={missing}
            rowKey={(r) => `${r.kind}-${r.id}`}
            empty={<EmptyState title="No open requests are missing documents" icon="✓" />}
            columns={[
              { key: "r", header: "Request", cell: (r) => <CellLink href={href(r.kind, r.id)} sub={r.patientName}><span className="mono">{r.reference}</span></CellLink> },
              { key: "k", header: "Type", cell: (r) => (r.kind === "claim" ? "Claim" : "Pre-auth") },
              { key: "s", header: "Status", cell: (r) => (r.kind === "claim" ? CLAIM_STATUS_LABEL[r.status as ClaimStatus] : STATUS_LABEL[r.status as PreauthStatus]) },
              {
                key: "m",
                header: "Missing",
                cell: (r) => (
                  <CellText sub={r.reupload > 0 ? `${r.reupload} document(s) need re-upload` : undefined}>
                    {r.missing.length ? r.missing.map(documentLabel).join(", ") : "—"}
                  </CellText>
                ),
              },
            ]}
          />
        </Card>
        <div>
          <Segmented
            current={status ?? "all"}
            items={[{ key: "all", label: "All", href: "/documents" }, ...STATUSES.map((x) => ({ key: x, label: DOC_STATUS[x]!.label, href: `/documents?status=${x}` }))]}
          />
          <Card padded={false}>
            <DataTable
              caption="Documents"
              rows={docs.rows}
              rowKey={(d) => d.id}
              empty={<EmptyState title="No documents" />}
              columns={[
                { key: "t", header: "Document", cell: (d) => <CellText sub={d.originalName}>{documentLabel(d.docType)}</CellText> },
                { key: "r", header: "Request", cell: (d) => (d.subjectId ? <CellLink href={href(d.subjectType!, d.subjectId)} sub={d.patientName}><span className="mono">{d.subjectRef}</span></CellLink> : "—") },
                { key: "s", header: "Status", cell: (d) => <CellText sub={d.statusNote}><Badge tone={DOC_STATUS[d.status]?.tone ?? "neutral"}>{DOC_STATUS[d.status]?.label ?? d.status}</Badge></CellText> },
                { key: "u", header: "Uploaded", nowrap: true, cell: (d) => <CellText sub={d.uploadedByName}>{formatDateTime(d.createdAt)}</CellText> },
                { key: "v", header: "", cell: (d) => <DocumentViewButton id={d.id} name={d.originalName} /> },
                { key: "dl", header: "", cell: (d) => (d.scanStatus === "clean" ? <a href={`/api/documents/${d.id}`} download>Download</a> : <Badge tone="danger">Blocked</Badge>) },
              ]}
            />
            {docs.total > q.pageSize && <Pagination basePath="/documents" params={{ status }} page={q.page} pageSize={q.pageSize} total={docs.total} />}
          </Card>
        </div>
      </Stack>
    </>
  );
}
