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
  /** Listed for reference but not available to this account (shown greyed out). */
  selectable?: boolean;
}

/**
 * The two selectors of the insurance testing portal: Insurance Company (default "All Insurers") and the Role that
 * exists for that company. Applying a choice makes the whole app behave as that role of that company; it does not
 * sign in again and does not widen anything, because the server re-checks the choice and loads that role's real
 * permissions. Rendered for administrators and flagged testing logins (every insurer), and for insurer / TPA
 * reviewers (their own company only — the server supplies just that option and refuses anything else).
 */
export function ContextSwitcher({
  options,
  current,
  active,
  allowAll,
  policies = {},
  currentPolicyId = null,
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
  /** Each selectable company's own policies (Insurance Company → Policy), loaded and authorized on the server. */
  policies?: Record<string, { id: string; name: string }[]>;
  /** The policy the portal is currently narrowed to (from the server-side context), if any. */
  currentPolicyId?: string | null;
  switchAction: (i: { organizationId: string; roleKey: string; policyId?: string | null }) => Promise<ActionResult>;
  exitAction: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(current?.organizationId ?? "");
  const [policyId, setPolicyId] = useState(currentPolicyId ?? "");
  const companyPolicies = policies[orgId] ?? [];
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
    run(() => switchAction({ organizationId: orgId, roleKey, policyId: policyId || null }));
  };

  /** The role to use when the company or policy changes: the one chosen if that company has it, else its first. */
  const roleFor = (company: string) => {
    const available = options.find((o) => o.id === company)?.roles ?? [];
    return available.some((r) => r.key === roleKey) ? roleKey : (available[0]?.key ?? "");
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
            const company = e.target.value;
            const role = company ? roleFor(company) : "";
            setOrgId(company);
            setRoleKey(role);
            setPolicyId("");
            setError(null);
            // Applies at once, so the whole portal shows that company (no policy filter yet).
            if (!company) {
              if (active) run(exitAction);
            } else if (role) {
              run(() => switchAction({ organizationId: company, roleKey: role, policyId: null }));
            }
          }}
        >
          {allowAll && <option value="">All Insurers</option>}
          {!allowAll && !orgId && <option value="">Select company</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.selectable === false}>
              {o.selectable === false ? `${o.name} — not available for your account` : o.name}
            </option>
          ))}
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
      <div className={styles.policyRow}>
        <SelectField
          label="Policy"
          value={policyId}
          disabled={!orgId || companyPolicies.length === 0 || pending}
          hint={!orgId ? "Choose an insurance company to see its policies." : companyPolicies.length === 0 ? "No policies are recorded for this company." : "Shows only this policy's patients, pre-authorizations, claims and documents across the portal."}
          onChange={(e) => {
            const policy = e.target.value;
            const role = roleFor(orgId);
            setPolicyId(policy);
            setRoleKey(role);
            setError(null);
            // Applies at once: every list, count and report in the portal narrows to this policy (or back to the whole company).
            if (role) run(() => switchAction({ organizationId: orgId, roleKey: role, policyId: policy || null }));
          }}
        >
          <option value="">All policies of this company</option>
          {companyPolicies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  );
}

/**
 * "Exit" control of the testing context (dashboard switcher and the navbar context pill). With `className` it renders
 * as a plain text button styled by the caller (the pill); the action is the same either way.
 */
export function ExitContextButton({ exitAction, className }: { exitAction: () => Promise<ActionResult>; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const exit = () => start(async () => { await exitAction(); router.push("/dashboard"); router.refresh(); });
  if (className) {
    return (
      <button type="button" className={className} onClick={exit} disabled={pending} aria-busy={pending || undefined}>
        Exit
      </button>
    );
  }
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={exit}>
      Exit
    </Button>
  );
}
