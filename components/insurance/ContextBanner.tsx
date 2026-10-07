import type { ReactNode } from "react";
import { exitContextAction } from "@/app/(app)/context/actions";
import { BannerSwitch } from "./BannerSwitch";
import { ExitContextButton } from "./ContextSwitcher";
import styles from "./Context.module.css";

/** Shown on every page while an account is testing the insurance portal as an insurer and role. */
export function ContextBanner({ organizationName, roleName, policyName, switcher }: { organizationName: string; roleName: string; policyName?: string; switcher?: ReactNode }) {
  return (
    <div className={styles.banner} role="status" aria-label="Current testing context">
      <span className={styles.tag}>Testing context</span>
      <span>Insurance: <strong>{organizationName}</strong></span>
      <span>Role: <strong>{roleName}</strong></span>
      {/* Narrowed to one policy: everything in the portal shows only that policy's patients and cases. */}
      {policyName && <span>Policy: <strong>{policyName}</strong></span>}
      <span className={styles.bannerActions}>
        <BannerSwitch>{switcher}</BannerSwitch>
        <ExitContextButton exitAction={exitContextAction} />
      </span>
    </div>
  );
}
