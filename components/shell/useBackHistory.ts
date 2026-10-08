"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "claimix.backStack";
const REPLACING = "claimix.backReplacing";
const PENDING = "claimix.backPending";
const SIDEBAR = "claimix.backSidebar";
const ARRIVAL = "claimix.backArrival";

/** Call when the user opens a page from the sidebar (or the logo): such a page is a starting point, not a step. */
export function markSidebarNav() {
  try {
    sessionStorage.setItem(SIDEBAR, "1");
  } catch {
    // Storage unavailable.
  }
}

function takeSidebar(): boolean {
  try {
    const v = sessionStorage.getItem(SIDEBAR) === "1";
    sessionStorage.removeItem(SIDEBAR);
    return v;
  } catch {
    return false;
  }
}

/** How each page was last reached: from the sidebar / directly (true) or from a link on another page (false). */
function arrivals(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(ARRIVAL) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function setArrival(path: string, fromSidebar: boolean) {
  try {
    sessionStorage.setItem(ARRIVAL, JSON.stringify({ ...arrivals(), [path]: fromSidebar }));
  } catch {
    // Storage unavailable.
  }
}
/** Safety limit when stepping over same-page entries (tabs, filters, sorting, paging). */
const MAX_SKIPS = 30;

interface Pending {
  /** The page Back was pressed on. */
  from: string;
  /** The page before it (where Back must land). */
  to: string;
  skips: number;
}

function readPending(): Pending | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING) ?? "null") as Pending | null;
    return v && typeof v.from === "string" && typeof v.to === "string" ? v : null;
  } catch {
    return null;
  }
}

function writePending(p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(PENDING, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING);
  } catch {
    // Storage unavailable: Back stops after one step.
  }
}

/**
 * While a Back is in progress: still on the page Back was pressed on (an earlier tab, filter or page of it)?
 * Then keep going back; once on another page, the Back is done.
 */
function continueBack(pathname: string): boolean {
  const p = readPending();
  if (!p) return false;
  if (pathname === p.from && p.skips < MAX_SKIPS) {
    writePending({ ...p, skips: p.skips + 1 });
    window.history.back();
    return true;
  }
  writePending(null);
  return false;
}

/**
 * Back to the previous PAGE: earlier history entries that are the same page with other tabs, filters or
 * sorting are stepped over, so Back never seems to reopen the page the user is leaving.
 */
export function goBackToPreviousPage() {
  const stack = read();
  const from = stack.at(-1);
  const to = stack.at(-2);
  if (from && to) writePending({ from, to, skips: 0 });
  window.history.back();
}

/**
 * Call right before router.replace() to a parent page: that page takes the current page's place
 * in the stack instead of being added after it (so Back from the parent never returns here).
 */
export function markReplace() {
  try {
    sessionStorage.setItem(REPLACING, "1");
  } catch {
    // Storage unavailable: the parent is simply added.
  }
}

function takeReplacing(): boolean {
  try {
    const v = sessionStorage.getItem(REPLACING) === "1";
    sessionStorage.removeItem(REPLACING);
    return v;
  } catch {
    return false;
  }
}

function read(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-50)));
  } catch {
    // Storage unavailable: Back falls back to the parent page.
  }
}

/**
 * Whether the browser's previous history entry is another Claimix page, so Back can use real history
 * (which keeps the earlier page's search, filters, page and tab) instead of the parent-page fallback.
 *
 * Tracks the pages (pathnames) of this tab's in-app history: forward navigation pushes, browser
 * back/forward (popstate) moves within the stack. Changes that only touch the query string — tabs,
 * filters, sorting — stay part of the same page, so internal tabs never become a Back destination.
 * A fresh load (sign-in, a typed or shared URL) starts a new stack; a refresh keeps it.
 */
function sameOriginPath(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin === window.location.origin ? u.pathname : null;
  } catch {
    return null;
  }
}

export function useBackHistory(pathname: string): { canGoBack: boolean; previous: string | null; fromSidebar: boolean } {
  const [state, setState] = useState<{ canGoBack: boolean; previous: string | null; fromSidebar: boolean }>({ canGoBack: false, previous: null, fromSidebar: true });
  const traversal = useRef(false);
  const first = useRef(true);
  const current = useRef(pathname);

  useEffect(() => {
    const onPop = () => {
      const now = window.location.pathname;
      // Same page, other query (an earlier tab or filter): not a page change. Keep stepping back if a Back is running.
      if (now === current.current) {
        continueBack(now);
        return;
      }
      traversal.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    current.current = pathname;
    let stack = read();
    if (first.current) {
      first.current = false;
      takeReplacing(); // a leftover marker never applies to a fresh page load
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav?.type === "back_forward") {
        // A Back that crossed a full page load: continue it if this is still the page being left…
        if (continueBack(pathname)) return;
        // …or, having arrived on the page before it, step the stack back too.
        if (stack.at(-2) === pathname) stack = stack.slice(0, -1);
      }
      writePending(null);
      // A full load of the same page (refresh, Back/Forward, or a filter form submitted on it) keeps the stack.
      const samePageForm = nav?.type === "navigate" && sameOriginPath(document.referrer) === pathname;
      const kept = (nav?.type === "reload" || nav?.type === "back_forward" || samePageForm) && stack.at(-1) === pathname;
      if (!kept) {
        stack = [pathname];
        setArrival(pathname, true); // opened directly: a starting point
      }
      takeSidebar();
    } else if (traversal.current) {
      traversal.current = false;
      writePending(null); // landed on another page: any Back in progress is done
      if (stack.at(-2) === pathname) stack = stack.slice(0, -1); // browser Back (or our Back button)
      else if (stack.at(-1) !== pathname) stack = [...stack, pathname]; // browser Forward
    } else if (takeReplacing()) {
      stack = [...stack.slice(0, -1), pathname];
      setArrival(pathname, true);
      takeSidebar();
    } else if (stack.at(-1) !== pathname) {
      stack = [...stack, pathname];
      setArrival(pathname, takeSidebar());
    } else {
      takeSidebar();
    }
    write(stack);
    setState({ canGoBack: stack.length > 1, previous: stack.at(-2) ?? null, fromSidebar: arrivals()[pathname] ?? true });
  }, [pathname]);

  return state;
}
