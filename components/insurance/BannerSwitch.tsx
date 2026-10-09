"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./Context.module.css";

/**
 * "Switch Context" in the navbar context pill. On the dashboard the full switcher is already on the page, so it just
 * links there; on every other page it opens the same switcher in a dropdown under the pill, so the portal can be
 * switched without leaving the page. Escape or a click outside closes it.
 */
export function BannerSwitch({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (pathname === "/dashboard" || !children) {
    return <Link href="/dashboard#context" className={styles.chipAction}>Switch Context</Link>;
  }
  return (
    <span ref={wrap} className={styles.chipSwitch}>
      <button type="button" className={styles.chipAction} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        Switch Context
      </button>
      {open && (
        <div id={panelId} className={styles.chipPanel}>
          {children}
        </div>
      )}
    </span>
  );
}
