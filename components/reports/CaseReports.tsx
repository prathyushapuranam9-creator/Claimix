import Link from "next/link";
import { formatINR } from "@/lib/india";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import type { CaseSort, SortDir } from "@/modules/reports/cases.repository";
import type { CasesReport, TatDistribution } from "@/modules/reports/cases-report.service";
import { Pagination } from "@/components/ui/DataTable";
import { Badge, EmptyState } from "@/components/ui/Surface";
import styles from "./CaseReports.module.css";

/* TAT colours (bucket order): green, green, yellow, orange, deep orange, red. */
const TAT_COLORS = ["#10B981", "#10B981", "#F59E0B", "#F97316", "#EA580C", "#EF4444"] as const;

function tatTone(days: number) {
  return days <= 15 ? 0 : days <= 30 ? 1 : days <= 45 ? 2 : days <= 60 ? 3 : days <= 90 ? 4 : 5;
}

const NOT_RECORDED = "Not recorded in Claimix";

/* ---------------- Cases table ---------------- */

type Col = { key: string; label: string; sort?: CaseSort; align?: "right" | "center" };

const COLUMNS: Col[] = [
  { key: "case", label: "Case no", sort: "case" },
  { key: "patient", label: "Patient", sort: "patient" },
  { key: "insurer", label: "Insurer", sort: "insurer" },
  { key: "dept", label: "Dept" },
  { key: "billed", label: "Billed", sort: "billed", align: "right" },
  { key: "approved", label: "Approved", sort: "approved", align: "right" },
  { key: "received", label: "Received", sort: "received", align: "right" },
  { key: "shortfall", label: "Shortfall", sort: "shortfall", align: "right" },
  { key: "tat", label: "TAT (d)", sort: "tat", align: "center" },
  { key: "risk", label: "Risk", align: "center" },
  { key: "status", label: "Status", sort: "status" },
];

/** Text columns sort A→Z first; amounts and TAT start with the largest. */
const FIRST_DIR: Record<CaseSort, SortDir> = { case: "desc", patient: "asc", insurer: "asc", status: "asc", billed: "desc", approved: "desc", received: "desc", shortfall: "desc", tat: "desc" };

export function CasesReportCard({
  data,
  sort,
  dir,
  params,
}: {
  data: CasesReport;
  sort: CaseSort;
  dir: SortDir;
  /** Current query parameters to keep in sort/page links (range, tab). */
  params: Record<string, string | undefined>;
}) {
  const href = (s: CaseSort) => {
    const d = s === sort ? (dir === "asc" ? "desc" : "asc") : FIRST_DIR[s];
    const sp = new URLSearchParams(Object.entries({ ...params, sort: s, dir: d }).filter(([, v]) => v) as [string, string][]);
    return `/reports?${sp.toString()}`;
  };

  return (
    <section className={styles.card} aria-labelledby="cases-report-title">
      <header className={styles.cardHeader}>
        <h2 id="cases-report-title" className={styles.cardTitle}>
          <span className={styles.big}>{data.total.toLocaleString("en-IN")}</span> {data.total === 1 ? "Case" : "Cases"}
        </h2>
        <span className={styles.cardNote}>Claims you can access · amounts as recorded</span>
      </header>
      {data.rows.length === 0 ? (
        <EmptyState title="No cases available">Cases will appear here once claims are created.</EmptyState>
      ) : (
        <>
          <div className={styles.scroller} role="region" aria-label="Cases" tabIndex={0}>
            <table className={styles.table}>
              <caption className="visually-hidden">Cases, sorted by {COLUMNS.find((c) => c.sort === sort)?.label} ({dir === "asc" ? "ascending" : "descending"})</caption>
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const active = c.sort === sort;
                    return (
                      <th key={c.key} scope="col" className={c.align ? styles[c.align] : undefined} aria-sort={c.sort && active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                        {c.sort ? (
                          <Link href={href(c.sort)} scroll={false} className={styles.sortLink} data-active={active || undefined}>
                            {c.label}
                            <span className={styles.sortIcon} aria-hidden="true">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
                          </Link>
                        ) : (
                          <span title={NOT_RECORDED}>{c.label}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/claims/${r.id}`} className={styles.caseNo}>{r.reference}</Link></td>
                    <td className={styles.patient}>{r.patientName}</td>
                    <td className={styles.insurer}>{r.payerName ?? "—"}</td>
                    <td className={styles.muted} title={NOT_RECORDED}>—</td>
                    <td className={styles.right}>{formatINR(r.billed)}</td>
                    <td className={`${styles.right} ${styles.good}`}>{formatINR(r.approved)}</td>
                    <td className={`${styles.right} ${styles.good}`}>{formatINR(r.received)}</td>
                    <td className={`${styles.right} ${r.shortfall > 0 ? styles.bad : styles.muted}`}>{formatINR(r.shortfall)}</td>
                    <td className={styles.center}>
                      {r.tatDays === null ? (
                        <span className={styles.muted} title="Not submitted yet">—</span>
                      ) : (
                        <span className={styles.pill} style={{ "--c": TAT_COLORS[tatTone(r.tatDays)] } as React.CSSProperties} title={r.tatOpen ? "Still awaiting a decision (days so far)" : "Days from submission to decision"}>
                          {r.tatDays}
                          {r.tatOpen && <span className={styles.open}> · open</span>}
                        </span>
                      )}
                    </td>
                    <td className={`${styles.center} ${styles.muted}`} title={NOT_RECORDED}>—</td>
                    <td><Badge tone={CLAIM_STATUS_TONE[r.status as ClaimStatus]}>{CLAIM_STATUS_LABEL[r.status as ClaimStatus]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.pageSize && <Pagination basePath="/reports" params={{ ...params, sort, dir }} page={data.page} pageSize={data.pageSize} total={data.total} />}
        </>
      )}
    </section>
  );
}

/* ---------------- TAT distribution ---------------- */

/**
 * Vertical bars with a subtle isometric (3D) face, one per TAT bucket. Every value is
 * printed above its bar, so the chart reads without hovering; the table below carries
 * the same numbers (and the money) for screen readers and exact figures.
 */
function TatBarChart({ buckets, total }: { buckets: TatDistribution["buckets"]; total: number }) {
  const max = Math.max(0, ...buckets.map((b) => b.cases));
  return (
    <figure className={styles.chart}>
      <figcaption className="visually-hidden">Number of submitted cases in each turnaround-time bucket</figcaption>
      <ol className={styles.bars}>
        {buckets.map((b, i) => {
          const share = total > 0 ? Math.round((b.cases / total) * 100) : 0;
          return (
            <li key={b.key} className={styles.barCol} style={{ "--c": TAT_COLORS[i], "--h": max > 0 ? b.cases / max : 0 } as React.CSSProperties}>
              {/* Plot area: the value label rides directly on top of its bar. */}
              <span className={styles.barSlot}>
                <span className={styles.barValue}>
                  <span className={styles.dot} aria-hidden="true" />
                  {b.cases.toLocaleString("en-IN")}
                  <span className="visually-hidden"> {b.cases === 1 ? "case" : "cases"} in {b.label}</span>
                </span>
                {b.cases > 0 && <span className={styles.bar3d} aria-hidden="true" />}
              </span>
              <span className={styles.barLabel} aria-hidden="true">
                {b.label}
                <span className={styles.barShare}>{total > 0 ? `${share}%` : "—"}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function TatDistributionCard({ data }: { data: TatDistribution | null }) {
  const buckets = data?.buckets ?? [];
  const total = data?.totalCases ?? 0;
  return (
    <section className={styles.card} aria-labelledby="tat-dist-title">
      <header className={styles.cardHeader}>
        <h2 id="tat-dist-title" className={styles.cardTitle}>Turnaround time distribution</h2>
        <span className={styles.cardNote}>{total.toLocaleString("en-IN")} submitted {total === 1 ? "case" : "cases"} · TAT = days from submission to decision</span>
      </header>
      <TatBarChart buckets={buckets} total={total} />
      <div className={styles.scroller} role="region" aria-label="Turnaround time distribution" tabIndex={0}>
        <table className={styles.table}>
          <caption className="visually-hidden">Cases by turnaround time</caption>
          <thead>
            <tr>
              <th scope="col">TAT bucket</th>
              <th scope="col" className={styles.right}>Cases</th>
              <th scope="col" className={styles.right}>Billed</th>
              <th scope="col" className={styles.right}>Approved</th>
              <th scope="col" className={styles.right}>Received</th>
              <th scope="col" className={styles.center}><span title={NOT_RECORDED}>Avg risk</span></th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b, i) => {
              const color = TAT_COLORS[i]!;
              return (
                <tr key={b.key} className={styles.bucketRow} style={{ "--c": color } as React.CSSProperties}>
                  <th scope="row">
                    <span className={styles.bucket}>
                      <span className={styles.dot} aria-hidden="true" />
                      {b.label}
                    </span>
                  </th>
                  <td className={`${styles.right} ${styles.strong}`}>{b.cases.toLocaleString("en-IN")}</td>
                  <td className={styles.right}>{formatINR(b.billed)}</td>
                  <td className={`${styles.right} ${styles.good}`}>{formatINR(b.approved)}</td>
                  <td className={`${styles.right} ${styles.good}`}>{formatINR(b.received)}</td>
                  <td className={styles.center}><span className={styles.neutralPill} title={NOT_RECORDED}>—</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total === 0 && <p className={styles.footNote}>No submitted cases yet — the buckets fill in as claims are submitted and decided.</p>}
      {data && data.notSubmitted > 0 && (
        <p className={styles.footNote}>{data.notSubmitted.toLocaleString("en-IN")} draft {data.notSubmitted === 1 ? "claim is" : "claims are"} not yet submitted, so {data.notSubmitted === 1 ? "it has" : "they have"} no TAT and {data.notSubmitted === 1 ? "is" : "are"} not included.</p>
      )}
    </section>
  );
}
