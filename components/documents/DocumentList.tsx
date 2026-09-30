import { formatDateTime } from "@/lib/india";
import type { ActionResult } from "@/lib/action-result";
import { documentLabel } from "@/modules/documents/document-types";
import type { DocumentReviewInput } from "@/modules/documents/documents.validation";
import { Badge, EmptyState, type Tone } from "@/components/ui/Surface";
import { DataTable, CellText } from "@/components/ui/DataTable";
import { DocumentReview } from "./DocumentReview";

interface Doc {
  id: string;
  docType: string;
  status: string;
  scanStatus: string;
  originalName: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedByName: string | null;
  statusNote: string | null;
}

export const DOC_STATUS: Record<string, { tone: Tone; label: string }> = {
  missing: { tone: "neutral", label: "Missing" },
  uploaded: { tone: "info", label: "Uploaded" },
  verified: { tone: "success", label: "Verified" },
  rejected: { tone: "danger", label: "Rejected" },
  requires_reupload: { tone: "warning", label: "Re-upload needed" },
};

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Document list. Downloads go through the authorized /api/documents route only.
 * When `review` is given (the assigned payer), each row gets a review control.
 */
export function DocumentList({ docs, review }: { docs: Doc[]; review?: (docId: string, i: DocumentReviewInput) => Promise<ActionResult<unknown>> }) {
  return (
    <DataTable
      caption="Documents"
      rows={docs}
      rowKey={(d) => d.id}
      empty={<EmptyState title="No documents yet" />}
      columns={[
        { key: "t", header: "Document", cell: (d) => <CellText sub={`${d.originalName} · ${kb(d.sizeBytes)}`}>{documentLabel(d.docType)}</CellText> },
        { key: "s", header: "Status", cell: (d) => <CellText sub={d.statusNote}><Badge tone={DOC_STATUS[d.status]?.tone ?? "neutral"}>{DOC_STATUS[d.status]?.label ?? d.status}</Badge></CellText> },
        { key: "u", header: "Uploaded", nowrap: true, cell: (d) => <CellText sub={d.uploadedByName}>{formatDateTime(d.createdAt)}</CellText> },
        {
          key: "d",
          header: "",
          cell: (d) => (d.scanStatus === "clean" ? <a href={`/api/documents/${d.id}`} download>Download</a> : <Badge tone={d.scanStatus === "infected" ? "danger" : "warning"}>{d.scanStatus === "infected" ? "Blocked" : "Scan pending"}</Badge>),
        },
        ...(review
          ? [{ key: "r", header: "Review", cell: (d: Doc) => (d.scanStatus === "clean" ? <DocumentReview action={review.bind(null, d.id)} current={d.status} /> : null) }]
          : []),
      ]}
    />
  );
}
