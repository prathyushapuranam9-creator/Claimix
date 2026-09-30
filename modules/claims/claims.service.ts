import "server-only";
import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission, scopeFor, type Principal } from "@/lib/permissions/principal";
import { randomToken } from "@/lib/security/crypto";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { documentLabel } from "@/modules/documents/document-types";
import { DocumentRepository } from "@/modules/documents/documents.repository";
import { CoverageRepository } from "@/modules/patients/coverage.repository";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import { PreauthRepository } from "@/modules/preauth/preauth.repository";
import { advancePreauthForClaim } from "@/modules/preauth/preauth.service";
import { evaluateAndRecord, loadEvaluation } from "@/modules/rules/rules.service";
import { HistoryRepository } from "@/modules/workflow/history.repository";
import { applyTransition, type Side, type TransitionDetails, type WorkflowConfig } from "@/modules/workflow/transition";
import { CLAIM_CHECKLIST, computeClaimChecklist } from "./claims.checklist";
import { buildClaimFacts } from "./claims.facts";
import { ClaimRepository, type ClaimFilters, type ClaimSort } from "./claims.repository";
import {
  cashlessClaimSchema, claimDecisionSchema, claimDetailsSchema, CLAIM_CLINICAL_FIELDS, reimbursementClaimSchema, settlementSchema,
} from "./claims.validation";
import {
  allowedClaimTransitions, canTransitionClaim, CLAIM_EDITABLE, CLAIM_PAYER_DECISIONS, CLAIM_STATUS_LABEL, type ClaimStatus,
} from "./claims.workflow";
import { cancelSchema, confirmItemSchema, queryResponseSchema, submitSchema } from "@/modules/preauth/preauth.validation";

type Row = NonNullable<Awaited<ReturnType<typeof ClaimRepository.findScoped>>>;

const money = (n: number | undefined) => (n === undefined ? null : n.toFixed(2));
const APPROVED_PREAUTH = new Set(["approved", "partially_approved", "final_approved"]);

export const CLAIM_WORKFLOW: WorkflowConfig<ClaimStatus> = {
  subjectType: "claim",
  noun: "claim",
  label: CLAIM_STATUS_LABEL,
  canTransition: canTransitionClaim,
  changeStatus: (db, id, from, values) => ClaimRepository.changeStatus(db, id, from, values as Parameters<typeof ClaimRepository.changeStatus>[3]),
};

/** Which side the caller acts on for this claim (null: read-only). */
export function claimSideOf(p: Principal, c: Row["claim"]): Side | null {
  if (p.orgType === "insurer" && c.insurerId === p.organizationId && scopeFor(p, "claim:review")) return "payer";
  if (p.orgType === "tpa" && c.tpaId === p.organizationId && scopeFor(p, "claim:review")) return "payer";
  if (p.orgType === "hospital" && p.roleKey !== "patient" && c.hospitalId === p.organizationId && scopeFor(p, "claim:create")) return "hospital";
  return null;
}

/** Scheme claims: the hospital's scheme desk records the scheme's own decision. */
function claimPayerSide(p: Principal, c: Row["claim"]): Side | null {
  const s = claimSideOf(p, c);
  if (s === "payer") return "payer";
  if (s === "hospital" && c.schemeId && !c.insurerId) return "scheme_desk";
  return null;
}

function reference() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `CL-${d}-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}`;
}

function detailsToColumns(d: ReturnType<typeof claimDetailsSchema.parse>) {
  // Only answers actually given are stored, so they never overwrite what the pre-auth recorded.
  const clinical: Record<string, unknown> = {};
  for (const k of ["isAccident", "pedDeclared", "pedRelated"] as const) if (d[k]) clinical[k] = d[k];
  for (const k of CLAIM_CLINICAL_FIELDS) if (d[k]) clinical[k] = d[k];
  return {
    diagnosisId: d.diagnosisId ?? null,
    procedureId: d.procedureId ?? null,
    admissionDate: d.admissionDate ?? null,
    dischargeDate: d.dischargeDate ?? null,
    billNumber: d.billNumber ?? null,
    claimedAmount: money(d.claimedAmount),
    roomRentPerDay: money(d.roomRentPerDay),
    clinical,
  };
}

function auditView(c: Pick<Row["claim"], "claimedAmount" | "admissionDate" | "dischargeDate" | "diagnosisId" | "procedureId" | "billNumber">) {
  return { claimedAmount: c.claimedAmount, admissionDate: c.admissionDate, dischargeDate: c.dischargeDate, diagnosisId: c.diagnosisId, procedureId: c.procedureId, billNumber: c.billNumber };
}

function transition(tx: DbOrTx, ctx: ServiceContext, row: Row, to: ClaimStatus, side: Side, h: TransitionDetails, extra: Record<string, unknown> = {}) {
  return applyTransition<ClaimStatus, Row["claim"]>(tx, ctx, CLAIM_WORKFLOW, row.claim, to, side, h, extra);
}

async function load(ctx: ServiceContext, id: string, opts: { forUpdate?: boolean; db?: DbOrTx } = {}) {
  const scope = requirePermission(ctx.principal, "claim:read");
  const row = await ClaimRepository.findScoped(opts.db ?? ctx.db, ctx.principal, scope, requireId(id, "Claim"), opts);
  if (!row) throw new NotFoundError("Claim not found.");
  return row;
}

function hospitalSide(ctx: ServiceContext, row: Row): Side {
  if (claimSideOf(ctx.principal, row.claim) !== "hospital") throw new ForbiddenError();
  return "hospital";
}

function payerSide(ctx: ServiceContext, row: Row): Side {
  const s = claimPayerSide(ctx.principal, row.claim);
  if (!s) throw new ForbiddenError();
  return s;
}

function requireHospitalStaff(ctx: ServiceContext) {
  requirePermission(ctx.principal, "claim:create");
  if (ctx.principal.orgType !== "hospital" || ctx.principal.roleKey === "patient") {
    throw new ForbiddenError("Claims are prepared by the treating hospital's insurance desk.");
  }
}

async function checklistFor(db: DbOrTx, row: Row) {
  const [loaded, pre] = await Promise.all([
    row.claim.latestEvaluationId ? loadEvaluation(db, row.claim.latestEvaluationId) : Promise.resolve(null),
    row.claim.preAuthId ? ClaimRepository.preauthSummary(db, row.claim.preAuthId) : Promise.resolve(undefined),
  ]);
  const c = row.claim;
  const checklist = computeClaimChecklist({
    evaluation: loaded?.evaluation ?? null,
    isCashless: c.claimType === "cashless",
    preauthApproved: !!pre && APPROVED_PREAUTH.has(pre.status),
    hasDates: !!c.admissionDate && !!c.dischargeDate,
    hasTreatment: !!c.diagnosisId && !!c.procedureId,
    hasBill: c.claimedAmount !== null && Number(c.claimedAmount) > 0,
    manual: c.checklist,
  });
  return { checklist, loaded, preauth: pre };
}

async function insertDraft(tx: DbOrTx, ctx: ServiceContext, values: Parameters<typeof ClaimRepository.insert>[1]) {
  const row = await ClaimRepository.insert(tx, values);
  await HistoryRepository.insert(tx, {
    subjectType: "claim", subjectId: row.id, fromStatus: null, toStatus: "draft",
    message: "Claim draft created", requiredAction: "Enter final bill details, upload claim documents and complete the checklist", responsibleTeam: "Hospital insurance desk", actorUserId: ctx.principal.userId,
  });
  await AuditService.record(tx, { ...actorOf(ctx), action: "claim.created", resourceType: "claim", resourceId: row.id, newState: { reference: row.reference, claimType: row.claimType, preAuthId: row.preAuthId, ...auditView(row) } });
  return row;
}

export const ClaimService = {
  async list(ctx: ServiceContext, q: ListQuery, f: ClaimFilters, sort?: ClaimSort) {
    const scope = requirePermission(ctx.principal, "claim:read");
    return ClaimRepository.list(ctx.db, ctx.principal, scope, q, f, sort);
  },

  /** Bounded, audited CSV export of the caller's scoped claims. */
  async exportRows(ctx: ServiceContext, q: Pick<ListQuery, "q">, f: ClaimFilters) {
    const scope = requirePermission(ctx.principal, "claim:read");
    requirePermission(ctx.principal, "report:view");
    const limit = 5000;
    const rows = await ClaimRepository.exportRows(ctx.db, ctx.principal, scope, q, f, limit + 1);
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "claim.exported", resourceType: "claim", newState: { filters: { ...f, q: q.q ?? null }, rows: Math.min(rows.length, limit) } });
    return { rows: rows.slice(0, limit), truncated: rows.length > limit };
  },

  async workspace(ctx: ServiceContext, id: string) {
    const row = await load(ctx, id);
    const c = row.claim;
    const [history, claimDocs, preauthDocs, queryRows, responses, settlement, cl] = await Promise.all([
      HistoryRepository.timeline(ctx.db, "claim", c.id),
      DocumentRepository.forSubject(ctx.db, "claim", c.id),
      c.preAuthId ? DocumentRepository.forSubject(ctx.db, "preauth", c.preAuthId) : Promise.resolve([]),
      HistoryRepository.queries(ctx.db, "claim", c.id),
      HistoryRepository.payerResponses(ctx.db, "claim", c.id),
      ClaimRepository.settlement(ctx.db, c.id),
      checklistFor(ctx.db, row),
    ]);
    const side = claimSideOf(ctx.principal, c);
    const pSide = claimPayerSide(ctx.principal, c);
    const status = c.status as ClaimStatus;
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "claim.viewed", resourceType: "claim", resourceId: c.id });
    return {
      ...row,
      history,
      documents: claimDocs,
      preauthDocuments: preauthDocs,
      queries: queryRows,
      payerResponses: responses,
      settlement,
      preauth: cl.preauth,
      checklist: cl.checklist,
      evaluation: cl.loaded,
      side,
      can: {
        edit: side === "hospital" && CLAIM_EDITABLE.has(status),
        submit: side === "hospital" && status === "draft",
        respond: side === "hospital" && status === "query",
        cancel: side === "hospital" && allowedClaimTransitions(status, "hospital").includes("cancelled"),
        decide: pSide ? allowedClaimTransitions(status, pSide).filter((t) => t !== "settled") : [],
        // Insurers pay (claim:settle); TPAs assess but don't settle; scheme desks record scheme payments.
        settle: !!pSide && (pSide === "scheme_desk" || !!scopeFor(ctx.principal, "claim:settle")) && allowedClaimTransitions(status, pSide).includes("settled"),
        recordsSchemeDecision: pSide === "scheme_desk",
      },
    };
  },

  async claimablePreauths(ctx: ServiceContext) {
    requireHospitalStaff(ctx);
    return ClaimRepository.claimablePreauths(ctx.db, ctx.principal.organizationId);
  },

  /** Cashless claim from an approved pre-authorization (one live claim per pre-auth). */
  async createCashless(ctx: ServiceContext, input: unknown) {
    requireHospitalStaff(ctx);
    const d = parseOrThrow(cashlessClaimSchema, input);
    return ctx.db.transaction(async (tx) => {
      const pre = await PreauthRepository.findScoped(tx, ctx.principal, requirePermission(ctx.principal, "preauth:read"), d.preAuthId, { forUpdate: true });
      if (!pre || pre.preauth.hospitalId !== ctx.principal.organizationId) throw new NotFoundError("Pre-authorization not found.");
      if (!APPROVED_PREAUTH.has(pre.preauth.status)) throw new ValidationError("A cashless claim needs an approved pre-authorization.");
      const existing = await ClaimRepository.liveClaimForPreauth(tx, pre.preauth.id);
      if (existing) throw new ConflictError(`Claim ${existing.reference} already exists for this pre-authorization.`);
      const cols = detailsToColumns(d);
      const p = pre.preauth;
      return insertDraft(tx, ctx, {
        reference: reference(),
        claimType: "cashless",
        hospitalId: p.hospitalId,
        patientId: p.patientId,
        beneficiaryId: p.beneficiaryId,
        policyId: p.policyId,
        insurerId: p.insurerId,
        tpaId: p.tpaId,
        schemeId: p.schemeId,
        preAuthId: p.id,
        status: "draft",
        ...cols,
        // Carry over what the pre-auth recorded when the form left it blank.
        diagnosisId: cols.diagnosisId ?? p.diagnosisId,
        procedureId: cols.procedureId ?? p.procedureId,
        admissionDate: cols.admissionDate ?? p.expectedAdmission,
        roomRentPerDay: cols.roomRentPerDay ?? p.roomRentPerDay,
        clinical: { ...(p.clinical as object), ...cols.clinical },
        createdBy: ctx.principal.userId,
      });
    });
  },

  /** Reimbursement claim prepared by the hospital desk from the patient's recorded coverage. */
  async createReimbursement(ctx: ServiceContext, input: unknown) {
    requireHospitalStaff(ctx);
    const d = parseOrThrow(reimbursementClaimSchema, input);
    return ctx.db.transaction(async (tx) => {
      const cov = await CoverageRepository.findScoped(tx, ctx.principal, requirePermission(ctx.principal, "patient:read"), d.beneficiaryId);
      if (!cov || cov.patient.hospitalId !== ctx.principal.organizationId) throw new NotFoundError("Coverage not found.");
      const policy = await PolicyRepository.get(tx, cov.policyId!);
      if (!policy) throw new ValidationError("The patient's policy is no longer available.");
      return insertDraft(tx, ctx, {
        reference: reference(),
        claimType: "reimbursement",
        hospitalId: ctx.principal.organizationId,
        patientId: cov.patientId,
        beneficiaryId: cov.id,
        policyId: policy.id,
        insurerId: policy.insurerId,
        tpaId: policy.tpaId,
        schemeId: policy.schemeId,
        status: "draft",
        ...detailsToColumns(d),
        createdBy: ctx.principal.userId,
      });
    });
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(claimDetailsSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      hospitalSide(ctx, row);
      if (!CLAIM_EDITABLE.has(row.claim.status as ClaimStatus)) throw new ConflictError("This claim can't be edited in its current status.");
      const cols = detailsToColumns(d);
      const clinical = { ...(row.claim.clinical as object), ...cols.clinical };
      const updated = await ClaimRepository.update(tx, row.claim.id, { ...cols, clinical, ...(row.claim.status === "draft" ? { latestEvaluationId: null } : {}) });
      await AuditService.record(tx, { ...actorOf(ctx), action: "claim.updated", resourceType: "claim", resourceId: row.claim.id, previousState: auditView(row.claim), newState: auditView(updated) });
      return updated;
    });
  },

  async runChecks(ctx: ServiceContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      hospitalSide(ctx, row);
      const res = await evaluateAndRecord(tx, ctx, { policyId: row.claim.policyId, subjectType: "claim", subjectId: row.claim.id, facts: await buildClaimFacts(tx, row) });
      await ClaimRepository.update(tx, row.claim.id, { latestEvaluationId: res.evaluationId });
      return res.evaluation;
    });
  },

  async confirmItem(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(confirmItemSchema, input);
    const def = CLAIM_CHECKLIST.find((c) => c.key === d.key);
    if (!def) throw new ValidationError("Unknown checklist item.");
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      hospitalSide(ctx, row);
      if (row.claim.status !== "draft") throw new ConflictError("The checklist can only be changed on a draft.");
      const { checklist } = await checklistFor(tx, row);
      const item = checklist.items.find((i) => i.key === d.key)!;
      if (d.confirmed && !item.confirmable) throw new ValidationError("This item is completed by the checks, not manually.");
      if (d.confirmed && def.source.type === "rules" && (!d.note || d.note.length < 10)) {
        throw new ValidationError("Record who verified this with the payer and how (at least 10 characters).", { note: ["Add a verification note."] });
      }
      const next = { ...row.claim.checklist };
      if (d.confirmed) next[d.key] = { confirmed: true, note: d.note, by: ctx.principal.userId, at: new Date().toISOString() };
      else delete next[d.key];
      await ClaimRepository.update(tx, row.claim.id, { checklist: next });
      await AuditService.record(tx, { ...actorOf(ctx), action: "claim.checklist_confirmed", resourceType: "claim", resourceId: row.claim.id, newState: { item: d.key, confirmed: d.confirmed, note: d.note ?? null } });
    });
  },

  /** Submits a draft claim; rules are re-run and the checklist recomputed on the server. */
  async submit(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(submitSchema, input);
    return ctx.db.transaction(async (tx) => {
      let row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = hospitalSide(ctx, row);
      if (row.claim.status !== "draft") throw new InvalidTransitionError("Only drafts can be submitted.");
      const res = await evaluateAndRecord(tx, ctx, { policyId: row.claim.policyId, subjectType: "claim", subjectId: row.claim.id, facts: await buildClaimFacts(tx, row) });
      await ClaimRepository.update(tx, row.claim.id, { latestEvaluationId: res.evaluationId });
      row = { ...row, claim: { ...row.claim, latestEvaluationId: res.evaluationId } };
      const { checklist } = await checklistFor(tx, row);
      if (!checklist.canSubmit) throw new ValidationError(`Complete the checklist first: ${checklist.incomplete.map((i) => i.label).join("; ")}.`);
      if (checklist.hardFailures.length && (!d.overrideReason || d.overrideReason.length < 20)) {
        throw new ValidationError(
          `These checks failed: ${checklist.hardFailures.map((i) => i.label).join("; ")}. To submit anyway, record why (at least 20 characters). The payer will make the decision.`,
          { overrideReason: ["Explain why this claim should still be submitted."] },
        );
      }
      const updated = await transition(tx, ctx, row, "submitted", side, {
        message: checklist.hardFailures.length ? `Submitted despite failed checks: ${d.overrideReason}` : "Final claim submitted with all checks complete",
        requiredAction: "Assess the final claim",
        responsibleTeam: row.claim.insurerId ? "Insurer / TPA claims team" : "Government scheme (via hospital scheme desk)",
      }, { submittedAt: new Date(), submitOverrideReason: checklist.hardFailures.length ? d.overrideReason! : null });
      if (checklist.hardFailures.length) {
        await AuditService.record(tx, { ...actorOf(ctx), action: "claim.submitted_with_failed_checks", resourceType: "claim", resourceId: row.claim.id, newState: { failed: checklist.hardFailures.map((i) => i.key), reason: d.overrideReason } });
      }
      return updated;
    });
  },

  /**
   * Payer assessment. Approval amounts are checked against the claimed amount;
   * the patient's share is recorded; a cashless pre-auth moves to final approval.
   */
  async decide(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(claimDecisionSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = payerSide(ctx, row);
      if (side === "scheme_desk" && !d.payerReference) {
        throw new ValidationError("Enter the scheme's reference number for this decision.", { payerReference: ["Required when recording a scheme decision."] });
      }
      const reason = d.reasonId ? await HistoryRepository.reason(tx, d.reasonId) : undefined;
      if (d.reasonId && !reason) throw new ValidationError("Select a valid reason.", { reasonId: ["Select a valid reason."] });

      const claimed = Number(row.claim.claimedAmount ?? 0);
      if (d.to === "approved" && d.amount !== claimed) {
        throw new ValidationError("A full approval must equal the claimed amount — use 'Partially approve' for deductions and explain them.", { amount: ["Must equal the claimed amount."] });
      }
      if (d.to === "partially_approved" && d.amount! >= claimed) {
        throw new ValidationError("A partial approval must be lower than the claimed amount.", { amount: ["Must be lower than claimed."] });
      }
      const balance = row.beneficiary.sumInsuredAvailable === null ? null : Number(row.beneficiary.sumInsuredAvailable);
      if ((d.to === "approved" || d.to === "partially_approved") && balance !== null && d.amount! > balance) {
        throw new ValidationError(`The approved amount exceeds the patient's available balance (₹${balance.toLocaleString("en-IN")}).`, { amount: ["Exceeds available balance."] });
      }

      if (CLAIM_PAYER_DECISIONS.has(d.to)) {
        await HistoryRepository.insertPayerResponse(tx, {
          subjectType: "claim",
          subjectId: row.claim.id,
          decision: d.to as "query" | "approved" | "partially_approved" | "rejected",
          approvedAmount: money(d.amount),
          rejectionReasonId: reason?.id ?? null,
          remarks: d.message ?? null,
          payerReference: d.payerReference ?? null,
          recordedBy: ctx.principal.userId,
        });
      }
      if (d.to === "query") {
        await HistoryRepository.insertQuery(tx, { subjectType: "claim", subjectId: row.claim.id, reasonId: reason!.id, message: d.message!, requiredDocuments: d.requiredDocuments, raisedBy: ctx.principal.userId });
      }

      const approved = d.to === "approved" || d.to === "partially_approved";
      const extra = approved ? { approvedAmount: money(d.amount), patientAmount: (claimed - d.amount!).toFixed(2) } : {};
      const ACTION: Partial<Record<ClaimStatus, string>> = {
        pending: "Wait for the payer's assessment",
        approved: "Await settlement",
        partially_approved: "Collect the disallowed amount from the patient; await settlement",
      };
      const updated = await transition(tx, ctx, row, d.to, side, {
        reason: reason?.title ?? null,
        message: [d.message, d.payerReference ? `Payer reference: ${d.payerReference}` : null].filter(Boolean).join(" · ") || null,
        requiredAction: reason?.requiredAction ?? ACTION[d.to] ?? null,
        requiredDocuments: d.requiredDocuments.map(documentLabel),
        responsibleTeam: d.to === "rejected" ? "Hospital insurance desk / patient" : d.to === "pending" ? "Insurer / TPA claims team" : "Hospital insurance desk",
      }, extra);

      if (approved && row.claim.preAuthId) {
        await advancePreauthForClaim(tx, ctx, row.claim.preAuthId, "final_approved", side, { amount: money(d.amount), claimReference: row.claim.reference });
      }
      return updated;
    });
  },

  async respondToQuery(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(queryResponseSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = hospitalSide(ctx, row);
      if (row.claim.status !== "query") throw new InvalidTransitionError("There is no open query to respond to.");
      await HistoryRepository.respondToQueries(tx, "claim", row.claim.id, ctx.principal.userId, d.message);
      return transition(tx, ctx, row, "submitted", side, {
        message: `Query answered: ${d.message}`,
        requiredAction: "Review the response",
        responsibleTeam: row.claim.insurerId ? "Insurer / TPA claims team" : "Government scheme (via hospital scheme desk)",
      });
    });
  },

  async cancel(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(cancelSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      return transition(tx, ctx, row, "cancelled", hospitalSide(ctx, row), { message: d.message, responsibleTeam: "Hospital insurance desk" });
    });
  },

  /**
   * Records the payment. The settlement is written first (the database refuses a
   * "settled" claim without one), the patient's available sum insured is reduced,
   * and a cashless pre-auth is marked settled.
   */
  async settle(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(settlementSchema, input);
    requirePermission(ctx.principal, ctx.principal.orgType === "hospital" ? "claim:create" : "claim:review");
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      const side = payerSide(ctx, row);
      if (side === "payer") requirePermission(ctx.principal, "claim:settle");
      if (!canTransitionClaim(row.claim.status as ClaimStatus, "settled", side)) throw new InvalidTransitionError("Only approved claims can be settled.");
      const approved = Number(row.claim.approvedAmount ?? 0);
      if (d.amount > approved) throw new ValidationError(`The settlement can't exceed the approved amount (₹${approved.toLocaleString("en-IN")}).`, { amount: ["Exceeds the approved amount."] });
      if (d.amount < approved && (!d.deductionNote || d.deductionNote.length < 10)) {
        throw new ValidationError("Explain the deduction from the approved amount (e.g. TDS, recovery).", { deductionNote: ["Explain the deduction."] });
      }

      const s = await ClaimRepository.insertSettlement(tx, {
        claimId: row.claim.id,
        status: "paid",
        amount: d.amount.toFixed(2),
        utr: d.utr,
        settledAt: new Date(`${d.settledAt}T00:00:00+05:30`),
        deductionNote: d.deductionNote ?? null,
        payee: row.claim.claimType === "cashless" ? "hospital" : "patient",
        recordedBy: ctx.principal.userId,
      });
      const before = row.beneficiary.sumInsuredAvailable;
      const bal = await ClaimRepository.consumeBalance(tx, row.claim.beneficiaryId, s.amount);
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "settlement.recorded",
        resourceType: "claim",
        resourceId: row.claim.id,
        newState: { settlementId: s.id, amount: s.amount, utr: s.utr, payee: s.payee, balanceBefore: before, balanceAfter: bal?.sumInsuredAvailable ?? null },
      });
      const updated = await transition(tx, ctx, row, "settled", side, {
        message: `Paid ₹${Number(s.amount).toLocaleString("en-IN")} to the ${s.payee} · UTR ${s.utr}${s.deductionNote ? ` · Deduction: ${s.deductionNote}` : ""}`,
        responsibleTeam: "Hospital accounts",
      });
      if (row.claim.preAuthId) {
        await advancePreauthForClaim(tx, ctx, row.claim.preAuthId, "settled", side, { claimReference: row.claim.reference });
      }
      return updated;
    });
  },
};
