import type { ReactNode } from "react";
import { exitContextAction } from "@/app/(app)/context/actions";
import { BannerSwitch } from "./BannerSwitch";
import { ExitContextButton } from "./ContextSwitcher";
import styles from "./Context.module.css";

/**
 * Compact testing-context pill in the top navbar, on every page while an account is testing the insurance portal:
 * "🧪 TESTING CONTEXT: [Insurance Company] • [Role] | Switch Context | Exit". The values come from the authenticated
 * session's context; Switch Context and Exit use the existing switcher and exit action.
 */
export function ContextBanner({ organizationName, roleName, policyName, switcher }: { organizationName: string; roleName: string; policyName?: string; switcher?: ReactNode }) {
  const context = [organizationName, roleName, ...(policyName ? [policyName] : [])].join(" • ");
  return (
    <div className={styles.chip} role="status" aria-label="Current testing context">
      <span className={styles.chipLabel}>
        <span aria-hidden="true">🧪 </span>
        <span className={styles.chipLabelText}>Testing context:</span>
      </span>
      {/* Narrowed to one policy: everything in the portal shows only that policy's patients and cases. */}
      <span className={styles.chipText} title={context}>
        {organizationName} • {roleName}
        {policyName && <> • {policyName}</>}
      </span>
      <span className={styles.chipSep} aria-hidden="true">|</span>
      <BannerSwitch>{switcher}</BannerSwitch>
      <span className={styles.chipSep} aria-hidden="true">|</span>
      <ExitContextButton exitAction={exitContextAction} className={styles.chipAction} />
    </div>
  );
}
