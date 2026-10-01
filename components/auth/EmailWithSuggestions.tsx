"use client";

import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { TextField } from "@/components/ui/Field";
import { forgetRememberedAccounts, readRememberedAccounts, type RememberedAccount } from "@/lib/auth/remembered-accounts";
import styles from "./EmailWithSuggestions.module.css";

/**
 * Email field that, on focus or click, lists accounts previously signed in on this
 * device (combobox + listbox pattern: ↑/↓ to move, Enter to choose, Esc to close).
 * Only emails are listed; the password line is always masked and the password itself
 * comes from the browser's password manager when an account is chosen.
 */
export function EmailWithSuggestions({
  value,
  onChange,
  onPick,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (email: string) => void;
  error?: string;
}) {
  const listId = useId();
  const [accounts, setAccounts] = useState<RememberedAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close only when focus leaves the whole widget (so Tab can reach "Forget saved accounts").
  function onBlurWithin(e: FocusEvent) {
    if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  }

  const query = value.trim().toLowerCase();
  const matches = accounts.filter((a) => !query || a.email.includes(query) || a.email === query);
  const shown = open && matches.length > 0;

  function show() {
    setAccounts(readRememberedAccounts());
    setOpen(true);
    setActive(-1);
  }

  function pick(email: string) {
    setOpen(false);
    setActive(-1);
    onPick(email);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return show();
      setActive((i) => (matches.length ? (i + 1) % matches.length : -1));
    } else if (e.key === "ArrowUp" && shown) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === "Enter" && shown && active >= 0 && matches[active]) {
      e.preventDefault(); // choose the account instead of submitting
      pick(matches[active].email);
    } else if (e.key === "Escape" && shown) {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={styles.wrap} ref={wrapRef} onBlur={onBlurWithin}>
      <TextField
        id="email"
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={show}
        onClick={() => !open && show()}
        onKeyDown={onKeyDown}
        error={error}
      />
      <div className={styles.menu} hidden={!shown}>
        <ul id={listId} role="listbox" aria-label="Saved accounts" className={styles.list}>
          {matches.map((a, i) => (
            <li
              key={a.email}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              // Keep focus in the field so the list doesn't close before the choice registers.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(a.email)}
            >
              <span className={styles.icon} aria-hidden="true"><LogoMark size={18} /></span>
              <span className={styles.text}>
                <span className={styles.email}>{a.email}</span>
                <span className={styles.secret} aria-hidden="true">••••••••••••</span>
                <span className="visually-hidden">, password saved in your browser</span>
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={styles.footer}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            forgetRememberedAccounts();
            setAccounts([]);
            setOpen(false);
          }}
        >
          <span>Forget saved accounts on this device</span>
          <span aria-hidden="true">⚿</span>
        </button>
      </div>
    </div>
  );
}
