import Link from "next/link";
import styles from "./Tabs.module.css";

/**
 * URL-driven tabs (?tab=…): server-rendered, shareable, work without JavaScript.
 * Rendered as navigation links with aria-current, which is the accessible pattern
 * for tabs that change the page. Tabs are sections of ONE page: switching replaces the
 * history entry, so Back (and the browser's Back) leave the page instead of stepping through tabs.
 */
export function LinkTabs({ basePath, tabs, current, label }: { basePath: string; tabs: { key: string; label: string }[]; current: string; label: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} href={`${basePath}?tab=${t.key}`} className={styles.tab} aria-current={t.key === current ? "page" : undefined} scroll={false} replace>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Segmented control for a small set of mutually exclusive views. */
export function Segmented({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <div className={styles.segmented} role="group">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={styles.segment} aria-current={i.key === current ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}
