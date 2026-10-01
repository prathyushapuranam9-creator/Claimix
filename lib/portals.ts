import type { OrgType } from "@/lib/permissions/catalog";

/**
 * The three sign-in portals. A user's portal always comes from their account's
 * organization type (never from a page or from what was picked on the sign-in form):
 * hospital staff (and patients, who belong to a hospital) → Hospital Staff;
 * insurer and TPA reviewers → Insurer Reviewer; platform administrators → Administrator.
 * `label` is the portal name shown in the taskbar; `role` is the option on the sign-in form.
 */
export const PORTALS = {
  hospital: { label: "Hospital Staff", role: "Hospital Staff" },
  insurance: { label: "Insurer Reviewer", role: "Insurance Reviewer" },
  admin: { label: "Administrator", role: "Admin" },
} as const;

export type Portal = keyof typeof PORTALS;

export const PORTAL_KEYS = Object.keys(PORTALS) as Portal[];

export function portalFor(orgType: OrgType): Portal {
  switch (orgType) {
    case "hospital":
      return "hospital";
    case "insurer":
    case "tpa":
      return "insurance";
    default:
      return "admin";
  }
}

export function isPortal(v: unknown): v is Portal {
  return typeof v === "string" && v in PORTALS;
}
