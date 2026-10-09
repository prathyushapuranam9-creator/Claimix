"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import styles from "./ComboBox.module.css";

export interface ComboOption {
  value: string;
  label: string;
  /** Extra text matched by the search (e.g. a code). */
  hint?: string;
}

/**
 * Autocompleting select (WAI-ARIA combobox + listbox). Single: picks one value. Multiple: picked values show as chips
 * that can be removed; the first is the primary one. Keyboard: ↑/↓ to move, Enter to pick, Escape to close.
 */
export function ComboBox({
  label,
  options,
  value,
  onChange,
  multiple = false,
  placeholder,
  required,
  error,
  hint,
  max = 10,
}: {
  label: string;
  options: ComboOption[];
  value: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  max?: number;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const single = !multiple ? byValue.get(value[0] ?? "") : undefined;

  const matches = useMemo(() => {
    const t = query.trim().toLowerCase();
    const list = options.filter((o) => !(multiple && value.includes(o.value)));
    return (t ? list.filter((o) => o.label.toLowerCase().includes(t) || o.hint?.toLowerCase().includes(t)) : list).slice(0, 50);
  }, [options, query, value, multiple]);

  const pick = (o: ComboOption) => {
    // The list closes after each pick (so it never covers what follows); typing or ↓ opens it again.
    onChange(multiple ? (value.length < max ? [...value, o.value] : value) : [o.value]);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && matches[active]) {
        e.preventDefault();
        pick(matches[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && multiple && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      <div className={styles.control} data-invalid={error ? "true" : undefined} onClick={() => input.current?.focus()}>
        {multiple &&
          value.map((v, i) => (
            <span key={v} className={styles.chip}>
              {byValue.get(v)?.label ?? v}
              {i === 0 && value.length > 1 && <span className={styles.primary}> (primary)</span>}
              <button type="button" className={styles.chipRemove} aria-label={`Remove ${byValue.get(v)?.label ?? v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
                ×
              </button>
            </span>
          ))}
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          className={styles.input}
          placeholder={single ? single.label : placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          autoComplete="off"
        />
        {!multiple && single && (
          <button type="button" className={styles.clear} aria-label={`Clear ${label}`} onClick={() => onChange([])}>
            ×
          </button>
        )}
      </div>
      {!multiple && single && <span className={styles.selected}>Selected: {single.label}</span>}
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className={styles.list}>
          {matches.length === 0 ? (
            <li className={styles.empty} role="presentation">No match for “{query}”</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={styles.option}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      )}
      {hint && !error && <span id={`${id}-hint`} className={styles.hint}>{hint}</span>}
      {error && <span id={`${id}-error`} className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
