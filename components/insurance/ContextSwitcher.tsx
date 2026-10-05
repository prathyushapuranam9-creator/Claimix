"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import styles from "./Context.module.css";

export interface ContextOptionView {
  id: string;
  name: string;
  roles: { key: string; name: string }[];
}

/**
 * The two selectors of the insurance testing portal: Insurance Company (default "All Insurers") and the Role that
 * exists for that company. Applying a choice makes the whole app behave as that role of that company; it does not
 * sign in again and does not widen anything, because the server re-checks the choice and loads that role's real
 * permissions. Only rendered for accounts that hold the `insurance:context` permission.
 */
export function ContextSwitcher({
  options,
  current,
  active,
  allowAll,
  switchAction,
  exitAction,
}: {
  options: ContextOptionView[];
  /** The company and role in use now (the account's own, or the testing context). */
  current: { organizationId: string; roleKey: string } | null;
  /** A testing context is active (so it can be exited). */
  active: boolean;
  /** Offer "All Insurers" (administrators only; an insurer login always has a company). */
  allowAll: boolean;
  switchAction: (i: { organizationId: string; roleKey: string }) => Promise<ActionResult>;
  exitAction: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(current?.organizationId ?? "");
  const [roleKey, setRoleKey] = useState(current?.roleKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const roles = options.find((o) => o.id === orgId)?.roles ?? [];

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error);
    });

  const apply = () => {
    if (!orgId) {
      if (active) run(exitAction);
      return;
    }
    if (!roleKey) return setError("Select a role for this insurance company.");
    run(() => switchAction({ organizationId: orgId, roleKey }));
  };

  return (
    <section id="context" className={styles.switcher} aria-label="Testing context">
      <div className={styles.intro}>
        <h2 className={styles.title}>Insurance portal testing</h2>
        <p>Pick an insurance company and a role to see the portal exactly as that role does. Switching needs no new sign-in.</p>
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <SelectField
          label="Insurance Company"
          value={orgId}
          onChange={(e) => {
            setOrgId(e.target.value);
            setRoleKey("");
            setError(null);
          }}
        >
          {allowAll && <option value="">All Insurers</option>}
          {!allowAll && !orgId && <option value="">Select company</option>}
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </SelectField>
        <SelectField label="Role" value={roleKey} disabled={!orgId} onChange={(e) => { setRoleKey(e.target.value); setError(null); }}>
          <option value="">Select Role</option>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </SelectField>
        <div className={styles.actions}>
          <Button type="submit" loading={pending}>Switch Context</Button>
          {active && (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => { setOrgId(""); setRoleKey(""); run(exitAction); }}>
              {allowAll ? "Exit testing context" : "Back to my own company"}
            </Button>
          )}
        </div>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  );
}

/** Small "Exit" control for the banner shown on every page while a testing context is active. */
export function ExitContextButton({ exitAction }: { exitAction: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() => start(async () => { await exitAction(); router.push("/dashboard"); router.refresh(); })}
    >
      Exit
    </Button>
  );
}
