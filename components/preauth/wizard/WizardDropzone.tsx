"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type DragEvent } from "react";
import type { ActionResult } from "@/lib/action-result";
import { DOCUMENT_TYPES } from "@/modules/documents/document-types";
import { DocumentViewButton } from "@/components/documents/DocumentViewer";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Surface";
import styles from "./NewClaimWizard.module.css";

export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
const MAX = 10 * 1024 * 1024;
const OK_EXT = /\.(pdf|png|jpe?g|webp)$/i;

export interface WizardFile {
  id: string;
  docType: string;
  originalName: string;
  scanStatus: string;
  status: string;
}

/** Browser-side checks for quick feedback only; the server re-validates type, size and content and scans every file. */
export function checkFiles(list: File[]): string | null {
  const bad = list.find((f) => !OK_EXT.test(f.name) || f.size > MAX);
  return bad ? `${bad.name}: use a JPG, PNG, WEBP or PDF file of 10 MB or less.` : null;
}

/**
 * Drag-and-drop (or click / keyboard) upload of one or more files as one document type.
 * - With `upload`, each file goes through the normal upload action one at a time.
 * - Without it (before the case exists), the files are held in the browser (`held` / `onHold`) and uploaded with the case.
 * `onPicked` receives the chosen files in both modes (e.g. to read a policy card).
 */
export function WizardDropzone({
  title,
  hint,
  docType,
  files = [],
  upload,
  remove,
  held,
  onHold,
  onPicked,
  multiple = true,
  disabled,
}: {
  title: string;
  hint?: string;
  docType: string;
  files?: WizardFile[];
  upload?: (fd: FormData) => Promise<ActionResult>;
  remove?: (documentId: string) => Promise<ActionResult>;
  held?: File[];
  onHold?: (files: File[]) => void;
  onPicked?: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const send = (picked: File[]) => {
    const list = multiple ? picked : picked.slice(0, 1);
    if (disabled || !list.length) return;
    const bad = checkFiles(list);
    if (bad) return setMsg({ tone: "danger", text: bad });
    onPicked?.(list);
    if (!upload) {
      onHold?.(multiple ? [...(held ?? []), ...list] : list);
      setMsg(null);
      if (input.current) input.current.value = "";
      return;
    }
    start(async () => {
      const failed: string[] = [];
      for (const f of list) {
        const fd = new FormData();
        fd.set("docType", docType);
        fd.set("file", f);
        const r = await upload(fd);
        if (!r.ok) failed.push(`${f.name}: ${r.error}`);
      }
      if (input.current) input.current.value = "";
      setMsg(failed.length ? { tone: "danger", text: failed.join(" ") } : { tone: "success", text: `${DOCUMENT_TYPES[docType]?.label ?? "Document"} uploaded.` });
      router.refresh();
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    send([...e.dataTransfer.files]);
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        className={styles.dropzone}
        data-over={over || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        aria-busy={pending || undefined}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <span className={styles.dropTitle}>{title}</span>
        <span>{pending ? "Uploading…" : `Drag ${multiple ? "files" : "a file"} here or click to choose · JPG, PNG, WEBP or PDF, up to 10 MB`}</span>
        {hint && <span className={styles.muted}>{hint}</span>}
        <input
          id={inputId}
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          disabled={disabled || pending}
          aria-label={title}
          onChange={(e) => send([...(e.target.files ?? [])])}
        />
      </label>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {(files.length > 0 || (held?.length ?? 0) > 0) && (
        <ul className={styles.files} aria-label={`${title}: files`}>
          {files.map((f) => (
            <li key={f.id} className={styles.file}>
              <span>{f.originalName}{f.scanStatus !== "clean" && <span className={styles.muted}> · security scan pending</span>}</span>
              <span className={styles.fileActions}>
                {f.scanStatus === "clean" && <DocumentViewButton id={f.id} name={f.originalName} />}
                {remove && !disabled && f.status !== "verified" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${f.originalName}`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await remove(f.id);
                        setMsg(r.ok ? { tone: "success", text: `${f.originalName} removed.` } : { tone: "danger", text: r.error });
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
          {held?.map((f, i) => (
            <li key={`held-${i}-${f.name}`} className={styles.file}>
              <span>{f.name} <span className={styles.muted}>· uploads when the case is created</span></span>
              <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => onHold?.(held.filter((_, j) => j !== i))}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
