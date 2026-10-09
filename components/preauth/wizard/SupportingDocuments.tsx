"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { DOCUMENT_TYPES } from "@/modules/documents/document-types";
import { DOC_CATEGORIES, docCategory, TIER_LABEL, type WizardDocument } from "@/modules/preauth/preauth.scrutiny";
import { DocumentViewButton } from "@/components/documents/DocumentViewer";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Alert, Card, Stack } from "@/components/ui/Surface";
import { ACCEPT, checkFiles, WizardDropzone, type WizardFile } from "./WizardDropzone";
import styles from "./NewClaimWizard.module.css";

const CENTRAL_TYPES: [string, string][] = [
  ["doctor_consultation", "Doctor's note"],
  ["preauth_form", "Signed pre-auth form"],
  ["investigation_reports", "Investigation reports"],
  ["medical_history", "Previous consultation papers"],
  ["treatment_estimate", "Treatment cost estimate"],
  ["other", "The whole case as one PDF / other"],
];

/**
 * Supporting Documents as a categorized accordion (all groups closed until a heading is clicked; each opens on its own) (Identity & Policy, Medical & Pre-Auth, Financials & Estimates) with
 * an overall progress bar. Rows, tiers, uploads, view and remove are the existing document workflow; only the layout
 * is grouped. A left accent marks a missing required document (red) or an uploaded one (green).
 */
export function SupportingDocuments({
  caseId,
  requirements,
  files,
  policyHasDocumentRules,
  ro,
  upload,
  remove,
}: {
  caseId: string;
  requirements: WizardDocument[];
  files: WizardFile[];
  policyHasDocumentRules: boolean;
  ro: boolean;
  upload: (id: string, fd: FormData) => Promise<ActionResult>;
  remove: (documentId: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [central, setCentral] = useState("doctor_consultation");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const baseId = useId();
  const filesOf = (types: string[]) => files.filter((f) => types.includes(f.docType));

  const done = requirements.filter((r) => r.uploaded > 0).length;
  const total = requirements.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const uploadAs = (docType: string, list: File[]) => {
    const bad = checkFiles(list);
    if (bad) return setMsg({ tone: "danger", text: bad });
    start(async () => {
      const failed: string[] = [];
      for (const f of list) {
        const fd = new FormData();
        fd.set("docType", docType);
        fd.set("file", f);
        const r = await upload(caseId, fd);
        if (!r.ok) failed.push(`${f.name}: ${r.error}`);
      }
      setMsg(failed.length ? { tone: "danger", text: failed.join(" ") } : { tone: "success", text: `${DOCUMENT_TYPES[docType]?.label ?? "Document"} uploaded.` });
      router.refresh();
    });
  };

  return (
    <Stack>
      <Card title="Supporting documents">
        <div className={styles.progress}>
          <div className={styles.progressHead}>
            <strong data-testid="docs-progress">{done} of {total} Documents Uploaded ({pct}%)</strong>
            <span className={styles.muted}>
              {policyHasDocumentRules ? "Standard cashless papers, raised where this policy's rules ask for more." : "Standard cashless papers (no published document rules)."}
            </span>
          </div>
          <div className={styles.progressBar} role="progressbar" aria-label="Documents uploaded" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        <div className={styles.docGroups} aria-label="Document checklist" role="list">
          {DOC_CATEGORIES.map((cat) => {
            const rows = requirements.filter((r) => docCategory(r.type) === cat.key);
            if (rows.length === 0) return null;
            const up = rows.filter((r) => r.uploaded > 0).length;
            const missingRequired = rows.some((r) => r.tier === "must" && r.uploaded === 0);
            return (
              <details key={cat.key} className={styles.docGroup} role="listitem" data-category={cat.key}>
                <summary>
                  <span className={styles.docGroupTitle}>{cat.label}</span>
                  <span className={styles.docGroupCount} data-missing={missingRequired || undefined}>{up} of {rows.length} uploaded</span>
                </summary>
                <ul className={styles.reqList}>
                  {rows.map((r) => {
                    const mine = filesOf(r.accepts);
                    const i = requirements.indexOf(r);
                    const inputId = `${baseId}-${i}`;
                    const state = r.uploaded > 0 ? "uploaded" : r.tier === "must" ? "missing" : "pending";
                    return (
                      <li key={r.type} className={styles.docRow} data-state={state} data-doc={r.type}>
                        <span className={styles.tier} data-tier={r.tier}>{TIER_LABEL[r.tier]}</span>
                        <div>
                          <div className={styles.reqName}>{r.label}</div>
                          <div className={styles.muted}>{r.uploaded > 0 ? `Uploaded (${mine.length})` : "Not uploaded"}{r.source === "policy_rules" && " · policy rule"}</div>
                          {mine.length > 0 && (
                            <ul className={styles.files}>
                              {mine.map((f) => (
                                <li key={f.id} className={styles.file}>
                                  <span>{f.originalName}</span>
                                  <span className={styles.fileActions}>
                                    {f.scanStatus === "clean" && <DocumentViewButton id={f.id} name={f.originalName} />}
                                    {!ro && f.status !== "verified" && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        aria-label={`Remove ${f.originalName}`}
                                        disabled={pending}
                                        onClick={() =>
                                          start(async () => {
                                            const x = await remove(f.id);
                                            setMsg(x.ok ? { tone: "success", text: `${f.originalName} removed.` } : { tone: "danger", text: x.error });
                                            router.refresh();
                                          })
                                        }
                                      >
                                        Remove
                                      </Button>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className={styles.rowActions}>
                          {!ro && (
                            <label htmlFor={inputId} className={styles.uploadButton} aria-disabled={pending || undefined}>
                              Upload
                              <input
                                id={inputId}
                                type="file"
                                accept={ACCEPT}
                                multiple
                                disabled={pending}
                                aria-label={`Upload: ${r.label}`}
                                onChange={(e) => {
                                  uploadAs(r.type, [...(e.target.files ?? [])]);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </Card>
      {!ro && (
        <Card title="Doctor's Note / Signed Form">
          <div className={styles.centralRow}>
            <SelectField label="File as" value={central} onChange={(e) => setCentral(e.target.value)}>
              {CENTRAL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
          </div>
          <WizardDropzone title="Doctor's Note / Signed Form" hint="Reports too — or the whole case as one PDF" docType={central} upload={(fd) => upload(caseId, fd)} />
        </Card>
      )}
    </Stack>
  );
}
