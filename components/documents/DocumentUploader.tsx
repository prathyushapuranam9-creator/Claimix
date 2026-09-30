"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES, type DocumentCategory } from "@/modules/documents/document-types";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import styles from "./DocumentUploader.module.css";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
const MAX = 10 * 1024 * 1024;

/** Upload control. Client checks are for quick feedback only; the server re-validates and scans every file. */
export function DocumentUploader({ upload, suggested }: { upload: (fd: FormData) => Promise<ActionResult>; suggested: string[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState(suggested[0] ?? "");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = () => {
    const f = fileRef.current?.files?.[0];
    if (!docType) return setMsg({ tone: "danger", text: "Choose a document type." });
    if (!f) return setMsg({ tone: "danger", text: "Choose a file to upload." });
    if (f.size > MAX) return setMsg({ tone: "danger", text: "Files must be 10 MB or smaller." });
    const fd = new FormData();
    fd.set("docType", docType);
    fd.set("file", f);
    start(async () => {
      const r = await upload(fd);
      if (r.ok) {
        setMsg({ tone: "success", text: `${DOCUMENT_TYPES[docType]?.label ?? "Document"} uploaded.` });
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else setMsg({ tone: "danger", text: r.error });
    });
  };

  const groups = Object.entries(DOCUMENT_CATEGORIES) as [DocumentCategory, string][];
  return (
    <div className={styles.wrap}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className={styles.row}>
        <SelectField label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="">Select…</option>
          {suggested.length > 0 && (
            <optgroup label="Required for this request">
              {suggested.map((t) => <option key={`s-${t}`} value={t}>{DOCUMENT_TYPES[t]?.label ?? t}</option>)}
            </optgroup>
          )}
          {groups.map(([cat, label]) => (
            <optgroup key={cat} label={label}>
              {Object.entries(DOCUMENT_TYPES).filter(([, d]) => d.category === cat).map(([t, d]) => <option key={t} value={t}>{d.label}</option>)}
            </optgroup>
          ))}
        </SelectField>
        <div className={styles.file}>
          <label htmlFor="doc-file" className={styles.label}>File (PDF, PNG or JPG, up to 10 MB)</label>
          <input id="doc-file" ref={fileRef} type="file" accept={ACCEPT} className={styles.input} />
        </div>
        <Button type="button" onClick={onSubmit} loading={pending}>Upload</Button>
      </div>
    </div>
  );
}
