import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import styles from "./auth.module.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.aside}>
        <div>
          <h2>Fewer queries. Faster, cleaner claims.</h2>
          <ul>
            <li>Check eligibility against the policy&apos;s own rules</li>
            <li>Submit pre-authorizations only when they&apos;re complete</li>
            <li>Track every query, decision and settlement in one place</li>
          </ul>
        </div>
        <p className={styles.fine}>
          Coverage, authorization and settlement are subject to the applicable policy wording, insurer/TPA decision and
          government-scheme rules. Claimix assists the workflow; it does not guarantee approval or payment.
        </p>
      </aside>
      <main className={styles.main} id="main">
        <div className={styles.panel}>
          <Link href="/" className={styles.brand}>
            <LogoMark /> Claimix
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
