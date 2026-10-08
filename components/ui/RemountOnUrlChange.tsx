"use client";

import { useSearchParams } from "next/navigation";
import { Fragment, type ReactNode } from "react";

/**
 * Rebuilds its children whenever the query string changes. Filter forms use uncontrolled fields
 * (defaultValue), which a browser keeps as they were after an in-app navigation to the same page
 * (e.g. Clear → the unfiltered list). Remounting renders every field from the new address instead.
 */
export function RemountOnUrlChange({ children }: { children: ReactNode }) {
  const key = useSearchParams().toString();
  return <Fragment key={key}>{children}</Fragment>;
}
