import type { PermissionKey } from "@/lib/permissions/catalog";
import { can, type Principal } from "@/lib/permissions/principal";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: PermissionKey;
  section: "Workspace" | "Reference" | "Administration";
  /** Reachable by link (dashboard, header) but not listed in the sidebar. */
  hidden?: boolean;
  /** Header title when it should differ from the sidebar label. */
  title?: string;
}

/**
 * Sidebar entries. Visibility is UX only — every page and action re-checks
 * permissions on the server. Entries are added as each module ships.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", permission: "dashboard:view", section: "Workspace" },
  { href: "/patients", label: "Patients", icon: "☺", permission: "patient:read", section: "Workspace" },
  { href: "/eligibility", label: "Eligibility checker", icon: "✓", permission: "eligibility:check", section: "Workspace", hidden: true },
  { href: "/pre-authorizations", label: "Pre-authorizations", title: "Pre-Authorization", icon: "⎘", permission: "preauth:read", section: "Workspace", hidden: true },
  { href: "/claims", label: "Claims", icon: "₹", permission: "claim:read", section: "Workspace", hidden: true },
  { href: "/documents", label: "Documents", icon: "❐", permission: "document:read", section: "Workspace" },
  { href: "/assistant", label: "Insurance Assistant", icon: "✦", permission: "assistant:use", section: "Workspace" },
  { href: "/notifications", label: "Notifications", icon: "◔", permission: "notification:read", section: "Workspace", hidden: true },
  { href: "/reports", label: "Reports", icon: "▥", permission: "report:view", section: "Workspace" },
  { href: "/policies", label: "Insurers / Providers", icon: "❏", permission: "policy:read", section: "Reference" },
  { href: "/schemes", label: "Government schemes", icon: "⚑", permission: "policy:read", section: "Reference" },
  { href: "/rejection-reasons", label: "Query & rejection reasons", icon: "?", permission: "policy:read", section: "Reference" },
  { href: "/hospitals", label: "Hospitals & network", icon: "✚", permission: "hospital:read", section: "Reference" },
  { href: "/insurers", label: "Insurance companies", icon: "◈", permission: "insurer:read", section: "Reference" },
  { href: "/tpas", label: "TPAs", icon: "⇄", permission: "insurer:read", section: "Reference" },
  { href: "/knowledge", label: "Knowledge Center", icon: "✎", permission: "dashboard:view", section: "Reference" },
  { href: "/profile", label: "Profile Settings", icon: "☺", permission: "dashboard:view", section: "Workspace", hidden: true },
  { href: "/admin/users", label: "Users", icon: "⚙", permission: "user:manage", section: "Administration" },
  { href: "/admin/medical-codes", label: "Medical codes", icon: "⚕", permission: "policy:manage", section: "Administration" },
  { href: "/admin/access-requests", label: "Access requests", icon: "✉", permission: "user:manage", section: "Administration" },
  { href: "/audit", label: "Audit log", icon: "☰", permission: "audit:read", section: "Administration" },
];

/** Admins, hospital staff and payers have a dashboard; patient and read-only users do not. */
export function hasDashboard(p: Principal): boolean {
  return !p.patientId && (can(p, "preauth:read") || can(p, "claim:read"));
}

/** Where users without a dashboard land after signing in. */
export function landingPath(p: Principal): string {
  if (hasDashboard(p)) return "/dashboard";
  return p.patientId ? "/patients" : "/hospitals";
}

/** Insurer Reviewer portal (insurer or TPA users): "Policies" is called "Insurer/Provider". */
export const PAYER_POLICIES_LABEL = "Insurer/Provider";

export function isPayerPortal(p: Pick<Principal, "orgType">): boolean {
  return p.orgType === "insurer" || p.orgType === "tpa";
}

export function visibleNav(p: Principal): NavItem[] {
  return NAV_ITEMS.filter((i) => p.permissions.has(i.permission) && (i.href !== "/dashboard" || hasDashboard(p))).map((i) =>
    i.href === "/policies" && isPayerPortal(p) ? { ...i, label: PAYER_POLICIES_LABEL, title: PAYER_POLICIES_LABEL } : i,
  );
}
