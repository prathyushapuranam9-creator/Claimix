import { and, between, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { beneficiaries, notifications, patients, policies } from "@/db/schema";
import { NotificationService } from "./notifications.service";

const DAY = 86_400_000;

/**
 * Policy expiry reminders: for cover ending within `days`, notify the
 * registering hospital's staff and the patient. Idempotent — each coverage gets
 * at most one reminder per expiry date, however often the job runs.
 */
export async function sendPolicyExpiryReminders(db: DbOrTx, today: string, days = 30) {
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  const due = await db
    .select({ id: beneficiaries.id, coverEnd: beneficiaries.coverEnd, patientId: beneficiaries.patientId, hospitalId: patients.hospitalId, patientName: patients.fullName, policyName: policies.name })
    .from(beneficiaries)
    .innerJoin(patients, eq(patients.id, beneficiaries.patientId))
    .innerJoin(policies, eq(policies.id, beneficiaries.policyId))
    .where(and(
      between(beneficiaries.coverEnd, today, until),
      isNull(beneficiaries.deletedAt),
      isNull(patients.deletedAt),
      // Already reminded for this patient + policy + expiry date?
      sql`not exists (select 1 from ${notifications} n where n.kind = 'policy.expiring' and n.resource_id = ${beneficiaries.patientId}
          and n.title = 'Cover ending soon: ' || ${policies.name} and n.body like '%' || ${beneficiaries.coverEnd}::text || '%')`,
    ))
    .limit(500);

  for (const b of due) {
    const n = {
      kind: "policy.expiring",
      title: `Cover ending soon: ${b.policyName}`,
      // The expiry date in the body also serves as the idempotency key.
      body: `Cover for ${b.patientName} ends on ${b.coverEnd}. Renew before expiry to keep continuity benefits.`,
      resourceType: "patient",
      resourceId: b.patientId,
    };
    await NotificationService.toOrganizations(db, [b.hospitalId], n);
    await NotificationService.toPatient(db, b.patientId, { ...n, body: `Your cover ends on ${b.coverEnd}. Renew before expiry to keep continuity benefits.` });
  }
  return due.length;
}
