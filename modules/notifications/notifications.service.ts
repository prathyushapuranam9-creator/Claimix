import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { notifications, organizations, patients, users } from "@/db/schema";

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
}

/**
 * Creates in-app notifications inside the caller's transaction, so they exist
 * only if the change they describe commits. Bodies must not contain clinical detail.
 */
export const NotificationService = {
  async toOrganizations(db: DbOrTx, orgIds: (string | null | undefined)[], n: NotificationInput, exceptUserId?: string) {
    const ids = [...new Set(orgIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    const recipients = await db
      .select({ id: users.id, organizationId: users.organizationId })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(and(inArray(users.organizationId, ids), eq(users.isActive, true), isNull(users.deletedAt), eq(organizations.isActive, true)));
    // Patient portal users belong to hospital orgs but must only get their own notifications.
    const staff = await filterOutPatients(db, recipients);
    const rows = staff.filter((u) => u.id !== exceptUserId).map((u) => ({ userId: u.id, organizationId: u.organizationId, ...n }));
    if (rows.length) await db.insert(notifications).values(rows);
  },

  async toPatient(db: DbOrTx, patientId: string, n: NotificationInput) {
    const [p] = await db.select({ userId: patients.userId, hospitalId: patients.hospitalId }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (p?.userId) await db.insert(notifications).values({ userId: p.userId, organizationId: p.hospitalId, ...n });
  },
};

async function filterOutPatients(db: DbOrTx, list: { id: string; organizationId: string }[]) {
  if (!list.length) return list;
  const portal = await db.select({ userId: patients.userId }).from(patients).where(inArray(patients.userId, list.map((u) => u.id)));
  const exclude = new Set(portal.map((p) => p.userId));
  return list.filter((u) => !exclude.has(u.id));
}
