import { eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { permissions, rolePermissions, roles, users } from "@/db/schema";
import { MERGED_PAYER_ROLE_KEYS, PERMISSIONS, ROLES, type PermissionKey } from "@/lib/permissions/catalog";

/** Syncs the permission catalog and default role grants into the database (idempotent). */
export async function seedRbac(db: DbOrTx) {
  await db
    .insert(permissions)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoUpdate({ target: permissions.key, set: { description: sql`excluded.description` } });

  const permRows = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
  const permId = new Map(permRows.map((p) => [p.key, p.id]));

  for (const r of ROLES) {
    const [role] = await db
      .insert(roles)
      .values({ key: r.key, name: r.name, orgType: r.orgType, description: r.description })
      .onConflictDoUpdate({ target: roles.key, set: { name: r.name, orgType: r.orgType, description: r.description } })
      .returning({ id: roles.id });
    const grants = Object.entries(r.grants) as [PermissionKey, "own" | "organization" | "all"][];
    // Adds missing default grants; never removes or overrides grants an admin changed.
    if (grants.length) {
      await db
        .insert(rolePermissions)
        .values(grants.map(([k, scope]) => ({ roleId: role!.id, permissionId: permId.get(k)!, scope })))
        .onConflictDoNothing();
    }
  }

  // Insurer and TPA reviewers were merged into one role: move existing users across, then drop the old roles.
  const legacy = await db.select({ id: roles.id }).from(roles).where(inArray(roles.key, [...MERGED_PAYER_ROLE_KEYS]));
  if (legacy.length) {
    const [payer] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "payer_reviewer"));
    await db.update(users).set({ roleId: payer!.id }).where(inArray(users.roleId, legacy.map((l) => l.id)));
    await db.delete(roles).where(inArray(roles.id, legacy.map((l) => l.id)));
  }

  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, ROLES.map((r) => r.key)));
  return new Map(roleRows.map((r) => [r.key, r.id]));
}
