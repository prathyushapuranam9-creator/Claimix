import { formatINR } from "@/lib/india";
import { compactINR, formatHours, hoursToDays } from "@/modules/reports/format";
import type { ReportOverview } from "@/modules/reports/reports.service";
import { EmptyState } from "@/components/ui/Surface";
import styles from "./PerformanceCharts.module.css";

interface Bar {
  label: string;
  value: number | null;
  /** Full value printed above the bar. */
  display: string;
  /** Tooltip lines: first is the value (bold), the rest are context. */
  tip: string[];
}

/** Space kept above the tallest bar for its value label; bars and gridlines share this scale. */
const HEADROOM = "1.75rem";

/** Rounds up to a clean axis maximum (1, 2, 5 × 10ⁿ), at least `floor`. */
function niceMax(v: number, floor: number) {
  if (v <= floor) return floor;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/**
 * A single-series vertical bar graph with a labelled y-axis. Every bar has its full value
 * above it, and a tooltip on hover/focus; bars with no value (nothing to measure yet) show
 * "—" instead of a fake zero-height bar.
 */
function BarGraph({ title, axisLabel, bars, tick, emptyNote }: { title: string; axisLabel: string; bars: Bar[]; tick: (v: number) => string; emptyNote: string }) {
  const max = Math.max(0, ...bars.map((b) => b.value ?? 0));
  const top = niceMax(max, axisLabel === "Days" ? 1 : 1000);
  const ticks = [top, top * 0.75, top / 2, top / 4, 0];
  return (
    <section className={styles.card} aria-labelledby={`${title}-h`.replace(/\W+/g, "-")}>
      <h3 id={`${title}-h`.replace(/\W+/g, "-")} className={styles.title}>{title}</h3>
      <figure className={styles.figure}>
        <figcaption className="visually-hidden">{title}, {axisLabel}</figcaption>
        <div className={styles.plotWrap}>
          <span className={styles.axisLabel} aria-hidden="true">{axisLabel}</span>
          <div className={styles.ticks} aria-hidden="true">
            {ticks.map((t) => <span key={t}>{tick(t)}</span>)}
          </div>
          <div className={styles.plot}>
            {ticks.map((t) => <span key={t} className={styles.grid} style={{ bottom: `calc(${t / top} * (100% - ${HEADROOM}))` }} aria-hidden="true" />)}
            {bars.map((b) => (
              <div key={b.label} className={styles.col} tabIndex={0} role="img" aria-label={`${b.label}: ${b.tip.join(", ")}`}>
                <span className={styles.value} aria-hidden="true">{b.display}</span>
                {b.value !== null && <span className={styles.bar} style={{ height: `calc(${b.value / top} * (100% - ${HEADROOM}))` }} aria-hidden="true" />}
                <span className={styles.tip} aria-hidden="true">
                  <span className={styles.tipLabel}>{b.label}</span>
                  {b.tip.map((line, i) => (i === 0 ? <strong key={line}>{line}</strong> : <span key={line}>{line}</span>))}
                </span>
              </div>
            ))}
          </div>
          <span />
          <span />
          <div className={styles.xLabels} aria-hidden="true">
            {bars.map((b) => <span key={b.label}>{b.label}</span>)}
          </div>
        </div>
      </figure>
      {bars.every((b) => b.value === null) && <p className={styles.note}>{emptyNote}</p>}
    </section>
  );
}

type Tat = { avgHours: number | null; medianHours: number | null; decided: number; awaiting: number } | null;

/** What both graphs need — the same shape the Reports overview and the dashboard already load. */
export interface PerformanceData {
  financials: { claimed: number; approved: number; settled: number }[];
  preauthTat: Tat;
  claimTat: Tat;
}

/**
 * The two graphs: turnaround (existing submission → first payer decision calculation, as the
 * average in days) and claim money (existing claimed / approved / settled-paid totals).
 * Shows an empty state rather than bars when there is nothing real to show.
 */
export function PerformanceGraphs({ data }: { data: PerformanceData }) {
  const totals = data.financials.reduce((a, f) => ({ claimed: a.claimed + f.claimed, approved: a.approved + f.approved, settled: a.settled + f.settled }), { claimed: 0, approved: 0, settled: 0 });
  const tat = (name: string, t: Tat): Bar => {
    const avg = hoursToDays(t?.avgHours ?? null);
    return {
      label: name,
      value: avg,
      display: avg === null ? "—" : `${avg.toFixed(1)} days`,
      tip: avg === null
        ? ["No decided cases yet"]
        : [`Average: ${avg.toFixed(1)} days`, `Median: ${formatHours(t?.medianHours ?? null)}`, `${t?.decided ?? 0} decided · ${t?.awaiting ?? 0} awaiting`],
    };
  };
  const hasClaims = data.financials.length > 0;
  const money = (label: string, v: number): Bar => ({ label, value: hasClaims ? v : null, display: hasClaims ? formatINR(v) : "—", tip: hasClaims ? [formatINR(v)] : ["No claims yet"] });
  const turnaround = [tat("Pre-auth turnaround", data.preauthTat), tat("Claim turnaround", data.claimTat)];
  const financial = [money("Claimed", totals.claimed), money("Approved", totals.approved), money("Settled (paid)", totals.settled)];

  if (turnaround.every((b) => b.value === null) && !hasClaims) {
    return <EmptyState title="No performance data available">Performance metrics will appear once claims are created.</EmptyState>;
  }
  return (
    <div className={styles.pair}>
      <BarGraph title="Turnaround Performance" axisLabel="Days" bars={turnaround} tick={(v) => String(Number(v.toFixed(2)))} emptyNote="No decided pre-authorizations or claims in this period." />
      <BarGraph title="Financial Performance" axisLabel="Amount (₹)" bars={financial} tick={compactINR} emptyNote="No claims in this period." />
    </div>
  );
}

/** Reports overview: the graphs under their own "Performance & financial metrics" heading. */
export function PerformanceCharts({ data }: { data: ReportOverview }) {
  return (
    <section className={styles.section} aria-labelledby="perf-title">
      <h2 id="perf-title" className={styles.sectionTitle}>Performance &amp; financial metrics</h2>
      <PerformanceGraphs data={data} />
    </section>
  );
}
