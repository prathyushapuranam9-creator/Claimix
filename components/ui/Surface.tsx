import type { ReactNode } from "react";
import styles from "./Surface.module.css";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export function Card({ title, actions, children, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean }) {
  return (
    <section className={styles.card}>
      {(title || actions) && (
        <header className={styles.cardHeader}>
          {title && <h2 className={styles.cardTitle}>{title}</h2>}
          {actions}
        </header>
      )}
      {padded ? <div className={styles.cardBody}>{children}</div> : children}
    </section>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={tone === "danger" ? "alert" : "status"}>
      {title && <p className={styles.alertTitle}>{title}</p>}
      {children && <div>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action, icon = "○" }: { title: string; children?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className={styles.state}>
      <span className={styles.stateIcon} aria-hidden="true">{icon}</span>
      <p className={styles.stateTitle}>{title}</p>
      {/* A div, not a p: the content may itself hold blocks (an Alert, paragraphs). */}
      {children && <div className={styles.stateBody}>{children}</div>}
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <span className={styles.loader} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function PageHeader({ title, description, actions, leading }: { title: string; description?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  const text = (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  );
  return (
    <div className={styles.pageHeader}>
      {leading ? (
        // Optional mark before the title (e.g. an organization's initials).
        <div className={styles.pageLead}>
          {leading}
          {text}
        </div>
      ) : (
        text
      )}
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className={styles.card}>
      <div className={styles.stat}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statValue}>{value}</span>
        {hint}
      </div>
    </div>
  );
}

/** Vertical rhythm between page sections. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
