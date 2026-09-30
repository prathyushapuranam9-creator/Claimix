import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { claims } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { PERMISSIONS, ROLES, type PermissionKey, type Scope } from "@/lib/permissions/catalog";
import { can, requirePermission, type Principal } from "@/lib/permissions/principal";
import { scopePredicate } from "@/lib/permissions/scope";
import { clientIp } from "@/lib/security/client-ip";

const dialect = new PgDialect();
const render = (s: ReturnType<typeof scopePredicate>) => (s ? dialect.sqlToQuery(s) : undefined);

function principal(over: Partial<Principal> & { grants?: Partial<Record<PermissionKey, Scope>> } = {}): Principal {
  const { grants = {}, ...rest } = over;
  return {
    userId: "u1",
    organizationId: "org-h1",
    orgType: "hospital",
    roleKey: "hospital_staff",
    patientId: null,
    sessionId: "s1",
    permissions: new Map(Object.entries(grants) as [PermissionKey, Scope][]),
    ...rest,
  };
}

const cols = { hospitalId: claims.hospitalId, insurerId: claims.insurerId, tpaId: claims.tpaId, patientId: claims.patientId };

describe("role catalog", () => {
  it("only grants known permissions", () => {
    for (const r of ROLES) for (const k of Object.keys(r.grants)) expect(PERMISSIONS).toHaveProperty(k);
  });

  it("only platform roles hold 'all' scope on tenant data", () => {
    const tenantData: PermissionKey[] = ["patient:read", "claim:read", "preauth:read", "document:read", "audit:read"];
    for (const r of ROLES.filter((r) => r.orgType !== "platform")) {
      for (const k of tenantData) expect(r.grants[k], `${r.key} ${k}`).not.toBe("all");
    }
  });

  it("patients cannot write, review or administer anything", () => {
    const patient = ROLES.find((r) => r.key === "patient")!;
    for (const k of Object.keys(patient.grants)) expect(k).toMatch(/:(read|view)$/);
  });

  it("read-only users have no write permissions", () => {
    const ro = ROLES.find((r) => r.key === "read_only")!;
    for (const k of Object.keys(ro.grants)) expect(k).toMatch(/:(read|view)$/);
  });
});

describe("requirePermission / can", () => {
  it("denies missing permissions", () => {
    expect(() => requirePermission(principal(), "claim:review")).toThrow(ForbiddenError);
    expect(can(principal(), "claim:review")).toBe(false);
  });

  it("respects scope rank", () => {
    const p = principal({ grants: { "claim:read": "organization" } });
    expect(can(p, "claim:read", "organization")).toBe(true);
    expect(can(p, "claim:read", "all")).toBe(false);
  });
});

describe("scopePredicate", () => {
  it("hospital users are restricted to their own hospital", () => {
    const q = render(scopePredicate(principal(), "organization", cols))!;
    expect(q.sql).toContain('"hospital_id" = $1');
    expect(q.params).toEqual(["org-h1"]);
  });

  it("insurer users are restricted to their own insurer", () => {
    const q = render(scopePredicate(principal({ orgType: "insurer", organizationId: "org-i1" }), "organization", cols))!;
    expect(q.sql).toContain('"insurer_id" = $1');
    expect(q.params).toEqual(["org-i1"]);
  });

  it("TPA users are restricted to their own TPA", () => {
    const q = render(scopePredicate(principal({ orgType: "tpa", organizationId: "org-t1" }), "organization", cols))!;
    expect(q.sql).toContain('"tpa_id" = $1');
  });

  it("patients see only their own patient id", () => {
    const q = render(scopePredicate(principal({ roleKey: "patient", patientId: "p1" }), "own", cols))!;
    expect(q.sql).toContain('"patient_id" = $1');
    expect(q.params).toEqual(["p1"]);
  });

  it("fails closed: 'own' without a patient link matches nothing", () => {
    expect(render(scopePredicate(principal(), "own", cols))!.sql).toBe("false");
  });

  it("fails closed: resource lacking the tenant column matches nothing", () => {
    const q = render(scopePredicate(principal({ orgType: "insurer" }), "organization", { hospitalId: claims.hospitalId }))!;
    expect(q.sql).toBe("false");
  });

  it("'all' scope is refused for non-platform users (privilege escalation guard)", () => {
    expect(() => scopePredicate(principal(), "all", cols)).toThrow(ForbiddenError);
  });

  it("'all' scope for platform users applies no filter", () => {
    expect(scopePredicate(principal({ orgType: "platform" }), "all", cols)).toBeUndefined();
  });
});

describe("administrative permissions are platform-wide only", () => {
  const principal = (scope: "organization" | "all") => ({
    userId: "u", organizationId: "o", orgType: "insurer" as const, roleKey: "x", patientId: null, sessionId: "s",
    permissions: new Map([["policy:manage", scope], ["claim:read", scope]] as const),
  });
  it("refuses manage keys granted at organization scope (e.g. a mis-edited role matrix)", () => {
    expect(() => requirePermission(principal("organization"), "policy:manage")).toThrow(ForbiddenError);
    expect(requirePermission(principal("organization"), "claim:read")).toBe("organization");
  });
  it("honours them at all scope", () => {
    expect(requirePermission(principal("all"), "policy:manage")).toBe("all");
  });
});

describe("client IP from X-Forwarded-For", () => {
  it("trusts only proxy-appended entries", () => {
    expect(clientIp("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9, 10.0.0.2", 2)).toBe("203.0.113.9");
    expect(clientIp("203.0.113.9", 0)).toBeNull();
    expect(clientIp(null, 1)).toBeNull();
    expect(clientIp("not an ip", 1)).toBeNull();
    expect(clientIp("203.0.113.9", 3)).toBeNull();
  });
});
