"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./ButtonTabs.module.css";

export interface ButtonTab {
  key: string;
  label: string;
  panel: ReactNode;
}

/**
 * In-page tabs: buttons switch the panel shown below them without navigating.
 * Panels are rendered on the server; only their visibility changes here.
 * With `urlParam`, the selected tab is also written to the address bar (no reload),
 * so links that keep that parameter (sorting, paging) return to the same tab.
 */
export function ButtonTabs({ tabs, initial, label, urlParam }: { tabs: ButtonTab[]; initial?: string; label: string; urlParam?: string }) {
  const id = useId();
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial! : tabs[0]!.key);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(key: string) {
    setActive(key);
    if (urlParam) {
      const url = new URL(window.location.href);
      url.searchParams.set(urlParam, key);
      window.history.replaceState(window.history.state, "", url);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = tabs.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    select(tabs[to]!.key);
    refs.current[to]?.focus();
  }

  return (
    <div className={styles.wrap}>
      <div role="tablist" aria-label={label} className={styles.list}>
        {tabs.map((t, i) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => select(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`${id}-panel-${t.key}`}
          aria-labelledby={`${id}-tab-${t.key}`}
          hidden={t.key !== active}
          className={styles.panel}
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}
