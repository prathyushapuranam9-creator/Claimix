import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import styles from "./StatusPage.module.css";

/** Full-page message used for 403 / 404 / error screens. */
export function StatusPage({ code, title, children, actions }: { code: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <main id="main" className={styles.wrap}>
      <div className={styles.box}>
        <LogoMark size={36} />
        <p className={styles.code}>{code}</p>
        <h1>{title}</h1>
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </main>
  );
}
