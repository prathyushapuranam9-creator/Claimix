import "server-only";
import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission, scopeFor, type Principal } from "@/lib/permissions/principal";
import { randomToken } from "@/lib/security/crypto";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { DocumentRepository } from "@/modules/documents/documents.repository";
import { documentLabel } from "@/modules/documents/document-types";
import { applyTransition, type TransitionDetails, type WorkflowConfig } from "@/modules/workflow/transition";
import { CoverageRepository } from "@/modules/patients/coverage.repository";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import { ClaimRepository } from "@/modules/claims/claims.repository";
import { evaluateAndRecord, loadEvaluation } from "@/modules/rules/rules.service";
import { CHECKLIST, computePreauthChecklist } from "./preauth.checklist";
import { buildPreauthFacts } from "./preauth.facts";
import { PreauthRepository } from "./preauth.repository";
import {
  cancelSchema, CLINICAL_FIELDS, confirmItemSchema, decisionSchema, preauthCreateSchema, preauthDetailsSchema, queryResponseSchema, submitSchema,
} from "./preauth.validation";
import { allowedTransitions, canTransition, HOSPITAL_EDITABLE, PAYER_DECISIONS, STATUS_LABEL, type PreauthStatus, type Side } from "./preauth.workflow";

type Row = NonNullable<Awaited<ReturnType<typeof PreauthRepository.findScoped>>>;

const money = (n: number | undefined) => (n === undefined ? null : n.toFixed(2));

/** Which side of the workflow the caller acts on for this request (or null: read-only). */
export function sideOf(p: Principal, r: Row["preauth"]): Side | null {
  if (p.orgType === "insurer" && r.insurerId === p.organizationId && scopeFor(p, "preauth:review")) return "payer";
  if (p.orgType === "tpa" && r.tpaId === p.organizationId && scopeFor(p, "preauth:review")) return "payer";
  if (p.orgType === "hospital" && p.roleKey !== "patient" && r.hospitalId === p.organizationId && scopeFor(p, "preauth:create")) {
    return "hospital";
  }
  return null;
}

/** Hospital staff record a government scheme's decision (made in the scheme's own system). */
function payerSideFor(p: Principal, r: Row["preauth"]): Side | null {
  const s = sideOf(p, r);
  if (s === "payer") return "payer";
  if (s === "hospital" && r.schemeId && !r.insurerId) return "scheme_desk";
  return null;
}

function reference() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `PA-${d}-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}`;
}

function detailsToColumns(d: ReturnType<typeof preauthDetailsSchema.parse>) {
  const clinical: Record<string, unknown> = { isAccident: d.isAccident ?? "unknown", pedDeclared: d.pedDeclared ?? "unknown", pedRelated: d.pedRelated ?? "unknown" };
  for (const k of CLINICAL_FIELDS) if (d[k]) clinical[k] = d[k];
  return {
    claimType: d.claimType,
    diagnosisId: d.diagnosisId ?? null,
    procedureId: d.procedureId ?? null,
    packageId: d.packageId ?? null,
    clinical,
    expectedAdmission: d.admissionDate ?? null,
    expectedStayDays: d.expectedStayDays ?? null,
    roomCategory: d.roomCategory ?? null,
    roomRentPerDay: money(d.roomRentPerDay),
    estimatedCost: money(d.estimatedCost),
    expectedInsuranceAmount: money(d.expectedInsuranceAmount),
    patientContribution: money(d.patientContribution),
  };
}

/** Non-clinical fields safe for audit state. */
function auditView(p: Row["preauth"] | ReturnType<typeof detailsToColumns>) {
  return {
    claimType: p.claimType,
    diagnosisId: p.diagnosisId,
    procedureId: p.procedureId,
    expectedAdmission: p.expectedAdmission,
    estimatedCost: p.estimatedCost,
    expectedInsuranceAmount: p.expectedInsuranceAmount,
    roomRentPerDay: p.roomRentPerDay,
  };
}

export const PREAUTH_WORKFLOW: WorkflowConfig<PreauthStatus> = {
  subjectType: "preauth",
  noun: "pre-auth",
  label: STATUS_LABEL,
  canTransition,
  changeStatus: (db, id, from, values) => PreauthRepository.changeStatus(db, id, from, values as Parameters<typeof PreauthRepository.changeStatus>[3]),
};

/** Pre-auth status change through the shared workflow transition (timeline + audit + notifications). */
function transition(tx: DbOrTx, ctx: ServiceContext, row: Row, to: PreauthStatus, side: Side, h: TransitionDetails, extra: Record<string, unknown> = {}) {
  return applyTransition<PreauthStatus, Row["preauth"]>(tx, ctx, PREAUTH_WORKFLOW, row.preauth, to, side, h, extra);
}

async function load(ctx: ServiceContext, id: string, opts: { forUpdate?: boolean; db?: DbOrTx } = {}) {
  const scope = requirePermission(ctx.principal, "preauth:read");
  const row = await PreauthRepository.findScoped(opts.db ?? ctx.db, ctx.principal, scope, requireId(id, "Pre-authorization"), opts);
  if (!row) throw new NotFoundError("Pre-authorization not found.");
  return row;
}

function requireSide(ctx: ServiceContext, row: Row, wanted: "hospital" | "payer"): Side {
  const s = wanted === "hospital" ? sideOf(ctx.principal, row.preauth) : payerSideFor(ctx.principal, row.preauth);
  if (!s || (wanted === "hospital" && s !== "hospital")) throw new ForbiddenError();
  return s;
}

async function checklistFor(db: DbOrTx, row: Row) {
  const loaded = row.preauth.latestEvaluationId ? await loadEvaluation(db, row.preauth.latestEvaluationId) : null;
  const checklist = computePreauthChecklist({
    evaluation: loaded?.evaluation ?? null,
    hasPolicy: !!row.preauth.policyId,
    hasDiagnosis: !!row.preauth.diagnosisId,
    hasProcedure: !!row.preauth.procedureId,
    hasEstimate: row.preauth.estimatedCost !== null,
    manual: row.preauth.checklist,
  });
  return { checklist, loaded };
}

export const PreauthService = {
  async list(ctx: ServiceContext, q: ListQuery, f: { status?: PreauthStatus[] }) {
    const scope = requirePermission(ctx.principal, "preauth:read");
    return PreauthRepository.list(ctx.db, ctx.principal, scope, q, f);
  },

  /** Everything the detail page needs, computed server-side (including what the caller may do). */
  async workspace(ctx: ServiceContext, id: string) {
    const row = await load(ctx, id);
    const [history, docs, queryRows, cl, liveClaim] = await Promise.all([
      PreauthRepository.history(ctx.db, row.preauth.id),
      DocumentRepository.forSubject(ctx.db, "preauth", row.preauth.id),
      PreauthRepository.queriesFor(ctx.db, row.preauth.id),
      checklistFor(ctx.db, row),
      ClaimRepository.liveClaimForPreauth(ctx.db, row.preauth.id),
    ]);
    const side = sideOf(ctx.principal, row.preauth);
    const payerSide = payerSideFor(ctx.principal, row.preauth);
    const status = row.preauth.status as PreauthStatus;
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "preauth.viewed", resourceType: "preauth", resourceId: row.preauth.id });
    return {
      ...row,
      history,
      documents: docs,
      queries: queryRows,
      checklist: cl.checklist,
      evaluation: cl.loaded,
      claim: liveClaim ?? null,
      side,
      can: {
        edit: side === "hospital" && HOSPITAL_EDITABLE.has(status),
        submit: side === "hospital" && status === "draft",
        respond: side === "hospital" && status === "query",
        cancel: side === "hospital" && allowedTransitions(status, "hospital").includes("cancelled"),
        decide: payerSide ? allowedTransitions(status, payerSide).filter((t) => t !== "settled") : [],
        recordsSchemeDecision: payerSide === "scheme_desk",
      },
    };
  },

  async create(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "preauth:create");
    if (ctx.principal.orgType !== "hospital" || ctx.principal.roleKey === "patient") {
      throw new ForbiddenError("Pre-authorizations are raised by the treating hospital's staff.");
    }
    const d = parseOrThrow(preauthCreateSchema, input);
    return ctx.db.transaction(async (tx) => {
      const cov = await CoverageRepository.findScoped(tx, ctx.principal, requirePermission(ctx.principal, "patient:read"), d.beneficiaryId);
      if (!cov) throw new NotFoundError("Coverage not found.");
      if (cov.patient.hospitalId !== ctx.principal.organizationId) throw new NotFoundError("Coverage not found.");
      const policy = await PolicyRepository.get(tx, cov.policyId!);
      if (!policy) throw new ValidationError("The patient's policy is no longer available.");
      const cols = detailsToColumns(d);
      const row = await PreauthRepository.insert(tx, {
        reference: reference(),
        hospitalId: ctx.principal.organizationId,
        patientId: cov.patientId,
        beneficiaryId: cov.id,
        policyId: policy.id,
        insurerId: policy.insurerId,
        tpaId: policy.tpaId,
        schemeId: policy.schemeId,
        status: "draft",
        ...cols,
        createdBy: ctx.principal.userId,
      });
      await PreauthRepository.insertHistory(tx, {
        subjectType: "preauth", subjectId: row.id, fromStatus: null, toStatus: "draft",
        message: "Draft created", requiredAction: "Upload documents, run the checks and complete the checklist", responsibleTeam: "Hospital insurance desk", actorUserId: ctx.principal.userId,
      });
      await AuditService.record(tx, { ...actorOf(ctx), action: "preauth.created", resourceType: "preauth", resourceId: row.id, newState: { reference: row.reference, policyId: policy.id, ...auditView(row) } });
      return row;
    });
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(preauthDetailsSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      requireSide(ctx, row, "hospital");
      if (!HOSPITAL_EDITABLE.has(row.preauth.status as PreauthStatus)) throw new ConflictError("This request can't be edited in its current status.");
      const cols = detailsToColumns(d);
      // On a draft, any change invalidates the last rules check (re-run before submitting).
      const updated = await PreauthRepository.update(tx, row.preauth.id, { ...cols, ...(row.preauth.status === "draft" ? { latestEvaluationId: null } : {}) });
      await AuditService.record(tx, { ...actorOf(ctx), action: "preauth.updated", resourceType: "preauth", resourceId: row.preauth.id, previousState: auditView(row.preauth), newState: auditView(updated) });
      return updated;
    });
  },

  /** Runs the policy's active rules on the request's stored data and records the evaluation. */
  async runChecks(ctx: ServiceContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      requireSide(ctx, row, "hospital");
      const facts = await buildPreauthFacts(tx, row);
      const res = await evaluateAndRecord(tx, ctx, { policyId: row.preauth.policyId, subjectType: "preauth", subjectId: row.preauth.id, facts });
      await PreauthRepository.update(tx, row.preauth.id, { latestEvaluationId: res.evaluationId });
      return res.evaluation;
    });
  },

  /** Records a staff confirmation (manual items) or a human verification note (items needing verification). */
  async confirmItem(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(confirmItemSchema, input);
    const def = CHECKLIST.find((c) => c.key === d.key);
    if (!def) throw new ValidationError("Unknown checklist item.");
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      requireSide(ctx, row, "hospital");
      if (row.preauth.status !== "draft") throw new ConflictError("The checklist can only be changed on a draft.");
      const { checklist } = await checklistFor(tx, row);
      const item = checklist.items.find((i) => i.key === d.key)!;
      if (d.confirmed && !item.confirmable) throw new ValidationError("This item is completed by the rule checks, not manually.");
      if (d.confirmed && def.source.type === "rules" && (!d.note || d.note.length < 10)) {
        throw new ValidationError("Record who verified this with the payer and how (at least 10 characters).", { note: ["Add a verification note."] });
      }
      const next = { ...row.preauth.checklist };
      if (d.confirmed) next[d.key] = { confirmed: true, note: d.note, by: ctx.principal.userId, at: new Date().toISOString() };
      else delete next[d.key];
      await PreauthRepository.update(tx, row.preauth.id, { checklist: next });
      await AuditService.record(tx, { ...actorOf(ctx), action: "preauth.checklist_confirmed", resourceType: "preauth", resourceId: row.preauth.id, newState: { item: d.key, confirmed: d.confirmed, note: d.note ?? null } });
    });
  },

  /**
   * Submits a draft. The server re-runs the rules on current data and recomputes
   * the checklist — the button state in the browser is never trusted.
   */
  async submit(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(submitSchema, input);
    return ctx.db.transaction(async (tx) => {
      let row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = requireSide(ctx, row, "hospital");
      if (row.preauth.status !== "draft") throw new InvalidTransitionError("Only drafts can be submitted.");

      const facts = await buildPreauthFacts(tx, row);
      const res = await evaluateAndRecord(tx, ctx, { policyId: row.preauth.policyId, subjectType: "preauth", subjectId: row.preauth.id, facts });
      await PreauthRepository.update(tx, row.preauth.id, { latestEvaluationId: res.evaluationId });
      row = { ...row, preauth: { ...row.preauth, latestEvaluationId: res.evaluationId } };
      const { checklist } = await checklistFor(tx, row);

      if (!checklist.canSubmit) {
        throw new ValidationError(`Complete the checklist first: ${checklist.incomplete.map((i) => i.label).join("; ")}.`);
      }
      if (checklist.hardFailures.length && (!d.overrideReason || d.overrideReason.length < 20)) {
        throw new ValidationError(
          `These checks failed: ${checklist.hardFailures.map((i) => i.label).join("; ")}. To submit anyway, record why (at least 20 characters). The payer will make the decision.`,
          { overrideReason: ["Explain why this request should still be submitted."] },
        );
      }
      const updated = await transition(tx, ctx, row, "submitted", side, {
        message: checklist.hardFailures.length ? `Submitted despite failed checks: ${d.overrideReason}` : "Submitted with all checks complete",
        requiredAction: "Review the request",
        responsibleTeam: row.preauth.insurerId ? "Insurer / TPA review team" : "Government scheme (via hospital scheme desk)",
      }, { submittedAt: new Date(), submitOverrideReason: checklist.hardFailures.length ? d.overrideReason! : null });
      if (checklist.hardFailures.length) {
        await AuditService.record(tx, { ...actorOf(ctx), action: "preauth.submitted_with_failed_checks", resourceType: "preauth", resourceId: row.preauth.id, newState: { failed: checklist.hardFailures.map((i) => i.key), reason: d.overrideReason } });
      }
      return updated;
    });
  },

  /** Payer decision (or a hospital scheme desk recording a scheme's decision with its reference). */
  async decide(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(decisionSchema, input);
    requirePermission(ctx.principal, ctx.principal.orgType === "hospital" ? "preauth:create" : "preauth:review");
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = requireSide(ctx, row, "payer");
      if (side === "scheme_desk" && !d.payerReference) {
        throw new ValidationError("Enter the scheme's reference number for this decision.", { payerReference: ["Required when recording a scheme decision."] });
      }
      if (d.to === "settled") throw new InvalidTransitionError("Settlement is recorded against the claim.");
      const reason = d.reasonId ? await PreauthRepository.reason(tx, d.reasonId) : undefined;
      if (d.reasonId && !reason) throw new ValidationError("Select a valid reason.", { reasonId: ["Select a valid reason."] });

      const requested = Number(row.preauth.expectedInsuranceAmount ?? row.preauth.estimatedCost ?? 0);
      if (d.to === "approved" && requested && d.amount! < requested) {
        throw new ValidationError("The amount is below the requested amount — use 'Partially approve' and explain why.", { amount: ["Lower than requested."] });
      }
      if (d.to === "partially_approved" && requested && d.amount! >= requested) {
        throw new ValidationError("A partial approval must be lower than the requested amount.", { amount: ["Must be lower than requested."] });
      }
      if (["approved", "partially_approved"].includes(d.to) && row.preauth.estimatedCost && d.amount! > Number(row.preauth.estimatedCost)) {
        throw new ValidationError("The approved amount can't exceed the estimated cost.", { amount: ["Exceeds the estimate."] });
      }

      if (PAYER_DECISIONS.has(d.to)) {
        await PreauthRepository.insertPayerResponse(tx, {
          subjectType: "preauth",
          subjectId: row.preauth.id,
          decision: d.to === "final_approved" ? "approved" : (d.to as "query" | "approved" | "partially_approved" | "rejected"),
          approvedAmount: money(d.amount),
          rejectionReasonId: reason?.id ?? null,
          remarks: d.message ?? null,
          payerReference: d.payerReference ?? null,
          recordedBy: ctx.principal.userId,
        });
      }
      if (d.to === "query") {
        await PreauthRepository.insertQuery(tx, {
          subjectType: "preauth", subjectId: row.preauth.id, reasonId: reason!.id, message: d.message!, requiredDocuments: d.requiredDocuments, raisedBy: ctx.principal.userId,
        });
      }

      const DEFAULT_ACTION: Partial<Record<PreauthStatus, string>> = {
        pending: "Wait for the payer's decision",
        approved: "Admit and treat; submit the final bill and documents after discharge",
        partially_approved: "Inform the patient of the difference; admit and treat",
        final_approved: "Prepare the claim for settlement",
      };
      const team = d.to === "rejected" ? "Hospital insurance desk / patient" : d.to === "pending" ? "Insurer / TPA review team" : "Hospital insurance desk";
      const docs = d.requiredDocuments.map(documentLabel);
      return transition(tx, ctx, row, d.to, side, {
        reason: reason?.title ?? null,
        message: [d.message, d.payerReference ? `Payer reference: ${d.payerReference}` : null].filter(Boolean).join(" · ") || null,
        requiredAction: reason?.requiredAction ?? DEFAULT_ACTION[d.to] ?? null,
        requiredDocuments: docs,
        responsibleTeam: team,
      }, ["approved", "partially_approved", "final_approved"].includes(d.to) ? { approvedAmount: money(d.amount) } : {});
    });
  },

  async respondToQuery(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(queryResponseSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = requireSide(ctx, row, "hospital");
      // Must be answering an actual query: draft → submitted goes through submit() and its checklist.
      if (row.preauth.status !== "query") throw new InvalidTransitionError("There is no open query to respond to.");
      await PreauthRepository.respondToQueries(tx, row.preauth.id, ctx.principal.userId, d.message);
      return transition(tx, ctx, row, "submitted", side, {
        message: `Query answered: ${d.message}`,
        requiredAction: "Review the response",
        responsibleTeam: row.preauth.insurerId ? "Insurer / TPA review team" : "Government scheme (via hospital scheme desk)",
      });
    });
  },

  async cancel(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(cancelSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = requireSide(ctx, row, "hospital");
      return transition(tx, ctx, row, "cancelled", side, { message: d.message, responsibleTeam: "Hospital insurance desk" });
    });
  },

  async reasons(ctx: ServiceContext) {
    requirePermission(ctx.principal, "preauth:read");
    return PreauthRepository.reasons(ctx.db);
  },
};

/**
 * Keeps a cashless pre-auth in step with its claim: claim approval → pre-auth
 * "final approved"; claim settlement → pre-auth "settled". Runs in the claim's
 * transaction through the same guarded transition; skipped when not applicable
 * (e.g. the pre-auth was already moved on).
 */
export async function advancePreauthForClaim(
  tx: DbOrTx,
  ctx: Pick<ServiceContext, "principal" | "meta">,
  preAuthId: string,
  to: "final_approved" | "settled",
  side: Side,
  details: { amount?: string | null; claimReference: string },
) {
  const scope = requirePermission(ctx.principal, "preauth:read");
  const row = await PreauthRepository.findScoped(tx, ctx.principal, scope, preAuthId, { forUpdate: true });
  if (!row || !canTransition(row.preauth.status as PreauthStatus, to, side)) return null;
  return applyTransition<PreauthStatus, Row["preauth"]>(tx, ctx, PREAUTH_WORKFLOW, row.preauth, to, side, {
    message: to === "final_approved" ? `Final claim ${details.claimReference} approved` : `Claim ${details.claimReference} settled`,
    responsibleTeam: "Hospital insurance desk",
  }, to === "final_approved" && details.amount ? { approvedAmount: details.amount } : {});
}
