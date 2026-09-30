"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Alert, EmptyState } from "@/components/ui/Surface";

/** Errors inside the app keep the shell and navigation. Details stay in server logs; users see a reference only. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState title="Something went wrong" icon="!" action={<><Button onClick={reset}>Try again</Button> <ButtonLink href="/dashboard" variant="secondary">Go to dashboard</ButtonLink></>}>
      <Alert tone="danger">We couldn&apos;t complete that request. Please try again.</Alert>
      {error.digest && <p className="mono">Reference: {error.digest}</p>}
    </EmptyState>
  );
}
