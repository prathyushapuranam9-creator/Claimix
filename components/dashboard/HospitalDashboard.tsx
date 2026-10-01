import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import s from "./HospitalDashboard.module.css";

/** Static lobby backdrop. Add the image at public/hospital-lobby.png; without it the themed page background shows. */
function HospitalBackdrop() {
  return <div className={s.backdrop} style={{ backgroundImage: "url(/hospital-lobby.png)" }} aria-hidden="true" />;
}

const svg = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icons = {
  help: svg(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>),
  doc: svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  check: svg(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>),
  currency: svg(<><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11h6M9 8c3 0 4.5 1.2 4.5 3S12 14 9 14l5 3" /></>),
  wallet: svg(<><path d="M3 7a2 2 0 0 1 2-2h12v4" /><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" /><path d="M16 14.5h.01" /></>),
  assistant: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>),
  shield: svg(<><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" /><path d="m9.5 12 2 2 3-3.5" /></>),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
};

export function Metric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: string }) {
  return (
    <div className={`${s.glass} ${s.metric}`}>
      <span className={s.icon}>{icon}</span>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

export function ActionLink({ href, icon, primary, children }: { href: string; icon: ReactNode; primary?: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={`${s.action} ${primary ? s.actionPrimary : ""}`}>
      {icon}
      {children}
    </Link>
  );
}

export function Welcome({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className={`${s.glass} ${s.welcome}`}>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className={s.actions}>{children}</div>
    </section>
  );
}

export function Panel({ icon, title, href, children }: { icon: ReactNode; title: string; href: string; children: ReactNode }) {
  return (
    <section className={s.glass}>
      <header className={s.panelHead}>
        <span className={s.icon}>{icon}</span>
        <h2>{title}</h2>
        <Link href={href}>All</Link>
      </header>
      <div className={s.panelBody}>{children}</div>
    </section>
  );
}

export const Metrics = ({ children }: { children: ReactNode }) => <div className={s.metrics}>{children}</div>;
export const Queues = ({ children }: { children: ReactNode }) => <div className={s.queues}>{children}</div>;
export const HospitalPage = ({ children }: { children: ReactNode }) => (
  <>
    <HospitalBackdrop />
    <div className={s.page}>{children}</div>
  </>
);

const pct = (v: number, of: number) => (of > 0 ? Math.min(100, Math.max(0, (v / of) * 100)) : 0);
const pvar = (p: number) => ({ "--p": p.toFixed(1) }) as CSSProperties;

export function Layout({ children }: { children: ReactNode }) {
  return <div className={s.layout}>{children}</div>;
}
export function Col({ side, children }: { side?: boolean; children: ReactNode }) {
  return <div className={`${s.col} ${side ? s.colSide : s.colMain}`}>{children}</div>;
}

export function WelcomeCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className={`${s.glass} ${s.welcome}`}>
      <div className={s.welcomeTop}>
        <span className={s.avatar} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4.5" /><path d="M3.5 21a8.5 8.5 0 0 1 17 0z" /></svg>
        </span>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className={s.actions}>{children}</div>
    </section>
  );
}

export function Rings({ children }: { children: ReactNode }) {
  return <div className={s.rings}>{children}</div>;
}

/** Ring gauge. The arc shows `value` as a share of `of` (empty when there is nothing to compare against). */
export function RingMetric({ label, value, of, hint }: { label: string; value: number; of: number; hint?: string }) {
  return (
    <div className={`${s.glass} ${s.ringCard}`}>
      <span className={s.label}>{label}</span>
      <div className={s.ring} style={pvar(pct(value, of))} role="img" aria-label={`${label}: ${value}`}>
        <span>{value}</span>
      </div>
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

/** Metric card with a thin progress bar showing `value` as a share of `of`. */
export function BarMetric({ icon, label, value, display, of, hint }: { icon: ReactNode; label: string; value: number; display: ReactNode; of: number; hint?: string }) {
  return (
    <div className={`${s.glass} ${s.metric}`}>
      <span className={s.icon}>{icon}</span>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{display}</span>
      {hint && <span className={s.hint}>{hint}</span>}
      <div className={s.bar} role="presentation"><span style={pvar(pct(value, of))} /></div>
    </div>
  );
}

export function Card({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <section className={`${s.glass} ${s.cardPad}`}>
      <h2 className={s.cardTitle}>{title}</h2>
      {children}
      {updated && <p className={s.updated}>Last Updated: {updated}</p>}
    </section>
  );
}

/** Line chart of how many cases were awaiting the payer at each point today. */
export function TrendChart({ points }: { points: { label: string; n: number }[] }) {
  const W = 300, H = 84, padL = 22, padB = 16, padT = 6;
  const max = Math.max(1, ...points.map((p) => p.n));
  const x = (i: number) => padL + (points.length < 2 ? 0 : (i / (points.length - 1)) * (W - padL - 6));
  const y = (n: number) => padT + (1 - n / max) * (H - padT - padB);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.n).toFixed(1)}`).join(" ");
  return (
    <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cases awaiting the payer over time today">
      {[0, max].map((v) => (
        <g key={v}>
          <line className={s.grid} x1={padL} x2={W - 6} y1={y(v)} y2={y(v)} />
          <text x={padL - 4} y={y(v) + 3} textAnchor="end">{v}</text>
        </g>
      ))}
      {points.length > 1 && <path className={s.line} d={path} />}
      {points.map((p, i) => <circle key={i} className={s.dot} cx={x(i)} cy={y(p.n)} r={2.5} />)}
      {points.map((p, i) => (i % Math.ceil(points.length / 4) === 0 ? <text key={i} x={x(i)} y={H - 4} textAnchor="middle">{p.label}</text> : null))}
    </svg>
  );
}

export function Donut({ share, children }: { share: number; children: ReactNode }) {
  return (
    <div className={s.donutRow}>
      <div className={s.kvGrid}>{children}</div>
      <div className={s.donut} style={pvar(share)} role="presentation" />
    </div>
  );
}

export const KV = ({ value, label }: { value: ReactNode; label: string }) => (
  <div className={s.kv}>
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
);

export const Perf = ({ children }: { children: ReactNode }) => <div className={s.perf}>{children}</div>;
