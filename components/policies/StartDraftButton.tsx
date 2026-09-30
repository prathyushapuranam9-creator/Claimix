"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/Button";

export function StartDraftButton({ action, hasActive }: { action: () => Promise<ActionResult>; hasActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await action();
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        {hasActive ? "Start new draft" : "Create first draft"}
      </Button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
