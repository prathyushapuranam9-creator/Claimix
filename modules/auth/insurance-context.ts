import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { organizations, roles } from "@/db/schema";
import { roleFitsOrg } from "@/lib/permissions/catalog";
import { hmacHex, safeEqualHex } from "@/lib/security/crypto";

/** The permission that lets an account use the testing/demo insurance portal (held by the Administrator role only). */
export const INSURANCE_CONTEXT_PERMISSION = "insurance:context" as const;

type PayerType = "insurer" | "tpa";

/** What an account with that permission may choose: an insurer or TPA organization and a role of that organization. */
export interface ContextSelection {
  organizationId: string;
  roleKey: string;
}

export interface ContextOption {
  id: string;
  name: string;
  type: PayerType;
  roles: { key: string; name: string }[];
}

export interface ResolvedContext {
  organizationId: string;
  organizationName: string;
  orgType: PayerType;
  roleId: string;
  roleKey: string;
  roleName: string;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/**
 * Testing context for the insurance portal. The selection is kept in a signed cookie that is tied to ONE session
 * and re-validated against the database on every request, so it can never grant more than the chosen role holds,
 * can't be forged or reused from another session, and is ignored unless the real account still holds the permission.
 * Insurers, roles and their grants all come from the database; nothing here names an insurer or a role.
 */
export const InsuranceContext = {
  /** Every active insurer / TPA, each with the roles that exist for that kind of organization. */
  async options(db: DbOrTx): Promise<ContextOption[]> {
    const [orgs, allRoles] = await Promise.all([
      db
        .select({ id: organizations.id, name: organizations.name, type: organizations.type })
        .from(organizations)
        .where(and(isNull(organizations.deletedAt), eq(organizations.isActive, true)))
        .orderBy(asc(organizations.name)),
      db.select({ key: roles.key, name: roles.name, orgType: roles.orgType }).from(roles).orderBy(asc(roles.name)),
    ]);
    return orgs
      .filter((o): o is typeof o & { type: PayerType } => o.type === "insurer" || o.type === "tpa")
      .map((o) => ({ id: o.id, name: o.name, type: o.type, roles: allRoles.filter((r) => roleFitsOrg(r, o.type)).map((r) => ({ key: r.key, name: r.name })) }))
      .filter((o) => o.roles.length > 0);
  },

  /** Checks that the organization is an active insurer/TPA and the role fits it; returns what to act as, or null. */
  async resolve(db: DbOrTx, sel: ContextSelection): Promise<ResolvedContext | null> {
    if (!/^[0-9a-f-]{36}$/i.test(sel.organizationId) || !/^[a-z_]{1,50}$/.test(sel.roleKey)) return null;
    const [org] = await db
      .select({ id: organizations.id, name: organizations.name, type: organizations.type })
      .from(organizations)
      .where(and(eq(organizations.id, sel.organizationId), isNull(organizations.deletedAt), eq(organizations.isActive, true)))
      .limit(1);
    if (!org || (org.type !== "insurer" && org.type !== "tpa")) return null;
    const [role] = await db.select({ id: roles.id, key: roles.key, name: roles.name, orgType: roles.orgType }).from(roles).where(eq(roles.key, sel.roleKey)).limit(1);
    if (!role || !roleFitsOrg(role, org.type)) return null;
    return { organizationId: org.id, organizationName: org.name, orgType: org.type, roleId: role.id, roleKey: role.key, roleName: role.name };
  },

  /** Signed cookie value for this session and selection. */
  sign(secret: string, sessionId: string, sel: ContextSelection): string {
    const payload = b64(JSON.stringify({ s: sessionId, o: sel.organizationId, r: sel.roleKey }));
    return `${payload}.${hmacHex(payload, secret)}`;
  },

  /** The selection in a cookie value, only if the signature is ours and it belongs to this session. */
  verify(secret: string, token: string | null | undefined, sessionId: string): ContextSelection | null {
    if (!token || token.length > 600) return null;
    const [payload, sig] = token.split(".");
    if (!payload || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return null;
    if (!safeEqualHex(hmacHex(payload, secret), sig)) return null;
    try {
      const j = JSON.parse(unb64(payload)) as { s?: unknown; o?: unknown; r?: unknown };
      if (j.s !== sessionId || typeof j.o !== "string" || typeof j.r !== "string") return null;
      return { organizationId: j.o, roleKey: j.r };
    } catch {
      return null;
    }
  },
};
