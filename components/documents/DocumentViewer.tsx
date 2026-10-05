"use client";

import { useEffect, useId, useRef, useState } from "react";
import { previewOf } from "@/modules/documents/document-preview";
import styles from "./DocumentViewer.module.css";

type Loaded =
  | { kind: "loading" }
  | { kind: "pdf" | "image"; url: string }
  | { kind: "error"; message: string; canDownload: boolean };

/**
 * Eye icon for one document row. Opens that document in a modal popup.
 * The file comes from the same authorized, scoped and audited /api/documents/[id] route as
 * Download — nothing is made public — and is shown from an in-memory copy that is released
 * when the popup closes. Each row has its own button and popup, so rows never share state.
 * Viewable: PDF, PNG (screenshots) and JPG/JPEG — the same types uploads accept.
 */
export function DocumentViewButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.eye} aria-label={`View ${name}`} title="View document" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {open && <DocumentViewerDialog id={id} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function DocumentViewerDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  // Images: fit inside the popup (default) or show at actual size with scrolling.
  const [actualSize, setActualSize] = useState(false);
  const href = `/api/documents/${encodeURIComponent(id)}`;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let url: string | null = null;
    fetch(href, { signal: ctrl.signal, credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: "error", canDownload: false, message: res.status === 403 ? "This document can't be viewed until its security scan has passed." : "This document couldn't be loaded." });
          return;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const p = previewOf(bytes);
        if (p.kind === "unsupported") {
          setState({ kind: "error", canDownload: true, message: "This file type can't be previewed. PDF, JPG, JPEG and PNG files can be viewed here." });
          return;
        }
        if (p.kind === "empty_pdf") {
          setState({ kind: "error", canDownload: true, message: "This PDF has no pages to display. The file may be incomplete — download it to check, or ask for it to be uploaded again." });
          return;
        }
        url = URL.createObjectURL(new Blob([bytes], { type: p.mime }));
        setState({ kind: p.kind, url });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== "AbortError") setState({ kind: "error", canDownload: false, message: "This document couldn't be loaded." });
      });
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [href]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Clicking the dimmed area outside the popup closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.frame}>
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>{name}</h2>
          <div className={styles.tools}>
            {state.kind === "image" && (
              <button type="button" className={styles.tool} aria-pressed={actualSize} onClick={() => setActualSize((v) => !v)}>
                {actualSize ? "Fit to window" : "Actual size"}
              </button>
            )}
            <button type="button" className={styles.close} aria-label="Close" title="Close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>
        <div className={`${styles.body} ${state.kind === "pdf" ? styles.bodyPdf : ""}`} data-testid="document-viewer-body" data-kind={state.kind}>
          {state.kind === "loading" && <p className={styles.message} role="status">Loading document…</p>}
          {state.kind === "error" && (
            <div className={styles.message} role="alert">
              <p>{state.message}</p>
              {state.canDownload && <a href={href} download>Download</a>}
            </div>
          )}
          {state.kind === "pdf" && <iframe className={styles.pdf} src={state.url} title={name} />}
          {state.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- a private in-memory file, not an optimisable asset
            <img className={actualSize ? styles.imageActual : styles.image} src={state.url} alt={name} />
          )}
        </div>
      </div>
    </dialog>
  );
}
