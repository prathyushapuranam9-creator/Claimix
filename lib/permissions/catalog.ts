/**
 * Source of truth for permissions and the default role matrix. `db:seed` writes
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
    description: "Registers patients, checks eligibility, raises pre-auths and claims for their own hospital.",
    grants: {
      "dashboard:view": "organization",
      "patient:read": "organization",
      "patient:write": "organization",
      "hospital:read": "all",
      "insurer:read": "all",
      "policy:read": "all",
      "eligibility:check": "organization",
      "preauth:read": "organization",
      "preauth:create": "organization",
      "claim:read": "organization",
      "claim:create": "organization",
      "document:read": "organization",
      "document:upload": "organization",
      "notification:read": "own",
      "assistant:use": "organization",
      "assistant:review": "organization",
      "report:view": "organization",
    },
  },
  {
    key: "insurer_reviewer",
    name: "Insurer Reviewer",
    orgType: "insurer",
    description: "Reviews pre-auths and claims assigned to their insurer.",
    grants: {
      "dashboard:view": "organization",
      "patient:read": "organization",
      "hospital:read": "all",
      "insurer:read": "all",
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
    key: "tpa_reviewer",
    name: "TPA Reviewer",
    orgType: "tpa",
    description: "Reviews pre-auths and claims assigned to their TPA.",
    grants: {
      "dashboard:view": "organization",
      "patient:read": "organization",
      "hospital:read": "all",
      "insurer:read": "all",
      "policy:read": "all",
      "preauth:read": "organization",
      "preauth:review": "organization",
      "claim:read": "organization",
      "claim:review": "organization",
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
