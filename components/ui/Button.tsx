import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Common {
  variant?: Variant;
  size?: "md" | "sm";
  block?: boolean;
  children: ReactNode;
}

function cls(variant: Variant, size: "md" | "sm", block?: boolean, extra?: string) {
  return [styles.btn, styles[variant], size === "sm" && styles.sm, block && styles.block, extra].filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading,
  children,
  className,
  disabled,
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button className={cls(variant, size, block, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = "primary", size = "md", block, children }: Common & { href: string }) {
  return (
    <Link href={href} className={cls(variant, size, block)}>
      {children}
    </Link>
  );
}
