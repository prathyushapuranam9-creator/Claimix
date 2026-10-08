"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_COOKIE } from "./theme";
import styles from "./ThemeToggle.module.css";

/**
 * The saved choice lives in a cookie so the server renders <html data-theme> with it: no script runs before paint and
 * there is no flash of the wrong theme. Without a saved choice the CSS follows the OS preference.
 */
export const THEME_KEY = THEME_COOKIE;

type Theme = "light" | "dark";

const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark";

function save(t: Theme) {
  document.cookie = `${THEME_COOKIE}=${t}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable: the cookie still keeps the choice */
  }
}

/** The theme on <html>, or the OS preference when nothing was chosen. */
function current(): Theme {
  const t = document.documentElement.dataset.theme;
  if (isTheme(t)) return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  // No choice rendered by the server: carry over one saved before the cookie existed (localStorage only), otherwise
  // mark the OS preference on <html> (the CSS already showed it before paint, so nothing changes on screen).
  useEffect(() => {
    if (isTheme(document.documentElement.dataset.theme)) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      /* storage unavailable */
    }
    if (isTheme(saved)) save(saved);
    document.documentElement.dataset.theme = isTheme(saved) ? saved : current();
  }, []);

  const toggle = () => {
    document.documentElement.dataset.theme = next;
    save(next);
  };

  return (
    <button type="button" className={styles.btn} onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "dark" ? (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
