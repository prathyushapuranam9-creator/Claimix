import { and, eq, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { ForbiddenError } from "@/lib/errors";
import type { Principal } from "./principal";
import type { Scope } from "./catalog";

/** A tenant link: a column holding the org/patient id, or a builder for an indirect link (e.g. EXISTS subquery). */
export type ScopeRef = AnyColumn | ((id: string) => SQL);

/**
 * How a resource is tied to each kind of tenant. Each repository declares its
 * links; the predicate is then built in exactly one place so a scope cannot be
 * forgotten per-query.
 */
export interface ScopeColumns {
  hospitalId?: ScopeRef;
  insurerId?: ScopeRef;
  tpaId?: ScopeRef;
  patientId?: ScopeRef;
  /** How rows tie to a policy, used when the principal is narrowed to one policy (see Principal.policyId). */
  policyId?: ScopeRef;
}

const NOTHING: SQL = sql`false`;

function match(ref: ScopeRef | undefined, id: string): SQL {
  if (!ref) return NOTHING;
  return typeof ref === "function" ? ref(id) : eq(ref, id);
}

/**
 * SQL predicate restricting rows to what `principal` may see at `scope`.
 * Fails closed: an unknown org/scope combination matches no rows.
 */
export function scopePredicate(principal: Principal, scope: Scope, cols: ScopeColumns): SQL | undefined {
  const base = tenantPredicate(principal, scope, cols);
  // Narrowed to one policy: rows must also belong to it (a resource with no policy link matches nothing).
  return principal.policyId ? andAll(base ?? undefined, match(cols.policyId, principal.policyId)) : base;
}

function tenantPredicate(principal: Principal, scope: Scope, cols: ScopeColumns): SQL | undefined {
  if (scope === "all") {
    // Only platform users may hold "all"; anyone else with it is a misconfiguration.
    if (principal.orgType !== "platform") throw new ForbiddenError();
    return undefined;
  }
  if (scope === "own") {
    return principal.patientId ? match(cols.patientId, principal.patientId) : NOTHING;
  }
  switch (principal.orgType) {
    case "hospital":
      return match(cols.hospitalId, principal.organizationId);
    case "insurer":
      return match(cols.insurerId, principal.organizationId);
    case "tpa":
      return match(cols.tpaId, principal.organizationId);
    default:
      return NOTHING;
  }
}

export function andAll(...parts: (SQL | undefined)[]): SQL | undefined {
  const defined = parts.filter((p): p is SQL => p !== undefined);
  return defined.length ? and(...defined) : undefined;
}
