"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import type { NavItem } from "@/lib/navigation";
import { BackButton } from "./BackButton";
import styles from "./AppShell.module.css";

/** Pages that already carry their own working "Back to …" control. */
const HAS_OWN_BACK = [/^\/policies\/[^/]+\/rules$/];

interface Props {
  nav: NavItem[];
  user: { fullName: string; roleName: string; orgName: string };
  logout: () => Promise<void>;
  /** Unread notifications for the signed-in user (null when the role has no inbox). */
  unread: number | null;
  children: ReactNode;
}

export function AppShell({ nav, user, logout, unread, children }: Props) {
  const pathname = usePathname();
  // The drawer remembers the path it was opened on, so navigating closes it.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (v: boolean) => setOpenedAt(v ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenedAt(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Becomes true after the first in-app route change, i.e. once there is app history to return to.
  const [hasHistory, setHasHistory] = useState(false);
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== firstPath.current) setHasHistory(true);
  }, [pathname]);

  const sections = [...new Set(nav.map((n) => n.section))];
  const current = nav.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  // Section landing pages are the roots; everything below them (detail, new, edit, …) gets a Back control.
  const showBack = pathname !== "/dashboard" && !nav.some((n) => n.href === pathname) && !HAS_OWN_BACK.some((r) => r.test(pathname));
  const backFallback = pathname.slice(0, pathname.lastIndexOf("/")) || "/dashboard";

  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">Skip to content</a>
      {open && <button className={styles.scrim} aria-label="Close menu" onClick={() => setOpen(false)} />}
      <aside id="app-sidebar" className={styles.sidebar} data-open={open} aria-label="Main navigation">
        <Link href="/dashboard" className={styles.brand}>
          <LogoMark /> Claimix
        </Link>
        <nav className={styles.nav}>
          {sections.map((s) => (
            <div key={s}>
              <p className={styles.section}>{s}</p>
              {nav.filter((n) => n.section === s).map((n) => (
                <Link key={n.href} href={n.href} className={styles.link} aria-current={current?.href === n.href ? "page" : undefined}>
                  <span className={styles.icon} aria-hidden="true">{n.icon}</span>
                  {n.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.user}>
          <p className={styles.userName}>{user.fullName}</p>
          <p className={styles.userMeta}>{user.roleName} · {user.orgName}</p>
          <form action={logout}>
            <button type="submit" className={styles.logout}>Sign out</button>
          </form>
        </div>
      </aside>
      <div className={styles.column}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="app-sidebar"
            onClick={() => setOpen(true)}
          >
            ☰
          </button>
          {showBack && <BackButton hasHistory={hasHistory} fallback={backFallback} />}
          <span className={styles.topTitle}>{current?.label ?? "Claimix"}</span>
          {unread !== null && (
            <Link href="/notifications" className={styles.bell} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {unread > 0 && <span className={styles.count}>{unread > 99 ? "99+" : unread}</span>}
            </Link>
          )}
        </header>
        <main id="main" className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
