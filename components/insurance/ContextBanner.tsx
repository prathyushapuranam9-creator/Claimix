import Link from "next/link";
import { exitContextAction } from "@/app/(app)/context/actions";
import { ExitContextButton } from "./ContextSwitcher";
import styles from "./Context.module.css";

/** Shown on every page while an account is testing the insurance portal as an insurer and role. */
export function ContextBanner({ organizationName, roleName }: { organizationName: string; roleName: string }) {
  return (
    <div className={styles.banner} role="status" aria-label="Current testing context">
      <span className={styles.tag}>Testing context</span>
      <span>Insurance: <strong>{organizationName}</strong></span>
      <span>Role: <strong>{roleName}</strong></span>
      <span className={styles.bannerActions}>
        <Link href="/dashboard#context">Switch Context</Link>
        <ExitContextButton exitAction={exitContextAction} />
      </span>
    </div>
  );
}
