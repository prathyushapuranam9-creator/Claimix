import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, InvalidTransitionError } from "@/lib/errors";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/notifications/notifications.service";
import { HistoryRepository } from "./history.repository";

/**
 * Who is acting on a request:
 * - hospital: the treating hospital's insurance desk
 * - payer: the assigned insurer or TPA reviewer
 * - scheme_desk: hospital staff recording a government scheme's own decision
 */
export type Side = "hospital" | "payer" | "scheme_desk";

export interface WorkflowSubject {
  id: string;
  status: string;
  reference: string;
  hospitalId: string;
  insurerId: string | null;
  tpaId: string | null;
  patientId: string;
}

export interface WorkflowConfig<S extends string> {
  subjectType: "preauth" | "claim";
  noun: string;
  label: Record<S, string>;
  canTransition(from: S, to: S, side: Side): boolean;
  /** Optimistic update: must only succeed if the status is still `from`. */
  changeStatus(db: DbOrTx, id: string, from: S, values: Record<string, unknown> & { status: S }): Promise<unknown | undefined>;
}

export interface TransitionDetails {
  reason?: string | null;
  message?: string | null;
  requiredAction?: string | null;
  requiredDocuments?: string[];
  responsibleTeam: string;
}

/**
 * The single way a pre-authorization or claim changes status. Enforces the state
 * machine for the caller's side, applies an optimistic status check, and writes
 * the timeline entry, audit record and notifications in the caller's transaction.
 */
export async function applyTransition<S extends string, R>(
  tx: DbOrTx,
  ctx: Pick<ServiceContext, "principal" | "meta">,
  cfg: WorkflowConfig<S>,
  subject: WorkflowSubject,
  to: S,
  side: Side,
  h: TransitionDetails,
  extra: Record<string, unknown> = {},
): Promise<R> {
  const from = subject.status as S;
  if (!cfg.canTransition(from, to, side)) {
    throw new InvalidTransitionError(`A ${cfg.noun} that is "${cfg.label[from]}" can't be moved to "${cfg.label[to]}" by you.`);
  }
  const updated = await cfg.changeStatus(tx, subject.id, from, { ...extra, status: to });
  if (!updated) throw new ConflictError(`This ${cfg.noun} was changed by someone else. Reload and try again.`);

  await HistoryRepository.insert(tx, {
    subjectType: cfg.subjectType,
    subjectId: subject.id,
    fromStatus: from,
    toStatus: to,
    reason: h.reason ?? null,
    message: h.message ?? null,
    requiredAction: h.requiredAction ?? null,
    requiredDocuments: h.requiredDocuments ?? [],
    responsibleTeam: h.responsibleTeam,
    actorUserId: ctx.principal.userId,
  });
  await AuditService.record(tx, {
    ...actorOf(ctx),
    action: `${cfg.subjectType}.${to === "submitted" && from === "query" ? "resubmitted" : to}`,
    resourceType: cfg.subjectType,
    resourceId: subject.id,
    previousState: { status: from },
    newState: { status: to, side, reason: h.reason ?? null, ...pickAmounts(updated) },
  });

  const n = {
    kind: `${cfg.subjectType}.${to}`,
    title: `${cfg.noun[0]!.toUpperCase()}${cfg.noun.slice(1)} ${subject.reference}: ${cfg.label[to]}`,
    body: h.requiredAction ?? undefined,
    resourceType: cfg.subjectType,
    resourceId: subject.id,
  };
  // Hospital actions notify the payer; payer decisions notify the hospital and the patient.
  if (side === "hospital") {
    if (to !== "cancelled" || from !== "draft") await NotificationService.toOrganizations(tx, [subject.insurerId, subject.tpaId], n, ctx.principal.userId);
  } else {
    await NotificationService.toOrganizations(tx, [subject.hospitalId], n, ctx.principal.userId);
    await NotificationService.toPatient(tx, subject.patientId, n);
  }
  return updated as R;
}

function pickAmounts(row: unknown) {
  const r = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["approvedAmount", "claimedAmount", "patientAmount"]) if (k in r) out[k] = r[k];
  return out;
}
