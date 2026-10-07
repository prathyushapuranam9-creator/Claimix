"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "claimix.backStack";
const REPLACING = "claimix.backReplacing";

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
export function useBackHistory(pathname: string): boolean {
  const [canGoBack, setCanGoBack] = useState(false);
  const traversal = useRef(false);
  const first = useRef(true);

  useEffect(() => {
    const onPop = () => {
      traversal.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let stack = read();
    if (first.current) {
      first.current = false;
      takeReplacing(); // a leftover marker never applies to a fresh page load
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const kept = (nav?.type === "reload" || nav?.type === "back_forward") && stack.at(-1) === pathname;
      if (!kept) stack = [pathname];
    } else if (traversal.current) {
      traversal.current = false;
      if (stack.at(-2) === pathname) stack = stack.slice(0, -1); // browser Back (or our Back button)
      else if (stack.at(-1) !== pathname) stack = [...stack, pathname]; // browser Forward
    } else if (takeReplacing()) {
      stack = [...stack.slice(0, -1), pathname];
    } else if (stack.at(-1) !== pathname) {
      stack = [...stack, pathname];
    }
    write(stack);
    setCanGoBack(stack.length > 1);
  }, [pathname]);

  return canGoBack;
}
