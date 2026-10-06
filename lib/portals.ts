import type { OrgType } from "@/lib/permissions/catalog";

/**
 * The three portals. A user's portal always comes from their account's organization type (nobody picks one at
 * sign-in; the account's credentials decide): hospital staff (and patients, who belong to a hospital) → Hospital Staff;
 * insurer and TPA reviewers → Insurer Reviewer; platform administrators → Administrator.
 * `label` is the portal name shown in the taskbar.
 */
export const PORTALS = {
  hospital: { label: "Hospital Staff" },
  insurance: { label: "Insurer Reviewer" },
  admin: { label: "Administrator" },
} as const;

export type Portal = keyof typeof PORTALS;

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

