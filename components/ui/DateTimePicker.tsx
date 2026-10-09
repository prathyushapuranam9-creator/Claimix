"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./DateTimePicker.module.css";

/** Date (YYYY-MM-DD) and time (HH:mm:ss.SSS) as stored. */
export interface DateTimeValue {
  date?: string;
  time?: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const SIXTY = Array.from({ length: 60 }, (_, i) => pad(i));
const MILLIS = Array.from({ length: 10 }, (_, i) => pad(i * 100, 3));

/** "HH:mm" / "HH:mm:ss" / "HH:mm:ss.SSS" → [hh, mm, ss, SSS]. */
function splitTime(t?: string): [string, string, string, string] {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?$/.exec(t ?? "");
  return m ? [m[1]!, m[2]!, m[3] ?? "00", m[4] ?? "000"] : ["00", "00", "00", "000"];
}

/** The display format: "YYYY/MM/DD HH:mm:ss.SSS". */
export function formatDateTime(v: DateTimeValue): string {
  if (!v.date) return "";
  const [h, m, s, ms] = splitTime(v.time);
  return `${v.date.replace(/-/g, "/")} ${h}:${m}:${s}.${ms}`;
}

/** Parses the display format back (null when it doesn't match a real date and time). */
export function parseDateTime(text: string): DateTimeValue | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(text.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null;
  return { date, time: `${m[4]}:${m[5]}:${m[6]}.${m[7]}` };
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Combined date and time picker. The input shows "YYYY/MM/DD HH:mm:ss.SSS" and can also be typed into; the calendar
 * icon (or focusing the input) opens a popover with a month grid on the left and hr / min / sec / ms columns on the
 * right. Choices there are pending until Confirm; Escape or a click outside closes without saving them.
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
  const [text, setText] = useState(formatDateTime(value));
  const [typedError, setTypedError] = useState<string | null>(null);
  // Pending selection inside the popover.
  const [pDate, setPDate] = useState<string>(value.date ?? todayIso());
  const [pTime, setPTime] = useState(splitTime(value.time));
  const [view, setView] = useState(() => {
    const [y, m] = (value.date ?? todayIso()).split("-").map(Number) as [number, number];
    return { y, m: m - 1 };
  });

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
    setPTime(splitTime(value.time));
    const [y, m] = d.split("-").map(Number) as [number, number];
    setView({ y, m: m - 1 });
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
    const [h, m, s, ms] = pTime;
    onChange({ date: pDate, time: `${h}:${m}:${s}.${ms}` });
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
    } else setTypedError("Use YYYY/MM/DD HH:mm:ss.SSS, e.g. 2026/05/14 09:30:00.000.");
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
  const daysIn = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const iso = (d: number) => `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
  const today = todayIso();
  const step = (delta: number) => setView((v) => {
    const m = v.m + delta;
    return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });

  const column = (name: string, aria: string, values: string[], idx: 0 | 1 | 2 | 3) => (
    <div className={styles.col}>
      <span className={styles.colHead} aria-hidden="true">{name}</span>
      <ul className={styles.colList} role="listbox" aria-label={aria} data-col={name}>
        {values.map((v) => (
          <li key={v} role="option" aria-selected={pTime[idx] === v}>
            <button
              type="button"
              className={styles.colItem}
              tabIndex={pTime[idx] === v ? 0 : -1}
              onClick={() => setPTime((t) => {
                const n = [...t] as typeof t;
                n[idx] = v;
                return n;
              })}
            >
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
          placeholder="YYYY/MM/DD HH:mm:ss.SSS"
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
              <div className={styles.monthNav}>
                <button type="button" className={styles.navBtn} aria-label="Previous month" onClick={() => step(-1)}>‹</button>
                <span className={styles.monthLabel} aria-live="polite">{MONTHS[view.m]} {view.y}</span>
                <button type="button" className={styles.navBtn} aria-label="Next month" onClick={() => step(1)}>›</button>
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
            </div>
            <div className={styles.timePane}>
              {column("hr", "Hours", HOURS, 0)}
              {column("min", "Minutes", SIXTY, 1)}
              {column("sec", "Seconds", SIXTY, 2)}
              {column("ms", "Milliseconds", MILLIS, 3)}
            </div>
          </div>
          <div className={styles.actions}>
            <span className={styles.pending}>{formatDateTime({ date: pDate, time: pTime.join(":").replace(/:(\d{3})$/, ".$1") })}</span>
            <button type="button" className={styles.confirm} onClick={confirm}>Confirm</button>
          </div>
        </div>
      )}
    </div>
  );
}
