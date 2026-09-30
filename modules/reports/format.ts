/** Pure helpers for report presentation (unit-tested). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" → "Mar 2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : ym;
}

/** Fills missing months between the first and last present month with zero rows, so gaps show as gaps. */
export function fillMonths<T extends { month: string }>(rows: T[], zero: (month: string) => T): T[] {
  if (rows.length < 2) return rows;
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const out: T[] = [];
  let [y, m] = rows[0]!.month.split("-").map(Number) as [number, number];
  const last = rows[rows.length - 1]!.month;
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(byMonth.get(key) ?? zero(key));
    if (key === last) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Turnaround hours as a short human label: "25 min", "6 h", "2.5 days"; null → "—". */
export function formatHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return "—";
  if (h < 1) return h * 60 < 1 ? "< 1 min" : `${Math.round(h * 60)} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}

export type RangePreset = "30d" | "90d" | "12m" | "all";

/** Preset → ISO date range ending today (inclusive). */
export function presetRange(p: RangePreset, today = new Date()): { from?: string; to?: string } {
  if (p === "all") return {};
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const to = d.toISOString().slice(0, 10);
  if (p === "12m") d.setUTCFullYear(d.getUTCFullYear() - 1);
  else d.setUTCDate(d.getUTCDate() - (p === "30d" ? 29 : 89));
  return { from: d.toISOString().slice(0, 10), to };
}
