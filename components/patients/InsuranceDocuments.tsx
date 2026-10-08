import type { ActionResult } from "@/lib/action-result";
import type { InsuranceExtraction } from "@/modules/documents/insurance-extraction.service";
import { INSURANCE_DOCUMENT_TYPES } from "@/modules/documents/document-types";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { ButtonLink } from "@/components/ui/Button";
import { Details } from "@/components/ui/Form";
import { Alert, Card, EmptyState } from "@/components/ui/Surface";
import styles from "@/components/workflow/Workspace.module.css";

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

/**
 * Stage A of the patient's insurance workflow: the card, policy copy or scheme enrolment document.
 * It is optional — the empty state says so — and uploading one only offers to fill the coverage form.
 */
export function InsuranceDocumentsCard({
  patientId,
  docs,
  upload,
  canUpload,
  remove,
}: {
  patientId: string;
  docs: Doc[];
  upload?: (fd: FormData) => Promise<ActionResult>;
  canUpload: boolean;
  remove?: (docId: string) => Promise<ActionResult<unknown>>;
}) {
  return (
    <Card title="Insurance documents" padded={false}>
      {canUpload && upload && (
        <div className={styles.pad}>
          <p className={styles.hint}>
            Insurance card, policy copy or scheme enrolment document. Optional: coverage can also be added manually and the document uploaded later.
          </p>
          <DocumentUploader upload={upload} suggested={[...INSURANCE_DOCUMENT_TYPES]} only={INSURANCE_DOCUMENT_TYPES} button="Upload insurance document" />
        </div>
      )}
      <DocumentList
        docs={docs}
        caption="Insurance documents"
        remove={canUpload ? remove : undefined}
        empty={<EmptyState title="No insurance document uploaded">{canUpload ? "Upload the insurance card or policy document to fill the coverage details from it." : undefined}</EmptyState>}
        actions={
          canUpload
            ? (d) =>
                d.scanStatus === "clean" ? (
                  <ButtonLink size="sm" variant="secondary" href={`/patients/${patientId}?fromDocument=${d.id}#add-coverage`}>
                    Review extracted details
                  </ButtonLink>
                ) : null
            : undefined
        }
      />
    </Card>
  );
}

/**
 * What was read from an insurance document, above the pre-filled coverage form. It states plainly
 * that the values must be checked, and lists the fields the document did not give so staff know
 * exactly what is still to be typed — nothing is filled in on their behalf.
 */
export function ExtractedDetailsNotice({ extraction }: { extraction: InsuranceExtraction }) {
  if (extraction.noReadableText) {
    return (
      <Alert tone="warning" title="No details could be read from this document">
        <p>
          {extraction.documentLabel} (<span className="mono">{extraction.originalName}</span>) holds no readable text — photographs and scanned
          images can&apos;t be read automatically. Enter the coverage details from the document below.
        </p>
      </Alert>
    );
  }
  if (!extraction.read.length) {
    return (
      <Alert tone="warning" title="No insurance details could be identified">
        <p>
          Nothing in {extraction.documentLabel} (<span className="mono">{extraction.originalName}</span>) matched the expected labels, so no value has
          been filled in. Enter the coverage details from the document below.
        </p>
      </Alert>
    );
  }
  return (
    <Alert tone="info" title="Details extracted from the uploaded document. Please verify before saving.">
      <p>
        Read from {extraction.documentLabel} (<span className="mono">{extraction.originalName}</span>). Every value below is editable, and only what
        you save is recorded.
      </p>
      <Details columns={3} items={extraction.read.map((r) => [r.label, r.value] as [string, string])} />
      {extraction.namesOnDocument.length > 0 && (
        <p>
          Printed on the document — {extraction.namesOnDocument.map((n) => `${n.label}: ${n.value}`).join(" · ")}. Check this against the patient&apos;s
          registered name; a mismatch is a common reason for payer queries.
        </p>
      )}
      {extraction.missing.length > 0 && <p>Not stated in the document, please enter: {extraction.missing.join(", ")}.</p>}
      {!extraction.matchedPolicy && <p>The policy could not be identified from the document — select it yourself; it decides which payer receives the request.</p>}
    </Alert>
  );
}
