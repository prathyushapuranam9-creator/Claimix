import type { ReactNode } from "react";
import { exitContextAction } from "@/app/(app)/context/actions";
import { BannerSwitch } from "./BannerSwitch";
import { ExitContextButton } from "./ContextSwitcher";
import styles from "./Context.module.css";

/** Shown on every page while an account is testing the insurance portal as an insurer and role. */
export function ContextBanner({ organizationName, roleName, switcher }: { organizationName: string; roleName: string; switcher?: ReactNode }) {
  return (
    <div className={styles.banner} role="status" aria-label="Current testing context">
      <span className={styles.tag}>Testing context</span>
      <span>Insurance: <strong>{organizationName}</strong></span>
      <span>Role: <strong>{roleName}</strong></span>
      <span className={styles.bannerActions}>
        <BannerSwitch>{switcher}</BannerSwitch>
        <ExitContextButton exitAction={exitContextAction} />
      </span>
    </div>
  );
}
