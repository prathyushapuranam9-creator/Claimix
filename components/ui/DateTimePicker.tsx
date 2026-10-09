"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./DateTimePicker.module.css";

/** Date (YYYY-MM-DD) and time (24-hour HH:mm) as stored. */
export interface DateTimeValue {
  date?: string;
  time?: string;
}

type Meridiem = "AM" | "PM";
/** The picker's own time: 12-hour clock with AM / PM. */
interface Clock {
  h: string; // "01".."12"
  m: string; // "00".."59"
  ap: Meridiem;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const HOURS12 = Array.from({ length: 12 }, (_, i) => pad(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));
/** The gap between the date and the time in the field. */
const GAP = "   ";

/** Stored "HH:mm" (any trailing seconds are ignored) → 12-hour clock. */
export function toClock(t?: string): Clock {
  const m = /^(\d{2}):(\d{2})/.exec(t ?? "");
  if (!m) return { h: "12", m: "00", ap: "AM" };
  const h24 = Number(m[1]);
  return { h: pad(h24 % 12 === 0 ? 12 : h24 % 12), m: m[2]!, ap: h24 < 12 ? "AM" : "PM" };
}

/** 12-hour clock → stored 24-hour "HH:mm" (12 AM = 00, 12 PM = 12). */
export function fromClock(c: Clock): string {
  const h = Number(c.h) % 12 + (c.ap === "PM" ? 12 : 0);
  return `${pad(h)}:${c.m}`;
}

/** The display format: "DD/MM/YYYY   hh:mm AM" (12-hour clock; no seconds). */
export function formatDateTime(v: DateTimeValue): string {
  if (!v.date) return "";
  const [y, mo, d] = v.date.split("-");
  const c = toClock(v.time);
  return `${d}/${mo}/${y}${GAP}${c.h}:${c.m} ${c.ap}`;
}

/** Parses the display format back ("DD/MM/YYYY hh:mm AM", any spacing); null when it isn't a real date and time. */
export function parseDateTime(text: string): DateTimeValue | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i.exec(text.trim());
  if (!m) return null;
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null;
  const h = Number(m[4]);
  if (h < 1 || h > 12) return null;
  return { date, time: fromClock({ h: pad(h), m: m[5]!, ap: m[6]!.toUpperCase() as Meridiem }) };
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
/** The same day in another month / year, moved back to that month's last day when it doesn't exist there. */
export const clampDate = (iso: string, y: number, m0: number) => `${y}-${pad(m0 + 1)}-${pad(Math.min(Number(iso.slice(8, 10)), daysIn(y, m0)))}`;

/**
 * Combined date and time picker. The field shows "DD/MM/YYYY   hh:mm AM" and can also be typed into; the calendar
 * icon (or focusing the field) opens a popover with a month grid on the left — the month and the year are buttons
 * that open a month list and a year list — and hour / minute / AM-PM columns on the right. Choices are pending until
 * Confirm; Escape or a click outside closes without saving them. The value is stored as 24-hour HH:mm.
 */
export function DateTimePicker({
  label = "Date and time",
  labelledBy,
  required,
  value,
  onChange,
  error,
  disabled,
}: {
  label?: string;
  /** Extra element ids prepended to the accessible name (e.g. "Stay starts"). */
  labelledBy?: string;
  required?: boolean;
  value: DateTimeValue;
  onChange: (v: DateTimeValue) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const popId = `${id}-pop`;
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const [text, setText] = useState(formatDateTime(value));
  const [typedError, setTypedError] = useState<string | null>(null);
  // Pending selection inside the popover.
  const [pDate, setPDate] = useState<string>(value.date ?? todayIso());
  const [pClock, setPClock] = useState<Clock>(toClock(value.time));
  const [view, setView] = useState(() => {
    const [y, m] = (value.date ?? todayIso()).split("-").map(Number) as [number, number];
    return { y, m: m - 1 };
  });
  const [yearPage, setYearPage] = useState(() => Math.floor(view.y / 12) * 12);

  const shown = formatDateTime(value);
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    // The value changed from outside (a save or a reset): show it.
    setLastShown(shown);
    setText(shown);
  }

  const openPopover = () => {
    if (disabled || open) return;
    const d = value.date ?? todayIso();
    setPDate(d);
    setPClock(toClock(value.time));
    const [y, m] = d.split("-").map(Number) as [number, number];
    setView({ y, m: m - 1 });
    setYearPage(Math.floor(y / 12) * 12);
    setMode("days");
    setOpen(true);
  };

  // Outside click / Escape close without saving.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Bring each column's selected value into view.
    wrap.current?.querySelectorAll<HTMLElement>("[data-col] [aria-selected='true']").forEach((el) => el.scrollIntoView({ block: "center" }));
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const confirm = () => {
    onChange({ date: pDate, time: fromClock(pClock) });
    setTypedError(null);
    setOpen(false);
  };

  const commitTyped = () => {
    if (text.trim() === "") {
      if (value.date) onChange({});
      setTypedError(null);
      return;
    }
    const parsed = parseDateTime(text);
    if (parsed) {
      setTypedError(null);
      if (formatDateTime(parsed) !== shown) onChange(parsed);
      else setText(shown);
    } else setTypedError("Use DD/MM/YYYY hh:mm AM or PM, e.g. 01/10/2026 10:20 AM.");
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTyped();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      openPopover();
    }
  };

  // Month grid, Monday first.
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn(view.y, view.m) }, (_, i) => i + 1)];
  const iso = (d: number) => `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
  const today = todayIso();
  const stepMonth = (delta: number) =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  // Picking a month or a year keeps the chosen day where it exists, otherwise the month's last day.
  const pickMonth = (m0: number) => {
    setView((v) => ({ ...v, m: m0 }));
    setPDate((d) => clampDate(d, view.y, m0));
    setMode("days");
  };
  const pickYear = (y: number) => {
    setView((v) => ({ ...v, y }));
    setPDate((d) => clampDate(d, y, view.m));
    setMode("days");
  };

  const column = <K extends keyof Clock>(name: string, aria: string, values: readonly Clock[K][], key: K) => (
    <div className={styles.col}>
      <span className={styles.colHead} aria-hidden="true">{name}</span>
      <ul className={styles.colList} role="listbox" aria-label={aria} data-col={name}>
        {values.map((v) => (
          <li key={v} role="option" aria-selected={pClock[key] === v}>
            <button type="button" className={styles.colItem} tabIndex={pClock[key] === v ? 0 : -1} onClick={() => setPClock((c) => ({ ...c, [key]: v }))}>
              {v}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const err = typedError ?? error;
  return (
    <div ref={wrap} className={styles.wrap}>
      <label id={labelId} htmlFor={id} className={styles.label}>
        {label}
        {required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      <div className={styles.control} data-invalid={err ? "true" : undefined}>
        <input
          id={id}
          className={styles.input}
          value={text}
          placeholder="DD/MM/YYYY   hh:mm AM"
          aria-labelledby={labelledBy ? `${labelledBy} ${labelId}` : labelId}
          aria-required={required || undefined}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-error` : undefined}
          aria-haspopup="dialog"
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onFocus={openPopover}
          onBlur={commitTyped}
          onKeyDown={onInputKey}
        />
        <button type="button" className={styles.icon} aria-label="Open the date and time picker" aria-expanded={open} aria-controls={popId} disabled={disabled} onClick={() => (open ? setOpen(false) : openPopover())}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>
      {err && <span id={`${id}-error`} className={styles.error} role="alert">{err}</span>}

      {open && (
        <div id={popId} className={styles.popover} role="dialog" aria-label="Choose date and time">
          <div className={styles.split}>
            <div className={styles.datePane}>
              {mode === "days" && (
                <>
                  <div className={styles.monthNav}>
                    <button type="button" className={styles.navBtn} aria-label="Previous month" onClick={() => stepMonth(-1)}>‹</button>
                    <span className={styles.monthLabel} aria-live="polite">
                      <button type="button" className={styles.headBtn} aria-label={`Choose month, ${MONTHS[view.m]}`} onClick={() => setMode("months")}>{MONTHS[view.m]}</button>
                      <button
                        type="button"
                        className={styles.headBtn}
                        aria-label={`Choose year, ${view.y}`}
                        onClick={() => {
                          setYearPage(Math.floor(view.y / 12) * 12);
                          setMode("years");
                        }}
                      >
                        {view.y}
                      </button>
                    </span>
                    <button type="button" className={styles.navBtn} aria-label="Next month" onClick={() => stepMonth(1)}>›</button>
                  </div>
                  <div className={styles.grid} role="grid" aria-label={`${MONTHS[view.m]} ${view.y}`}>
                    {WEEKDAYS.map((w) => <span key={w} className={styles.weekday} role="columnheader">{w}</span>)}
                    {cells.map((d, i) =>
                      d === null ? (
                        <span key={`e${i}`} />
                      ) : (
                        <button
                          key={d}
                          type="button"
                          className={styles.day}
                          data-today={iso(d) === today || undefined}
                          aria-pressed={iso(d) === pDate}
                          aria-label={`${d} ${MONTHS[view.m]} ${view.y}`}
                          onClick={() => setPDate(iso(d))}
                        >
                          {d}
                        </button>
                      ),
                    )}
                  </div>
                </>
              )}
              {mode === "months" && (
                <>
                  <div className={styles.monthNav}>
                    <span className={styles.monthLabel}>Choose a month · {view.y}</span>
                    <button type="button" className={styles.headBtn} onClick={() => setMode("days")}>Back</button>
                  </div>
                  <div className={styles.pickGrid} role="listbox" aria-label="Months">
                    {MONTHS_SHORT.map((m, i) => (
                      <button key={m} type="button" role="option" aria-selected={i === view.m} aria-label={MONTHS[i]} className={styles.pickItem} onClick={() => pickMonth(i)}>
                        {m}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {mode === "years" && (
                <>
                  <div className={styles.monthNav}>
                    <button type="button" className={styles.navBtn} aria-label="Earlier years" onClick={() => setYearPage((p) => p - 12)}>‹</button>
                    <span className={styles.monthLabel}>{yearPage} – {yearPage + 11}</span>
                    <button type="button" className={styles.navBtn} aria-label="Later years" onClick={() => setYearPage((p) => p + 12)}>›</button>
                  </div>
                  <div className={styles.pickGrid} role="listbox" aria-label="Years">
                    {Array.from({ length: 12 }, (_, i) => yearPage + i).map((y) => (
                      <button key={y} type="button" role="option" aria-selected={y === view.y} className={styles.pickItem} onClick={() => pickYear(y)}>
                        {y}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className={styles.timePane}>
              {column("hr", "Hours", HOURS12, "h")}
              {column("min", "Minutes", MINUTES, "m")}
              {column("AM/PM", "AM or PM", ["AM", "PM"] as const, "ap")}
            </div>
          </div>
          <div className={styles.actions}>
            <span className={styles.pending}>{formatDateTime({ date: pDate, time: fromClock(pClock) })}</span>
            <button type="button" className={styles.confirm} onClick={confirm}>Confirm</button>
          </div>
        </div>
      )}
    </div>
  );
}
