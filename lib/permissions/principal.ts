import { ForbiddenError } from "@/lib/errors";
import type { OrgType, PermissionKey, Scope } from "./catalog";

/** The authenticated caller, resolved server-side from the session on every request. */
export interface Principal {
  userId: string;
  organizationId: string;
  orgType: OrgType;
  roleKey: string;
  /** Set only for patient portal users: the single patient record they may see. */
  patientId: string | null;
  sessionId: string;
  permissions: ReadonlyMap<PermissionKey, Scope>;
  /**
   * Set only while an account that holds `insurance:context` is testing the insurance portal as an insurer / TPA
   * and role. Everything else on the principal is then that organization's and that role's (real authorization),
   * while `userId` stays the real signed-in account so changes and audit entries are traceable to it.
   */
  acting?: { organizationName: string; roleName: string; policyName?: string };
  /**
   * Set only while the insurance testing context is narrowed to one policy (Insurance Company + Policy on the
   * dashboard): every scoped query then also matches that policy. Never widens anything.
   */
  policyId?: string | null;
}

const RANK: Record<Scope, number> = { own: 1, organization: 2, all: 3 };

/** Returns the granted scope for a permission, or null when not granted. */
export function scopeFor(p: Principal, key: PermissionKey): Scope | null {
  return p.permissions.get(key) ?? null;
}

export function can(p: Principal, key: PermissionKey, atLeast: Scope = "own"): boolean {
  const s = scopeFor(p, key);
  return s !== null && RANK[s] >= RANK[atLeast];
}

/**
 * Administrative permissions whose services act on any tenant's records by id.
 * They are only honoured at "all" scope, so a role matrix edited in the database
 * can never turn them into a cross-organization write for a tenant user.
 */
export const GLOBAL_ONLY: ReadonlySet<PermissionKey> = new Set([
  "user:manage",
  "organization:manage",
  "hospital:manage",
  "insurer:manage",
  "policy:manage",
]);

/** Throws unless the permission is granted; otherwise returns the granted scope. */
export function requirePermission(p: Principal, key: PermissionKey): Scope {
  const s = scopeFor(p, key);
  if (!s) throw new ForbiddenError();
  if (GLOBAL_ONLY.has(key) && s !== "all") throw new ForbiddenError();
  return s;
}
