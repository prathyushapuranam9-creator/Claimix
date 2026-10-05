"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

/**
 * "Switch Context" control of the banner. On the dashboard the full switcher is already on the page, so it just
 * links there; on every other page it opens the same switcher in place, so the portal can be switched without leaving.
 */
export function BannerSwitch({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (pathname === "/dashboard" || !children) return <Link href="/dashboard#context">Switch Context</Link>;
  return (
    <>
      <Button size="sm" variant="secondary" aria-expanded={open} aria-controls="context" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide switcher" : "Switch Context"}
      </Button>
      {open && <div style={{ flexBasis: "100%" }}>{children}</div>}
    </>
  );
}
