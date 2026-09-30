"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

/** Never renders error details: the server logs them; the user gets a reference only. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPage
      code="ERROR"
      title="Something went wrong"
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/dashboard" variant="secondary">Go to dashboard</ButtonLink>
        </>
      }
    >
      We couldn&apos;t complete that request. Please try again.
      {error.digest && <p className="mono">Reference: {error.digest}</p>}
    </StatusPage>
  );
}
