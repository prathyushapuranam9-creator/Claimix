"use client";

import { useEffect } from "react";

/**
 * Links such as "#insurance-documents" point inside the collapsed Policy Check block: when the URL's hash names an
 * element inside the <details> with this id, the block is opened and the element scrolled into view.
 */
export function OpenOnHash({ detailsId }: { detailsId: string }) {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const details = document.getElementById(detailsId);
      const target = document.getElementById(id);
      if (details instanceof HTMLDetailsElement && target && details.contains(target) && !details.open) {
        details.open = true;
        requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [detailsId]);
  return null;
}
