"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import { formStyles } from "@/components/ui/Form";

/** One-field message form (query responses, cancellation reasons). */
export function SimpleMessageForm({
  action,
  label,
  button,
  tone = "primary",
  hint,
}: {
  action: (i: { message: string }) => Promise<ActionResult>;
  label: string;
  button: string;
  tone?: "primary" | "danger";
  hint?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={formStyles.form}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await action({ message });
          if (r.ok) { setMessage(""); setError(null); router.refresh(); } else setError(r.fieldErrors?.message?.[0] ?? r.error);
        });
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <TextAreaField label={label} hint={hint} value={message} onChange={(e) => setMessage(e.target.value)} required />
      <div>
        <Button type="submit" variant={tone} loading={pending}>{button}</Button>
      </div>
    </form>
  );
}
