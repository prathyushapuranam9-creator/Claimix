"use client";

import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

/** "Delete" on an uploaded document, behind a confirmation dialog; the list refreshes when it is gone. */
export function DocumentDeleteButton({ name, remove }: { name: string; remove: () => Promise<ActionResult<unknown>> }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label={`Delete ${name}`}
      icon={
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      }
      title="Delete this document?"
      body={<p>{name} will be removed from this record. You can upload it again afterwards.</p>}
      confirmLabel="Delete document"
      tone="danger"
      action={remove}
      onDone={() => router.refresh()}
    />
  );
}
