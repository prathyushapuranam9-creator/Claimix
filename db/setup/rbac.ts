import { inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { PERMISSIONS, ROLES, type PermissionKey } from "@/lib/permissions/catalog";

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

  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, ROLES.map((r) => r.key)));
  return new Map(roleRows.map((r) => [r.key, r.id]));
}
