import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Button, ButtonLink } from "./Button";
import { TextField } from "./Field";
import { EmptyState } from "./Surface";
import { RemountOnUrlChange } from "./RemountOnUrlChange";
import styles from "./DataTable.module.css";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  nowrap?: boolean;
}

/** Accessible, horizontally scrollable table. Rendering only — data comes pre-scoped from services. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing to show yet" />}</>;
  return (
    <div className={styles.scroller} role="region" aria-label={caption} tabIndex={0}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.align === "right" ? styles.right : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} className={[c.align === "right" && styles.right, c.nowrap && styles.nowrap].filter(Boolean).join(" ") || undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Primary cell: a link with an optional secondary line. */
export function CellLink({ href, children, sub }: { href: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <Link href={href} className={styles.primary}>{children}</Link>
      {sub && <span className={styles.sub}>{sub}</span>}
    </>
  );
}

export function CellText({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <>
      {children}
      {sub && <span className={styles.sub}>{sub}</span>}
    </>
  );
}

/** Link-based pagination that preserves the current filters. */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={styles.pager} aria-label="Pagination">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className={styles.pagerLinks}>
        <Link className={styles.pageLink} href={href(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}>
          ← Prev
        </Link>
        <span className={styles.pageLink} aria-current="page">
          {page} / {pages}
        </span>
        <Link className={styles.pageLink} href={href(page + 1)} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined}>
          Next →
        </Link>
      </div>
    </nav>
  );
}

/** GET filter form: works without JavaScript and keeps filters shareable in the URL. */
export function FilterBar({
  basePath,
  q,
  searchLabel = "Search",
  searchPlaceholder,
  children,
  more,
  moreActive = 0,
  searchIcon = false,
}: {
  basePath: string;
  q?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  children?: ReactNode;
  /** Secondary filters, collapsed behind "More filters" (opened when any is active). */
  more?: ReactNode;
  moreActive?: number;
  /** Show a magnifier inside the search field. */
  searchIcon?: boolean;
}) {
  const form = (
    <form className={styles.filters} method="get" action={basePath} role="search">
      <div className={searchIcon ? `${styles.search} ${styles.searchWithIcon}` : styles.search}>
        <TextField label={searchLabel} name="q" type="search" defaultValue={q} placeholder={searchPlaceholder} maxLength={100} />
        {searchIcon && (
          <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        )}
      </div>
      {children}
      {more && (
        <details className={styles.more} open={moreActive > 0}>
          <summary>More filters{moreActive > 0 ? ` (${moreActive} active)` : ""}</summary>
          <div className={styles.moreGrid}>{more}</div>
        </details>
      )}
      <div className={styles.filterActions}>
        <Button type="submit">Apply</Button>
        <ButtonLink href={basePath} variant="ghost">Clear</ButtonLink>
      </div>
    </form>
  );
  // Clear (or any link to this list) must show every field as the new address says, not the old selections.
  return (
    <Suspense fallback={form}>
      <RemountOnUrlChange>{form}</RemountOnUrlChange>
    </Suspense>
  );
}
