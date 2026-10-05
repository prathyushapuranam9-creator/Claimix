"use client";

import { useRouter } from "next/navigation";
import styles from "./BackButton.module.css";

interface Props {
  /** Where to go when the user landed here directly (no in-app history to return to). */
  fallback: string;
  /** True once the user has navigated within the app, so history.back() stays inside it. */
  hasHistory: boolean;
}

/**
 * Returns to the page the user actually came from. history.back() restores the previous URL
 * (filters, search and tab live in the query string) and the browser/Next restore its scroll position.
 */
export function BackButton({ fallback, hasHistory }: Props) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={styles.back}
      aria-label="Back"
      data-tip="Back"
      onClick={() => (hasHistory ? router.back() : router.push(fallback))}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
    </button>
  );
}
