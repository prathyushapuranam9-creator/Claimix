import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { organizations, roles, users } from "@/db/schema";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import { andAll } from "@/lib/permissions/scope";

/** Never selects password hashes out of this repository. */
const safeColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  isActive: users.isActive,
  isDemo: users.isDemo,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  roleId: users.roleId,
  roleKey: roles.key,
  roleName: roles.name,
  organizationId: users.organizationId,
  orgName: organizations.name,
  orgType: organizations.type,
};

export const UserRepository = {
  async list(db: DbOrTx, q: ListQuery, f: { organizationId?: string; roleKey?: string }) {
    const where = andAll(
      isNull(users.deletedAt),
      q.q ? or(ilike(users.fullName, likeContains(q.q)), ilike(users.email, likeContains(q.q))) : undefined,
      f.organizationId ? eq(users.organizationId, f.organizationId) : undefined,
      f.roleKey ? eq(roles.key, f.roleKey) : undefined,
    );
    const from = () =>
      db.select(safeColumns).from(users).innerJoin(roles, eq(roles.id, users.roleId)).innerJoin(organizations, eq(organizations.id, users.organizationId));
    const [rows, [total]] = await Promise.all([
      from().where(where).orderBy(desc(users.createdAt)).limit(q.pageSize).offset(offsetOf(q)),
      db.select({ n: count() }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db
      .select(safeColumns)
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row;
  },

  async emailTaken(db: DbOrTx, email: string) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return !!row;
  },

  async insert(db: DbOrTx, values: typeof users.$inferInsert) {
    const [row] = await db.insert(users).values(values).returning({ id: users.id });
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<Pick<typeof users.$inferInsert, "fullName" | "email" | "roleId" | "isActive">>) {
    await db.update(users).set(values).where(eq(users.id, id));
  },

  async roles(db: DbOrTx) {
    return db.select({ id: roles.id, key: roles.key, name: roles.name, orgType: roles.orgType }).from(roles).orderBy(asc(roles.name));
  },

  async role(db: DbOrTx, id: string) {
    const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    return row;
  },
};
