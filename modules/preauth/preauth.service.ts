import "server-only";
import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission, scopeFor, type Principal } from "@/lib/permissions/principal";
import { randomToken } from "@/lib/security/crypto";
import { aadhaarDigits } from "@/lib/india";
import { aadhaarColumns, aadhaarHash } from "@/modules/patients/aadhaar";
import { parseOrThrow, requireId, todayIso } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { DocumentRepository } from "@/modules/documents/documents.repository";
import { documentLabel } from "@/modules/documents/document-types";
import { applyTransition, type TransitionDetails, type WorkflowConfig } from "@/modules/workflow/transition";
import { CoverageRepository } from "@/modules/patients/coverage.repository";
import { coverPeriodStatus } from "@/modules/patients/coverage.validation";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import { ClaimRepository } from "@/modules/claims/claims.repository";
import { evaluateAndRecord, loadEvaluation, requiredDocumentsFor } from "@/modules/rules/rules.service";
import { NotificationService } from "@/modules/notifications/notifications.service";
import { CHECKLIST, computePreauthChecklist } from "./preauth.checklist";
import { buildPreauthFacts } from "./preauth.facts";
import { isNewborn, scrutinize, wizardDocuments } from "./preauth.scrutiny";
import { PreauthRepository, type MemberRow } from "./preauth.repository";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import {
  cancelSchema, CLINICAL_FIELDS, confirmItemSchema, decisionSchema, preauthCreateSchema, preauthDetailsSchema, queryResponseSchema, quickFixSchema, expectedCost, gapsAcknowledgment, stayDays, submitSchema, wizardClinicalSchema, wizardKycSchema, wizardRaiseSchema, wizardSubmitSchema, type PreauthDetailsInput, type WizardKyc,
} from "./preauth.validation";
import { allowedTransitions, canTransition, HOSPITAL_EDITABLE, PAYER_DECISIONS, STATUS_LABEL, TERMINAL, type PreauthStatus, type Side } from "./preauth.workflow";

/** Statuses in which the request is still waiting on someone (so a missing reviewer matters). */
const TERMINAL_STATUSES = new Set<PreauthStatus>([...TERMINAL, "approved", "partially_approved", "final_approved"]);

type Row = NonNullable<Awaited<ReturnType<typeof PreauthRepository.findScoped>>>;

const money = (n: number | undefined) => (n === undefined ? null : n.toFixed(2));

/** Which side of the workflow the caller acts on for this request (or null: read-only). */
export function sideOf(p: Principal, r: Row["preauth"]): Side | null {
  // An insurer / TPA that raised this request on the hospital's behalf prepares it as the hospital desk would,
  // but only while it is a draft; after submission it is reviewed like any other request.
  if (isRaiser(p, r) && r.status === "draft") return "hospital";
  if (p.orgType === "insurer" && r.insurerId === p.organizationId && scopeFor(p, "preauth:review")) return "payer";
  if (p.orgType === "tpa" && r.tpaId === p.organizationId && scopeFor(p, "preauth:review")) return "payer";
  if (p.orgType === "hospital" && p.roleKey !== "patient" && r.hospitalId === p.organizationId && scopeFor(p, "preauth:create")) {
    return "hospital";
  }
  return null;
}

/** The caller's organization raised this request (New Claim wizard) and may still raise requests. */
export function isRaiser(p: Principal, r: Pick<Row["preauth"], "raisedByOrgId">): boolean {
  return !!r.raisedByOrgId && r.raisedByOrgId === p.organizationId && (p.orgType === "insurer" || p.orgType === "tpa") && !!scopeFor(p, "preauth:raise");
}

/** The caller as a payer that may raise requests (insurer / TPA reviewer with preauth:raise), or refused. */
function raisingPayer(p: Principal): { orgType: "insurer" | "tpa"; orgId: string } {
  requirePermission(p, "preauth:raise");
  if (p.orgType !== "insurer" && p.orgType !== "tpa") throw new ForbiddenError("New claims are raised by an insurer or TPA reviewer for their own members.");
  return { orgType: p.orgType, orgId: p.organizationId };
}

/** The insurer / TPA chosen at KYC must be the member's own (the case is filed against the policy on record). */
function assertSamePayer(kyc: WizardKyc, m: MemberRow) {
  if (kyc.insurerId !== m.insurerId) throw new ValidationError(`This member's policy is with ${m.insurerName ?? "another insurer"}.`, { insurerId: ["Not the member's insurer."] });
  if (kyc.tpaId && kyc.tpaId !== m.tpaId) throw new ValidationError(`This member's policy is run by ${m.tpaName ?? "no TPA"}.`, { tpaId: ["Not the member's TPA."] });
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
  // New Claim wizard extras, kept with the clinical record.
  if (d.treatmentType) clinical.treatmentType = d.treatmentType;
  if (d.admissionType) clinical.admissionType = d.admissionType;
  if (d.icuDays !== undefined) clinical.icuDays = d.icuDays;
  if (d.ailmentDurationDays !== undefined) clinical.ailmentDurationDays = d.ailmentDurationDays;
  if (d.chronicIllness?.length) clinical.chronicIllness = d.chronicIllness;
  if (d.dischargeDate) clinical.dischargeDate = d.dischargeDate;
  if (d.costItems?.length) clinical.costItems = d.costItems;
  if (d.packageAmount !== undefined) clinical.packageAmount = d.packageAmount;
  // All diagnoses, primary first; the primary is the request's diagnosis.
  if (d.diagnosisIds?.length) {
    clinical.diagnosisIds = d.diagnosisIds;
    d = { ...d, diagnosisId: d.diagnosisIds[0] };
  }
  // The expected cost is the package amount, or the heads' total; the stay length comes from its start and end.
  const cost = d.costItems?.length || d.packageAmount !== undefined ? expectedCost(d.costItems, d.packageAmount) : null;
  if (cost !== null) d = { ...d, estimatedCost: cost };
  // The room-rent rule reads the per-day room rate: taken from the "Room rent" head when not entered separately.
  const roomHead = d.costItems?.find((i) => i.head === "Room rent");
  if (d.roomRentPerDay === undefined && roomHead) d = { ...d, roomRentPerDay: roomHead.perDay };
  const days = stayDays(d.admissionDate, d.admissionTime, d.dischargeDate, d.dischargeTime);
  if (days !== null) d = { ...d, expectedStayDays: days };
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

/** Cost lines as stored; lines from the earlier itemized table (description × quantity × amount) are read as heads. */
function storedCostItems(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.map((i: Record<string, unknown>) => ("head" in i ? i : { head: "Other", description: i.description, perDay: i.amount, days: i.quantity }));
}

/** The stored request as the details form's values (the inverse of detailsToColumns). */
export function storedDetails(p: Row["preauth"]): PreauthDetailsInput {
  const c = p.clinical as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const tri = (v: unknown) => (v === "yes" || v === "no" ? v : "unknown");
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const out: Record<string, unknown> = {
    claimType: p.claimType,
    diagnosisId: p.diagnosisId ?? undefined,
    diagnosisIds: Array.isArray(c.diagnosisIds) ? c.diagnosisIds : p.diagnosisId ? [p.diagnosisId] : [],
    procedureId: p.procedureId ?? undefined,
    admissionDate: p.expectedAdmission ?? undefined,
    dischargeDate: str(c.dischargeDate),
    isAccident: tri(c.isAccident),
    pedDeclared: tri(c.pedDeclared),
    pedRelated: tri(c.pedRelated),
    expectedStayDays: p.expectedStayDays ?? undefined,
    roomCategory: p.roomCategory ?? undefined,
    roomRentPerDay: p.roomRentPerDay ?? undefined,
    treatmentType: str(c.treatmentType),
    admissionType: str(c.admissionType),
    icuDays: num(c.icuDays),
    ailmentDurationDays: num(c.ailmentDurationDays),
    chronicIllness: Array.isArray(c.chronicIllness) ? c.chronicIllness : [],
    costItems: storedCostItems(c.costItems),
    packageAmount: c.packageAmount ?? undefined,
  };
  if (!Array.isArray(c.costItems) && c.packageAmount === undefined && p.estimatedCost !== null) out.estimatedCost = p.estimatedCost;
  for (const k of CLINICAL_FIELDS) if (str(c[k])) out[k] = c[k];
  return out as PreauthDetailsInput;
}

/** KYC & Policy as recorded on the case (null before it was captured). */
export function storedKyc(p: Row["preauth"]): StoredKyc | null {
  const k = (p.clinical as Record<string, unknown>).kyc;
  return k && typeof k === "object" ? (k as StoredKyc) : null;
}

/** KYC as kept with the case: the Aadhaar (if given) only as a keyed hash and its last 4 digits, never in full. */
export type StoredKyc = Omit<WizardKyc, "aadhaar"> & { aadhaarHash?: string; aadhaarLast4?: string };

/** A blank Aadhaar keeps the one already on the case. */
function kycForStorage(k: WizardKyc, prev?: StoredKyc | null): StoredKyc {
  const { aadhaar, ...rest } = k;
  const a = aadhaarColumns(aadhaar);
  if (a) return { ...rest, ...a };
  return prev?.aadhaarHash ? { ...rest, aadhaarHash: prev.aadhaarHash, aadhaarLast4: prev.aadhaarLast4 } : rest;
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
  async list(ctx: ServiceContext, q: ListQuery, f: { status?: PreauthStatus[]; insurerId?: string; tpaId?: string; hospitalId?: string }) {
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
    // Tell the hospital when the request's insurer / TPA has nobody who can review it (it would otherwise just sit unseen).
    const payerIds = [row.preauth.insurerId, row.preauth.tpaId].filter((x): x is string => !!x);
    const payersWithoutReviewer = side === "hospital" && !TERMINAL_STATUSES.has(status) ? await PreauthRepository.payersWithoutReviewers(ctx.db, payerIds) : [];
    return {
      ...row,
      payersWithoutReviewer,
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
      // A pre-authorization asks the payer to cover an admission now, so the cover period must be
      // current. Expired or not-yet-started cover is a record problem to fix (or a different cover to
      // add) rather than something to send to the payer; the rules engine judges everything else.
      const period = coverPeriodStatus(cov, todayIso());
      if (period !== "in_force") {
        throw new ValidationError(
          period === "expired"
            ? `This cover ended on ${cov.coverEnd}, so a pre-authorization can't be raised on it. Record the patient's current coverage (upload the insurance document or add it manually) and check eligibility again.`
            : `This cover starts on ${cov.coverStart}, so a pre-authorization can't be raised on it yet. Record the coverage the patient is insured under today.`,
          { beneficiaryId: ["The cover period is not current."] },
        );
      }
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

  /** New Claim wizard, step 1: the payer's own members matching a UHID / member ID / name (at least 2 characters). */
  async members(ctx: ServiceContext, q: string, opts: { limit?: number } = {}) {
    const payer = raisingPayer(ctx.principal);
    const term = q.trim().slice(0, 100);
    if (term.length < 2) return [];
    // A full Aadhaar is compared by its keyed hash only (never stored or logged); the lookup itself is audited.
    const digits = aadhaarDigits(term);
    const hash = /^\d{12}$/.test(digits) ? aadhaarHash(digits) : undefined;
    const rows = await PreauthRepository.findMembers(ctx.db, payer, term, { limit: opts.limit, aadhaarHash: hash });
    if (hash) {
      await AuditService.record(ctx.db, { ...actorOf(ctx), action: "patient.aadhaar_lookup", resourceType: "patient", newState: { last4: digits.slice(-4), matches: rows.length } });
    }
    return rows;
  },

  /** New Claim wizard: one of the payer's members (refused if the coverage isn't under its own policies). */
  async member(ctx: ServiceContext, beneficiaryId: string) {
    const m = await PreauthRepository.member(ctx.db, raisingPayer(ctx.principal), requireId(beneficiaryId, "Member"));
    if (!m) throw new NotFoundError("Member not found among your policies.");
    return m;
  },

  /** New Claim, KYC & Policy: the Insurer / TPA dropdowns (the payer's own insurers and their TPAs). */
  async kycOptions(ctx: ServiceContext) {
    return PreauthRepository.kycOptions(ctx.db, raisingPayer(ctx.principal));
  },

  /**
   * New Claim, KYC & Policy → a cashless draft case raised by the insurer / TPA on the patient's hospital's
   * behalf. Only for a member of its own policies with cover in force today (found with Find, or identified by a
   * unique member ID); the insurer / TPA chosen must be the member's own. The typed KYC is kept with the case and
   * compared with the record by the checks. The hospital is the patient's own and is told.
   */
  async raise(ctx: ServiceContext, input: unknown) {
    const payer = raisingPayer(ctx.principal);
    const d = parseOrThrow(wizardRaiseSchema, input);
    return ctx.db.transaction(async (tx) => {
      let m: MemberRow | undefined;
      if (d.beneficiaryId) m = await PreauthRepository.member(tx, payer, d.beneficiaryId);
      else if (d.kyc.memberId) {
        const found = await PreauthRepository.membersByMemberId(tx, payer, d.kyc.memberId);
        if (found.length === 1) m = found[0];
      }
      if (!m) {
        throw new ValidationError("Find the member first: cases are raised only for members of your policies on record.", { uhid: ["Use Find to pick the member."] });
      }
      assertSamePayer(d.kyc, m);
      const period = coverPeriodStatus({ coverStart: m.coverStart, coverEnd: m.coverEnd }, todayIso());
      if (period !== "in_force") {
        throw new ValidationError(
          period === "expired" ? `This cover ended on ${m.coverEnd}; a cashless case can't be raised on it.` : `This cover starts on ${m.coverStart}; a cashless case can't be raised on it yet.`,
          { policyTo: ["The cover period is not current."] },
        );
      }
      const policy = await PolicyRepository.get(tx, m.policyId);
      if (!policy) throw new ValidationError("The member's policy is no longer available.");
      const cols = detailsToColumns(parseOrThrow(preauthDetailsSchema, { claimType: "cashless" }));
      const row = await PreauthRepository.insert(tx, {
        reference: reference(),
        hospitalId: m.hospitalId,
        patientId: m.patientId,
        beneficiaryId: m.beneficiaryId,
        policyId: policy.id,
        insurerId: policy.insurerId,
        tpaId: policy.tpaId,
        schemeId: policy.schemeId,
        status: "draft",
        ...cols,
        clinical: { ...cols.clinical, kyc: kycForStorage(d.kyc) },
        createdBy: ctx.principal.userId,
        raisedByOrgId: payer.orgId,
      });
      await PreauthRepository.insertHistory(tx, {
        subjectType: "preauth", subjectId: row.id, fromStatus: null, toStatus: "draft",
        message: "Case raised by the insurer / TPA on the hospital's behalf (New Claim)",
        requiredAction: "Register the package, add the papers and run the checks, then submit", responsibleTeam: "Insurer / TPA (raised on the hospital's behalf)", actorUserId: ctx.principal.userId,
      });
      await AuditService.record(tx, {
        ...actorOf(ctx), action: "preauth.raised_by_payer", resourceType: "preauth", resourceId: row.id,
        newState: { reference: row.reference, policyId: policy.id, hospitalId: m.hospitalId, kycMode: d.kyc.mode, ...auditView(row) },
      });
      await NotificationService.toOrganizations(tx, [m.hospitalId], {
        kind: "preauth.raised",
        title: `Pre-authorization ${row.reference} is being prepared for your patient`,
        body: "The patient's insurer / TPA started a cashless case on your hospital's behalf.",
        resourceType: "preauth",
        resourceId: row.id,
      }, ctx.principal.userId);
      return row;
    });
  },

  /** New Claim: corrects KYC & Policy on a draft the caller's organization raised. */
  async saveKyc(ctx: ServiceContext, id: string, input: unknown) {
    const payer = raisingPayer(ctx.principal);
    const kyc = parseOrThrow(wizardKycSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      if (row.preauth.raisedByOrgId !== payer.orgId) throw new NotFoundError("Pre-authorization not found.");
      requireSide(ctx, row, "hospital");
      if (row.preauth.status !== "draft") throw new ConflictError("KYC can only be changed on a draft.");
      const m = await PreauthRepository.member(tx, payer, row.preauth.beneficiaryId);
      if (!m) throw new NotFoundError("Member not found among your policies.");
      assertSamePayer(kyc, m);
      await PreauthRepository.update(tx, row.preauth.id, { clinical: { ...(row.preauth.clinical as Record<string, unknown>), kyc: kycForStorage(kyc, storedKyc(row.preauth)) }, latestEvaluationId: null });
      await AuditService.record(tx, { ...actorOf(ctx), action: "preauth.kyc_updated", resourceType: "preauth", resourceId: row.preauth.id, newState: { kycMode: kyc.mode } });
    });
  },

  /** New Claim, Clinical Details & Package: the step's required fields, then the normal update. */
  async saveClinical(ctx: ServiceContext, id: string, input: unknown) {
    parseOrThrow(wizardClinicalSchema, input);
    return PreauthService.update(ctx, id, input);
  },

  /**
   * AI Pre-Scrutiny quick fix: the given Clinical Details & Package fields merged into the stored case (nothing else
   * changes), saved through the normal update (audited, and the last engine run is cleared so it is re-run).
   */
  async quickFix(ctx: ServiceContext, id: string, input: unknown) {
    const payer = raisingPayer(ctx.principal);
    const patch = parseOrThrow(quickFixSchema, input);
    const row = await load(ctx, id);
    if (row.preauth.raisedByOrgId !== payer.orgId) throw new NotFoundError("Pre-authorization not found.");
    const updated = await PreauthService.update(ctx, id, { ...storedDetails(row.preauth), ...patch });
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "preauth.quick_fix", resourceType: "preauth", resourceId: row.preauth.id, newState: { fields: Object.keys(patch) } });
    return updated;
  },

  /** New Claim: drafts this insurer / TPA raised and can resume. */
  async raisedDrafts(ctx: ServiceContext) {
    return PreauthRepository.raisedDrafts(ctx.db, raisingPayer(ctx.principal).orgId);
  },

  /**
   * Everything the New Claim wizard shows for a draft its caller's organization raised: the stored details and
   * KYC, the member, papers with their MUST / EXPECTED / OPTIONAL tiers, the checklist and the deterministic pre-scrutiny.
   */
  async wizard(ctx: ServiceContext, id: string) {
    const payer = raisingPayer(ctx.principal);
    const row = await load(ctx, id);
    if (row.preauth.raisedByOrgId !== payer.orgId) throw new NotFoundError("Pre-authorization not found.");
    const today = todayIso();
    const details = storedDetails(row.preauth);
    const kyc = storedKyc(row.preauth);
    const diagnosisIds = (details.diagnosisIds as string[] | undefined) ?? [];
    const [docs, usable, cl, ruleDocs, member, diagnoses] = await Promise.all([
      DocumentRepository.forSubject(ctx.db, "preauth", row.preauth.id),
      DocumentRepository.usableTypes(ctx.db, "preauth", row.preauth.id),
      checklistFor(ctx.db, row),
      requiredDocumentsFor(ctx.db, row.preauth.policyId, "preauth", today),
      PreauthRepository.member(ctx.db, payer, row.preauth.beneficiaryId),
      ClinicalRepository.diagnosesByIds(ctx.db, diagnosisIds),
    ]);
    const clinical = wizardClinicalSchema.safeParse(details);
    const newborn = isNewborn(row.patient.dob, row.preauth.expectedAdmission ?? today);
    const requirements = wizardDocuments(ruleDocs, usable, { newborn });
    const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
    const scrutiny = scrutinize({
      evaluated: !!cl.loaded,
      clinicalIssues: clinical.success ? [] : clinical.error.issues.map((i) => ({ field: String(i.path[0] ?? "details"), message: i.message })),
      documents: requirements,
      checklist: cl.checklist,
      estimatedCost: num(row.preauth.estimatedCost),
      availableBalance: num(row.beneficiary.sumInsuredAvailable),
      admissionType: details.admissionType as string | undefined,
      admissionDate: row.preauth.expectedAdmission,
      today,
      kyc,
      record: {
        fullName: row.patient.fullName,
        gender: row.patient.gender,
        dob: row.patient.dob,
        memberId: row.beneficiary.memberId,
        coverStart: row.beneficiary.coverStart,
        coverEnd: row.beneficiary.coverEnd,
        sumInsured: num(row.beneficiary.sumInsured),
        policyHasTpa: !!row.preauth.tpaId,
        aadhaarHash: row.patient.aadhaarHash,
      },
      diagnosisCodes: diagnoses.map((x) => x.code),
    });
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "preauth.viewed", resourceType: "preauth", resourceId: row.preauth.id, newState: { via: "new_claim" } });
    return {
      ...row,
      member: member ?? null,
      details,
      kyc,
      diagnoses,
      clinicalComplete: clinical.success,
      documents: docs,
      requirements,
      policyHasDocumentRules: ruleDocs !== null,
      checklist: cl.checklist,
      evaluation: cl.loaded,
      scrutiny,
      editable: row.preauth.status === "draft",
    };
  },

  /**
   * New Claim, Submit. The checks are re-run on the server first. The case details must be complete; any
   * other gap (a missing paper, a failed or unverified check, a KYC mismatch) can be sent only with the reviewer's
   * acknowledgment, which is written to the audit trail with the submission. The payer still decides.
   */
  async wizardSubmit(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(wizardSubmitSchema, input);
    await PreauthService.runChecks(ctx, id);
    const w = await PreauthService.wizard(ctx, id);
    if (!w.editable) throw new InvalidTransitionError("Only drafts can be submitted.");
    if (w.scrutiny.blocking) {
      throw new ValidationError(`Complete Clinical Details & Package first: ${w.scrutiny.findings.filter((f) => f.key.startsWith("clinical:")).map((f) => f.explanation).join(" ")}`);
    }
    const gaps = w.scrutiny.findings;
    if (gaps.length && !d.acknowledged) {
      throw new ValidationError(`Tick the acknowledgment to send with ${gaps.length} unresolved ${gaps.length === 1 ? "gap" : "gaps"}.`, { acknowledged: ["Required."] });
    }
    const acknowledgment = gaps.length ? gapsAcknowledgment(gaps.length) : null;
    const updated = await PreauthService.submit(ctx, id, { overrideReason: acknowledgment ?? undefined }, { acknowledgedGaps: gaps.map((f) => f.key) });
    await AuditService.record(ctx.db, {
      ...actorOf(ctx),
      action: "preauth.wizard_submitted",
      resourceType: "preauth",
      resourceId: w.preauth.id,
      newState: {
        acknowledgment,
        acknowledgedGaps: gaps.map((f) => ({ key: f.key, severity: f.severity, title: f.title })),
        channel: "claimix",
        onBehalfOfHospital: w.preauth.hospitalId,
      },
    });
    return updated;
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(preauthDetailsSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await load(ctx, id, { forUpdate: true, db: tx });
      requireSide(ctx, row, "hospital");
      if (!HOSPITAL_EDITABLE.has(row.preauth.status as PreauthStatus)) throw new ConflictError("This request can't be edited in its current status.");
      const cols = detailsToColumns(d);
      // KYC & Policy and the case registration (Register Case) are captured separately and kept across detail saves.
      const kyc = storedKyc(row.preauth);
      if (kyc) cols.clinical.kyc = kyc;
      const registration = (row.preauth.clinical as Record<string, unknown>).registration;
      if (registration) cols.clinical.registration = registration;
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
  async submit(ctx: ServiceContext, id: string, input: unknown, opts: { acknowledgedGaps?: string[] } = {}) {
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

      // New Claim only (never from the browser): the reviewer acknowledged the open items as gaps.
      const acknowledged = !!opts.acknowledgedGaps?.length;
      if (!checklist.canSubmit && !acknowledged) {
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
      // Raised by an insurer / TPA: the hospital is told a request was submitted for its patient.
      if (row.preauth.raisedByOrgId) {
        await NotificationService.toOrganizations(tx, [row.preauth.hospitalId], {
          kind: "preauth.raised_submitted",
          title: `Pre-authorization ${row.preauth.reference} was submitted on your hospital's behalf`,
          body: "Raised by the patient's insurer / TPA through the New Claim wizard. Respond to any queries from the request page.",
          resourceType: "preauth",
          resourceId: row.preauth.id,
        }, ctx.principal.userId);
      }
      if (!checklist.canSubmit) {
        await AuditService.record(tx, {
          ...actorOf(ctx), action: "preauth.submitted_with_acknowledged_gaps", resourceType: "preauth", resourceId: row.preauth.id,
          newState: { incomplete: checklist.incomplete.map((i) => i.key), acknowledgedGaps: opts.acknowledgedGaps },
        });
      }
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
      // Maker-checker: a request an insurer raised itself is decided by a different reviewer.
      if (row.preauth.raisedByOrgId && row.preauth.createdBy === ctx.principal.userId) {
        throw new ForbiddenError("You raised this request, so another reviewer in your organization must decide it.");
      }
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
