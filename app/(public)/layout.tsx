import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { DISCLAIMER_TEXT } from "@/components/ui/Disclaimer";
import styles from "./public.module.css";

const NAV = [
  { href: "/insurance/private", label: "Private insurance" },
  { href: "/insurance/government", label: "Government schemes" },
  { href: "/cashless-vs-reimbursement", label: "Cashless vs reimbursement" },
  { href: "/network", label: "Hospital network" },
  { href: "/knowledge", label: "Knowledge Center" },
  { href: "/glossary", label: "Glossary" },
  { href: "/about", label: "About" },
];

/** Public website shell. The mobile menu is a <details> element, so it works without JavaScript. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand}>
            <LogoMark /> Claimix
          </Link>
          <nav aria-label="Main" className={styles.nav}>
            {NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
          </nav>
          <div className={styles.headerActions}>
            <Link href="/register" className={styles.textLink}>Request access</Link>
            <Link href="/login" className={styles.signIn}>Sign in</Link>
          </div>
          <details className={styles.mobileMenu}>
            <summary aria-label="Menu">☰</summary>
            <nav aria-label="Main (mobile)">
              {NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
              <Link href="/register">Request access</Link>
              <Link href="/login">Sign in</Link>
            </nav>
          </details>
        </div>
      </header>
      <main id="main" className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p className={styles.disclaimer}>{DISCLAIMER_TEXT}</p>
          <p className={styles.fine}>
            ABDM / ABHA are digital-health infrastructure, not insurance. Claimix has no official integration with any insurer, TPA, scheme or ABDM.
          </p>
        </div>
      </footer>
    </div>
  );
}
