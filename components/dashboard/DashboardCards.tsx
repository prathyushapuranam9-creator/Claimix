import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./DashboardCards.module.css";

type Tone = "blue" | "navy" | "warning" | "success" | "muted";

/** Status pill for the page header: dot + label | timestamp. */
export function PipelinePill({ label, when }: { label: string; when: string }) {
  return (
    <span className={styles.pill}>
      <span className={styles.pillDot} aria-hidden="true" />
      <span>{label}</span>
      <span className={styles.pillSep} aria-hidden="true" />
      <span className={styles.pillWhen}>{when}</span>
    </span>
  );
}

/** Section heading: coloured dot, uppercase title, optional chip, and a right-aligned caption. */
export function SectionHeader({ id, title, chip, chipTone = "blue", caption, dot = "blue" }: { id: string; title: string; chip?: ReactNode; chipTone?: Tone; caption?: string; dot?: Tone }) {
  return (
    <div className={styles.sectionHeader}>
      <h2 id={id} className={styles.sectionTitle}>
        <span className={styles.dot} data-tone={dot} aria-hidden="true" />
        {title}
        {chip !== undefined && <span className={styles.chip} data-tone={chipTone}>{chip}</span>}
      </h2>
      {caption && <span className={styles.caption}>{caption}</span>}
    </div>
  );
}

export function CardGrid({ children, columns, labelledBy }: { children: ReactNode; columns: 4 | 5; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className={styles.grid} data-columns={columns}>
      {children}
    </section>
  );
}

/** Actionable count: uppercase label + status dot, large value, divider, caption + action or state. */
export function WorkflowCard({
  label,
  value,
  caption,
  accent,
  dot,
  action,
}: {
  label: string;
  value: ReactNode;
  caption: string;
  accent?: Tone;
  dot: Tone;
  /** A link ("View →") when there is work, otherwise a short state word. */
  action: { href: string; text: string } | { state: string };
}) {
  return (
    <div className={styles.card} data-accent={accent}>
      <div className={styles.cardTop}>
        <span className={styles.label}>{label}</span>
        <span className={styles.dot} data-tone={dot} aria-hidden="true" />
      </div>
      <span className={styles.value}>{value}</span>
      <div className={styles.cardFoot}>
        <span className={styles.caption}>{caption}</span>
        {"href" in action ? (
          <Link href={action.href} className={styles.view} aria-label={`${action.text}: ${label.toLowerCase()}`}>
            {action.text}
            <Arrow />
          </Link>
        ) : (
          <span className={styles.state}>{action.state}</span>
        )}
      </div>
    </div>
  );
}

/** Performance / money metric: uppercase label, large value, muted caption underneath. */
export function KpiCard({ label, value, caption }: { label: string; value: ReactNode; caption?: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {caption && <span className={styles.kpiCaption}>{caption}</span>}
    </div>
  );
}

export function ListPair({ children }: { children: ReactNode }) {
  return <div className={styles.pair}>{children}</div>;
}

export interface CaseRowData {
  id: string;
  href: string;
  reference: string;
  status: ReactNode;
  time: string;
}

/** A list in its own card: dot + title + count, "All ›" action, then a compact table. */
export function ListCard({
  title,
  count,
  dot,
  href,
  rows,
  empty,
}: {
  title: string;
  count: number;
  dot: Tone;
  href: string;
  rows: CaseRowData[];
  empty: ReactNode;
}) {
  return (
    <section className={styles.listCard} aria-label={title}>
      <header className={styles.listHeader}>
        <h2 className={styles.listTitle}>
          <span className={styles.dot} data-tone={dot} aria-hidden="true" />
          {title}
          <span className={styles.count} aria-label={`${count} in total`}>{count}</span>
        </h2>
        <Link href={href} className={styles.all}>
          All
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </header>
      {rows.length === 0 ? (
        <div className={styles.listEmpty}>{empty}</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Reference ID</th>
                <th scope="col" className={styles.center}>Status</th>
                <th scope="col" className={styles.right}>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={r.href} className={styles.ref}>{r.reference}</Link></td>
                  <td className={styles.center}>{r.status}</td>
                  <td className={styles.right}><span className={styles.time}>{r.time}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
