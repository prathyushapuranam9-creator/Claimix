import type React from "react";
import styles from "./Charts.module.css";

export interface Datum {
  label: string;
  value: number;
  /** Display text for the value (defaults to the number, en-IN grouped). */
  display?: string;
}

const fmt = (d: Datum) => d.display ?? d.value.toLocaleString("en-IN");

/**
 * Horizontal bars for a single series of categories. Every value is printed at its
 * bar tip, so the chart is fully readable without hover; one hue, no legend.
 */
export function BarList({ data, label }: { data: Datum[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className={styles.barList} aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className={styles.barRow}>
          <span className={styles.barLabel}>{d.label}</span>
          <span className={styles.barTrack}>
            <span className={styles.bar} style={{ "--w": d.value / max } as React.CSSProperties} aria-hidden="true" />
            <span className={styles.barValue}>{fmt(d)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Rounds up to a clean axis maximum (1, 2, 5 × 10ⁿ). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/**
 * Single-series column chart over time. Each column is focusable and shows its
 * value on hover or focus; the table view below carries every value too.
 */
export function ColumnChart({ data, label, valueLabel }: { data: Datum[]; label: string; valueLabel: string }) {
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [top, top / 2, 0];
  const peak = data.reduce<Datum | undefined>((a, d) => (!a || d.value > a.value ? d : a), undefined);
  return (
    <figure className={styles.figure}>
      <div className={styles.plot} role="group" aria-label={label}>
        <div className={styles.axis} aria-hidden="true">
          {ticks.map((t) => <span key={t}>{t.toLocaleString("en-IN")}</span>)}
        </div>
        <div className={styles.columns}>
          {ticks.map((t) => <span key={t} className={styles.grid} style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true" />)}
          {data.map((d) => (
            <div key={d.label} className={styles.slot} tabIndex={0} role="img" aria-label={`${d.label}: ${fmt(d)} ${valueLabel}`}>
              <span className={styles.column} style={{ height: `${(d.value / top) * 100}%` }} aria-hidden="true">
                {d === peak && d.value > 0 && <span className={styles.peak}>{fmt(d)}</span>}
              </span>
              <span className={styles.tip} role="presentation">
                <strong>{fmt(d)}</strong> {valueLabel}
                <br />
                {d.label}
              </span>
              <span className={styles.xLabel} aria-hidden="true">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      <details className={styles.tableView}>
        <summary>Show as table</summary>
        <table>
          <caption className="visually-hidden">{label}</caption>
          <thead><tr><th scope="col">Period</th><th scope="col">{valueLabel}</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{fmt(d)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
