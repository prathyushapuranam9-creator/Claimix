/**
 * Source of truth for permissions and the default role matrix. `db:setup` writes
 * this into the roles / permissions / role_permissions tables; at runtime the
 * database is what authorizes requests, so admins can adjust it without a deploy.
 */
export type Scope = "own" | "organization" | "all";
export type OrgType = "platform" | "hospital" | "insurer" | "tpa";

export const PERMISSIONS = {
  "dashboard:view": "View dashboard",
  "user:manage": "Create and manage users and roles",
  "organization:manage": "Manage organizations",
  "patient:read": "View patient records",
  "patient:write": "Register and edit patients",
  "hospital:read": "View hospitals and networks",
  "hospital:manage": "Manage hospitals and network status",
  "insurer:read": "View insurers and TPAs",
  "insurer:manage": "Manage insurers and TPAs",
  "policy:read": "View policies and rules",
  "policy:manage": "Manage policies and rule versions",
  "eligibility:check": "Run eligibility checks",
  "preauth:read": "View pre-authorizations",
  "preauth:create": "Create and submit pre-authorizations",
  "preauth:review": "Review pre-authorizations (payer)",
  "claim:read": "View claims",
  "claim:create": "Create and submit claims",
  "claim:review": "Review claims (payer)",
  "claim:settle": "Record settlements",
  "document:read": "Download documents",
  "document:upload": "Upload documents",
  "document:verify": "Verify or reject documents",
  "notification:read": "View own notifications",
  "assistant:use": "Use the Insurance Assistant",
  "assistant:review": "Answer questions sent to human review",
  "report:view": "View reports",
  "audit:read": "View audit logs",
  "insurance:context": "Test and demonstrate the insurance portal as any insurer and role",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export interface RoleDef {
  key: string;
  name: string;
  orgType: OrgType;
  description: string;
  grants: Partial<Record<PermissionKey, Scope>>;
}

export const ROLES: RoleDef[] = [
  {
    key: "admin",
    name: "Administrator",
    orgType: "platform",
    description: "Full platform access.",
    grants: Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, "all"])) as RoleDef["grants"],
  },
  {
    key: "hospital_staff",
    name: "Hospital Staff",
    orgType: "hospital",
    description: "Registers patients for OPD consultations and IP admissions at their own hospital.",
    /**
     * Front-desk registration only. The insurance side of Claimix (coverage, eligibility,
     * pre-authorizations, claims, their documents, the Insurance Assistant and the case reports) was
     * deliberately taken away from this role; `seedRbac` revokes those grants from existing databases.
     * Nothing else holds them on the hospital side, so pre-authorizations and claims cannot currently
     * be raised at all — see README "Hospital Staff".
     */
    grants: {
      "dashboard:view": "organization",
      "patient:read": "organization",
      "patient:write": "organization",
      "hospital:read": "all",
      "notification:read": "own",
    },
  },
  {
    key: "payer_reviewer",
    name: "Payer Reviewer",
    // Stored against the insurer type; see roleFitsOrg for the TPA organizations that may also hold it.
    orgType: "insurer",
    description: "Reviews pre-auths and claims assigned to their insurer or TPA, and verifies documents. Settlement is recorded by insurers only.",
    grants: {
      "dashboard:view": "organization",
      "patient:read": "organization",
      "hospital:read": "all",
      "insurer:read": "all",
      // Own products only (an insurer's, or those a TPA administers); also enforced in PolicyRepository.
      "policy:read": "organization",
      "preauth:read": "organization",
      "preauth:review": "organization",
      "claim:read": "organization",
      "claim:review": "organization",
      "claim:settle": "organization",
      "document:read": "organization",
      "document:verify": "organization",
      "notification:read": "own",
      "assistant:use": "organization",
      "assistant:review": "organization",
      "report:view": "organization",
    },
  },
  {
    key: "patient",
    name: "Patient",
    orgType: "hospital",
    description: "Sees only their own policy, pre-auth and claim information.",
    grants: {
      "dashboard:view": "own",
      "patient:read": "own",
      "policy:read": "own",
      "preauth:read": "own",
      "claim:read": "own",
      "document:read": "own",
      "notification:read": "own",
    },
  },
  {
    key: "read_only",
    name: "Read-only",
    orgType: "platform",
    description: "Can view reference information only.",
    grants: {
      "dashboard:view": "own",
      "hospital:read": "all",
      "insurer:read": "all",
      "policy:read": "all",
      "notification:read": "own",
    },
  },
];

/**
 * Grants Hospital Staff used to hold, before the role became front-desk registration only. Listed so
 * `seedRbac` can revoke them from databases seeded under the old matrix (runtime authorization comes
 * from the database, so removing them from the matrix above is not enough on its own).
 */
export const WITHDRAWN_HOSPITAL_STAFF_PERMISSIONS: PermissionKey[] = [
  "insurer:read",
  "policy:read",
  "eligibility:check",
  "preauth:read",
  "preauth:create",
  "claim:read",
  "claim:create",
  "document:read",
  "document:upload",
  "assistant:use",
  "assistant:review",
  "report:view",
];

/** Legacy role keys that were merged into `payer_reviewer`; setup moves their users across. */
export const MERGED_PAYER_ROLE_KEYS = ["insurer_reviewer", "tpa_reviewer"] as const;

/** Whether a role may be given to users of an organization type. Payer reviewers work in insurers and TPAs. */
export function roleFitsOrg(role: { key: string; orgType: OrgType | null }, orgType: OrgType): boolean {
  if (role.key === "payer_reviewer") return orgType === "insurer" || orgType === "tpa";
  return role.orgType === orgType;
}
