"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import type { NavItem } from "@/lib/navigation";
import { BackButton } from "./BackButton";
import { markSidebarNav, useBackHistory } from "./useBackHistory";
import styles from "./AppShell.module.css";

/** Pages that already carry their own working "Back to …" control. */
const HAS_OWN_BACK = [/^\/policies\/[^/]+\/rules$/];

interface Props {
  nav: NavItem[];
  /** Portal name for the taskbar, derived from the signed-in account (e.g. "Hospital Staff"). */
  portal: string;
  /** Portal key ("hospital" | "insurance" | "admin"), for portal-specific layout behaviour. */
  portalKey: string;
  user: { fullName: string; email: string; roleName: string; orgName: string };
  logout: () => Promise<void>;
  /** Unread notifications for the signed-in user (null when the role has no inbox). */
  unread: number | null;
  children: ReactNode;
}

export function AppShell({ nav, portal, portalKey, user, logout, unread, children }: Props) {
  const pathname = usePathname();
  // The drawer remembers the path it was opened on, so navigating closes it.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (v: boolean) => setOpenedAt(v ? pathname : null);
  const [collapsed, setCollapsed] = useState(false);
  // Same pattern for the profile menu: it closes when the route changes.
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const menuOpen = menuAt === pathname;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenedAt(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuAt(null);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const sidebarNav = nav.filter((n) => !n.hidden);
  const sections = [...new Set(sidebarNav.map((n) => n.section))];
  const current = nav.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  const titleOf = (n?: NavItem) => n?.title ?? n?.label ?? "Claimix";

  // Remember which section the user came from, so pages reached by links (not the sidebar) can show the path.
  // A direct load has no previous section; moving within a section (list -> detail) keeps the earlier one.
  const [trail, setTrail] = useState<{ href?: string; from?: NavItem }>({ href: current?.href });
  if (current?.href !== trail.href) {
    const prev = nav.find((n) => n.href === trail.href);
    setTrail({ href: current?.href, from: prev });
  }
  const crumb = current?.hidden && trail.from && trail.from.href !== current.href ? trail.from : undefined;

  // True only when the previous history entry is another Claimix page (not a tab of this one, not outside the app).
  const { canGoBack: hasHistory, fromSidebar } = useBackHistory(pathname);

  // Sidebar landing pages are the roots; everything else (detail, new, edit, and pages reached only by links) gets a Back control.
  const isRoot = (path: string) => path === "/dashboard" || nav.some((n) => n.href === path && !n.hidden);
  // Detail, new and edit pages always get Back. A top-level page gets it only when it was opened by a link on another
  // page (a card, pill or button, e.g. "View network hospitals"), never from the sidebar or a direct visit.
  const showBack = !HAS_OWN_BACK.some((r) => r.test(pathname)) && (!isRoot(pathname) || (hasHistory && !fromSidebar));
  const backFallback = pathname.slice(0, pathname.lastIndexOf("/")) || "/dashboard";

  return (
    <div className={styles.shell} data-collapsed={collapsed} data-portal={portalKey}>
      <a href="#main" className="skip-link">Skip to content</a>
      {open && <button className={styles.scrim} aria-label="Close menu" onClick={() => setOpen(false)} />}
      <aside id="app-sidebar" className={styles.sidebar} data-open={open} aria-label="Main navigation">
        <Link href="/dashboard" className={styles.brand} onClick={() => pathname !== "/dashboard" && markSidebarNav()}>
          <LogoMark /> <span className={styles.label}>Claimix</span>
        </Link>
        <nav className={styles.nav}>
          {sections.map((s) => (
            <div key={s}>
              <p className={styles.section}>{s}</p>
              {sidebarNav.filter((n) => n.section === s).map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={styles.link}
                  onClick={() => pathname !== n.href && markSidebarNav()}
                  title={collapsed ? n.label : undefined}
                  aria-label={collapsed ? n.label : undefined}
                  aria-current={current?.href === n.href ? "page" : undefined}
                >
                  <span className={styles.icon} aria-hidden="true">{n.icon}</span>
                  <span className={styles.label}>{n.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.user}>
          <p className={styles.userName}>{user.fullName}</p>
          <p className={styles.userMeta}>{user.roleName} · {user.orgName}</p>
          <button
            type="button"
            className={styles.collapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((v) => !v)}
          >
            <svg className={styles.chevron} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
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
          {/* The taskbar shows only the portal; Back and the section name sit just below it. */}
          <span className={styles.topTitle}>{portal}</span>
          <div className={styles.themeSlot}><ThemeToggle /></div>
          {unread !== null && (
            <span className={styles.bellWrap}>
              <Link href="/notifications" className={styles.bell} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unread > 0 && <span className={styles.count}>{unread > 99 ? "99+" : unread}</span>}
              </Link>
              {/* Hover hint; the link's own label already gives screen readers "Notifications". */}
              <span className={styles.bellTip} aria-hidden="true">Notifications</span>
            </span>
          )}
          {/* Signed-in user: icon with their name below; hover shows name + role; click shows their details. All values come from the session. */}
          <div className={styles.profile} ref={menuRef}>
            <button
              type="button"
              className={styles.profileBtn}
              aria-label={`Profile menu: ${user.fullName}`}
              aria-describedby={menuOpen ? undefined : "profile-tip"}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="profile-panel"
              onClick={() => setMenuAt(menuOpen ? null : pathname)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
              <span className={styles.profileName} aria-hidden="true">{user.fullName}</span>
            </button>
            {!menuOpen && (
              <span id="profile-tip" role="tooltip" className={styles.profileTip}>
                <strong>{user.fullName}</strong>
                <span>{user.roleName}</span>
              </span>
            )}
            {menuOpen && (
              <div id="profile-panel" className={styles.menu} role="dialog" aria-label="Your profile">
                {/* Only the signed-in person's name and role, then the two account actions. */}
                <div className={styles.profileCard}>
                  <p className={styles.profileCardName}>{user.fullName}</p>
                  <p className={styles.profileCardRole}>{user.roleName}</p>
                </div>
                <div role="menu" aria-label="Account" className={styles.menuSep}>
                  <Link href="/profile" role="menuitem" className={styles.menuItem}>Profile Settings</Link>
                  <form action={logout}>
                    <button type="submit" role="menuitem" className={styles.menuItem}>Sign Out</button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </header>
        {/* Below the taskbar: Back (to the page the user actually came from) + the current section. */}
        <div className={styles.pagebar}>
          {showBack && <BackButton hasHistory={hasHistory} fallback={backFallback} />}
          <nav aria-label="Current section" className={styles.sectionName}>
            {crumb && (
              <>
                <Link href={crumb.href}>{titleOf(crumb)}</Link>
                <span aria-hidden="true" className={styles.sep}>›</span>
              </>
            )}
            <span aria-current="page">{titleOf(current)}</span>
          </nav>
        </div>
        <main id="main" className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
