import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { roleFitsOrg } from "@/lib/permissions/catalog";
import { hashPassword, randomToken } from "@/lib/security/crypto";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { AuthRepository } from "@/modules/auth/auth.repository";
import { issuePasswordSetup } from "@/modules/auth/password-setup";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { UserRepository } from "./users.repository";
import { userCreateSchema, userUpdateSchema } from "./users.validation";

/** Patient portal accounts are created from a patient record, never from generic user admin. */
const NON_ASSIGNABLE_ROLES = new Set(["patient"]);

export const UserService = {
  async list(ctx: ServiceContext, q: ListQuery, f: { organizationId?: string; roleKey?: string }) {
    requirePermission(ctx.principal, "user:manage");
    return UserRepository.list(ctx.db, q, f);
  },

  async get(ctx: ServiceContext, id: string) {
    requirePermission(ctx.principal, "user:manage");
    const row = await UserRepository.get(ctx.db, requireId(id, "User"));
    if (!row) throw new NotFoundError("User not found.");
    return row;
  },

  async formOptions(ctx: ServiceContext) {
    requirePermission(ctx.principal, "user:manage");
    const [roles, orgs] = await Promise.all([UserRepository.roles(ctx.db), OrganizationRepository.options(ctx.db)]);
    return { roles: roles.filter((r) => !NON_ASSIGNABLE_ROLES.has(r.key)), orgs };
  },

  /**
   * Creates an account with an unusable random password and emails a one-time
   * setup link. Admins never see or choose other users' passwords.
   */
  async create(ctx: ServiceContext, input: unknown, appUrl: string) {
    requirePermission(ctx.principal, "user:manage");
    const d = parseOrThrow(userCreateSchema, input);
    const [role, org] = await Promise.all([UserRepository.role(ctx.db, d.roleId), OrganizationRepository.get(ctx.db, d.organizationId)]);
    if (!role || NON_ASSIGNABLE_ROLES.has(role.key)) throw new ValidationError("Select a valid role.", { roleId: ["Select a valid role."] });
    if (!org) throw new ValidationError("Select a valid organization.", { organizationId: ["Select a valid organization."] });
    if (!roleFitsOrg(role, org.type)) {
      throw new ValidationError(`The ${role.name} role can only be given to users of a ${role.orgType} organization.`, {
        roleId: [`This role requires a ${role.orgType} organization.`],
      });
    }
    const passwordHash = await hashPassword(randomToken(32));
    return ctx.db.transaction(async (tx) => {
      if (await UserRepository.emailTaken(tx, d.email)) throw new ConflictError("A user with this email already exists.");
      const { id } = await UserRepository.insert(tx, { email: d.email, fullName: d.fullName, roleId: role.id, organizationId: org.id, passwordHash });
      await issuePasswordSetup(tx, id, appUrl, "invite");
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "user.created",
        resourceType: "user",
        resourceId: id,
        newState: { email: d.email, fullName: d.fullName, role: role.key, organizationId: org.id },
      });
      return { id };
    });
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    requirePermission(ctx.principal, "user:manage");
    const d = parseOrThrow(userUpdateSchema, input);
    return ctx.db.transaction(async (tx) => {
      const before = await UserRepository.get(tx, requireId(id, "User"));
      if (!before) throw new NotFoundError("User not found.");
      const role = await UserRepository.role(tx, d.roleId);
      if (!role) throw new ValidationError("Select a valid role.", { roleId: ["Select a valid role."] });

      const roleChanged = role.id !== before.roleId;
      if (roleChanged && (NON_ASSIGNABLE_ROLES.has(role.key) || NON_ASSIGNABLE_ROLES.has(before.roleKey))) {
        throw new ValidationError("Patient portal roles can't be changed here.", { roleId: ["Patient roles are managed from the patient record."] });
      }
      if (!roleFitsOrg(role, before.orgType)) {
        throw new ValidationError(`The ${role.name} role requires a ${role.orgType} organization.`, { roleId: ["This role doesn't match the user's organization."] });
      }
      // Prevent admins locking themselves (and possibly everyone) out.
      if (id === ctx.principal.userId && (roleChanged || !d.isActive)) {
        throw new ValidationError("You can't change your own role or deactivate yourself.");
      }

      await UserRepository.update(tx, id, { fullName: d.fullName, roleId: role.id, isActive: d.isActive });
      if (roleChanged || (before.isActive && !d.isActive)) await AuthRepository.revokeAllForUser(tx, id);
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: roleChanged ? "user.role_changed" : "user.updated",
        resourceType: "user",
        resourceId: id,
        previousState: { fullName: before.fullName, role: before.roleKey, isActive: before.isActive },
        newState: { fullName: d.fullName, role: role.key, isActive: d.isActive },
      });
    });
  },

  async revokeSessions(ctx: ServiceContext, id: string) {
    requirePermission(ctx.principal, "user:manage");
    return ctx.db.transaction(async (tx) => {
      if (!(await UserRepository.get(tx, requireId(id, "User")))) throw new NotFoundError("User not found.");
      await AuthRepository.revokeAllForUser(tx, id);
      await AuditService.record(tx, { ...actorOf(ctx), action: "auth.sessions_revoked", resourceType: "user", resourceId: id });
    });
  },

  async resendInvite(ctx: ServiceContext, id: string, appUrl: string) {
    requirePermission(ctx.principal, "user:manage");
    return ctx.db.transaction(async (tx) => {
      const u = await UserRepository.get(tx, requireId(id, "User"));
      if (!u || !u.isActive) throw new NotFoundError("Active user not found.");
      await issuePasswordSetup(tx, id, appUrl, "invite");
      await AuditService.record(tx, { ...actorOf(ctx), action: "user.invite_sent", resourceType: "user", resourceId: id });
    });
  },
};
