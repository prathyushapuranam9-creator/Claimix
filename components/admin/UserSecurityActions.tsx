"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Alert } from "@/components/ui/Surface";
import { formStyles } from "@/components/ui/Form";

export function UserSecurityActions({
  revoke,
  resend,
  name,
}: {
  revoke: () => Promise<ActionResult<unknown>>;
  resend?: () => Promise<ActionResult<unknown>>;
  name: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className={formStyles.form}>
      {msg && <Alert tone="success">{msg}</Alert>}
      <div className={formStyles.actionsInline}>
        <ConfirmButton
          label="Sign out everywhere"
          title={`Sign ${name} out of all devices?`}
          body="Every active session for this user ends immediately. They can sign in again with their password."
          confirmLabel="Sign out everywhere"
          tone="danger"
          action={revoke}
          onDone={() => setMsg("All sessions ended.")}
        />
        {resend && (
          <ConfirmButton
            label="Send password setup link"
            title="Send a new password setup link?"
            body="Any previous link stops working. The new link expires in 72 hours."
            confirmLabel="Send link"
            action={resend}
            onDone={() => setMsg("A new link has been emailed.")}
          />
        )}
      </div>
    </div>
  );
}
