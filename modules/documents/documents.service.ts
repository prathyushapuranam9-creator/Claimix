import "server-only";
import { randomUUID } from "node:crypto";
import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission, scopeFor } from "@/lib/permissions/principal";
import type { ListQuery } from "@/lib/pagination";
import { DocumentQueries, type DocStatus } from "./documents.queries";
import { validateUpload } from "@/lib/security/file-validation";
import { sha256Hex } from "@/lib/security/crypto";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { PreauthRepository } from "@/modules/preauth/preauth.repository";
import { isRaiser } from "@/modules/preauth/preauth.service";
import { DOCUMENTS_ALLOWED, HOSPITAL_EDITABLE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { ClaimRepository } from "@/modules/claims/claims.repository";
import { CLAIM_DOCUMENTS_ALLOWED, CLAIM_EDITABLE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { PatientRepository } from "@/modules/patients/patients.repository";
import { documentLabel, DOCUMENT_TYPES, INSURANCE_DOCUMENT_TYPES, isInsuranceDocumentType } from "./document-types";
import { documentReviewSchema } from "./documents.validation";
import { NotificationService } from "@/modules/notifications/notifications.service";
import { JobQueue } from "@/modules/jobs/job-queue";

const CLOSED = new Set(["rejected", "cancelled", "settled"]);
import { DocumentRepository } from "./documents.repository";
import { basicScanner, type Scanner } from "./scanner";
import { getStorage } from "./storage";

export interface UploadFile {
  name: string;
  size: number;
  bytes: Uint8Array;
}

export interface UploadInput {
  subjectType: "preauth" | "claim";
  subjectId: string;
  docType: string;
  file: UploadFile;
}

/** Stage A: an insurance / coverage document filed against the patient, not against a request. */
export interface InsuranceUploadInput {
  docType: string;
  file: UploadFile;
}

let scanner: Scanner = basicScanner;
export function setScannerForTests(s: Scanner | undefined) {
  scanner = s ?? basicScanner;
}

interface Subject {
  type: "preauth" | "claim";
  id: string;
  hospitalId: string;
  patientId: string;
  status: string;
  acceptsDocuments: boolean;
  /** The caller is the insurer / TPA that raised this draft (New Claim wizard) and files documents for the hospital. */
  raisedByCaller: boolean;
  /** Clears a draft's rules check when new evidence arrives. */
  invalidate: (tx: DbOrTx) => Promise<unknown>;
}

/** Resolves the request a document belongs to, within the caller's hospital-side scope. */
async function resolveSubject(ctx: ServiceContext, type: UploadInput["subjectType"], id: string): Promise<Subject> {
  if (type === "claim") {
    const r = await ClaimRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "claim:create"), requireId(id, "Claim"));
    if (!r) throw new NotFoundError("Claim not found.");
    return {
      type, id: r.claim.id, hospitalId: r.claim.hospitalId, patientId: r.claim.patientId, status: r.claim.status,
      acceptsDocuments: CLAIM_DOCUMENTS_ALLOWED.has(r.claim.status as ClaimStatus),
      raisedByCaller: false,
      invalidate: (tx) => (r.claim.status === "draft" ? ClaimRepository.update(tx, r.claim.id, { latestEvaluationId: null }) : Promise.resolve()),
    };
  }
  // An insurer / TPA only ever files documents on a draft it raised itself; everyone else is the hospital side.
  const payer = ctx.principal.orgType === "insurer" || ctx.principal.orgType === "tpa";
  const r = await PreauthRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, payer ? "preauth:read" : "preauth:create"), requireId(id, "Pre-authorization"));
  // A payer gets the same refusal as before the New Claim wizard existed, whether or not it can see the request.
  if (!r) throw payer ? new ForbiddenError("Documents are added by the treating hospital.") : new NotFoundError("Pre-authorization not found.");
  const raisedByCaller = payer && isRaiser(ctx.principal, r.preauth) && r.preauth.status === "draft";
  if (payer && !raisedByCaller) throw new ForbiddenError("Documents are added by the treating hospital.");
  return {
    raisedByCaller,
    type, id: r.preauth.id, hospitalId: r.preauth.hospitalId, patientId: r.preauth.patientId, status: r.preauth.status,
    acceptsDocuments: DOCUMENTS_ALLOWED.has(r.preauth.status as PreauthStatus),
    invalidate: (tx) => (r.preauth.status === "draft" ? PreauthRepository.update(tx, r.preauth.id, { latestEvaluationId: null }) : Promise.resolve()),
  };
}

/**
 * Validate size, extension and real content type, scan, generate a safe key and store privately.
 * Shared by both upload paths, so a coverage document goes through exactly the same checks as a
 * treatment document. `blockedOn` only names the resource an upload-blocked audit entry points at.
 */
async function checkScanAndStore(ctx: ServiceContext, docType: string, f: UploadFile, blockedOn: { resourceType: string; resourceId: string }) {
  const check = validateUpload(f);
  if (!check.ok) throw new ValidationError(check.error, { file: [check.error] });

  const verdict = await scanner.scan(f.bytes, check.kind);
  if (verdict.status === "infected") {
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "document.upload_blocked", ...blockedOn, newState: { reason: verdict.reason, docType } });
    throw new ValidationError(`This file was blocked by the security scan: ${verdict.reason}`, { file: ["Blocked by security scan."] });
  }

  const storageKey = `${randomUUID()}.${check.ext}`;
  await getStorage().put(storageKey, f.bytes, check.mime);
  return {
    status: "uploaded" as const,
    scanStatus: "clean" as const,
    originalName: check.displayName,
    storageKey,
    mimeType: check.mime,
    sizeBytes: f.bytes.length,
    sha256: sha256Hex(Buffer.from(f.bytes)),
    uploadedBy: ctx.principal.userId,
  };
}

export const DocumentService = {
  /**
   * Upload pipeline: authenticate (ctx) → authorize (permission + subject scope) →
   * validate size, extension and real content type → scan → generate a safe key →
   * store privately → record + audit.
   */
  async upload(ctx: ServiceContext, input: UploadInput) {
    const docDef = DOCUMENT_TYPES[input.docType];
    if (!docDef) throw new ValidationError("Choose a document type.", { docType: ["Choose a document type."] });

    // The subject decides the patient and owning hospital — never the client.
    const subject = await resolveSubject(ctx, input.subjectType, input.subjectId);
    if (!subject.raisedByCaller) {
      const scope = requirePermission(ctx.principal, "document:upload");
      if (scope !== "all" && (ctx.principal.orgType !== "hospital" || subject.hospitalId !== ctx.principal.organizationId)) throw new ForbiddenError();
    }
    if (!subject.acceptsDocuments) throw new ValidationError("Documents can't be added in the current status.");

    const stored = await checkScanAndStore(ctx, input.docType, input.file, { resourceType: subject.type, resourceId: subject.id });

    return ctx.db.transaction(async (tx) => {
      const row = await DocumentRepository.insert(tx, {
        organizationId: subject.hospitalId,
        patientId: subject.patientId,
        subjectType: subject.type,
        subjectId: subject.id,
        category: docDef.category,
        docType: input.docType,
        ...stored,
      });
      // New evidence invalidates a draft's rules check (it feeds the checklist). After
      // submission, the evaluation the request was submitted with is kept as the record.
      await subject.invalidate(tx);
      // Deeper asynchronous scan (e.g. an antivirus engine) runs in the background worker.
      await JobQueue.enqueue(tx, "document.scan", { documentId: row.id });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "document.uploaded",
        resourceType: "document",
        resourceId: row.id,
        newState: { subjectType: subject.type, subjectId: subject.id, docType: input.docType, sizeBytes: row.sizeBytes, sha256: row.sha256, ...(subject.raisedByCaller ? { onBehalfOfHospital: subject.hospitalId } : {}) },
      });
      return row;
    });
  },

  /**
   * Stage A: an insurance card, policy copy or scheme enrolment document for one patient. It is filed
   * against the patient alone (no pre-auth or claim), so it can be collected before any request
   * exists, and it is never required in order to record coverage - it only helps fill and confirm it.
   *
   * The patient is resolved inside the caller's own scope and decides the owning hospital, so a
   * document can never land on another hospital's or another patient's record.
   */
  async uploadInsuranceDocument(ctx: ServiceContext, patientId: string, input: InsuranceUploadInput) {
    const scope = requirePermission(ctx.principal, "document:upload");
    requirePermission(ctx.principal, "patient:write");
    if (!isInsuranceDocumentType(input.docType)) {
      throw new ValidationError("Choose an insurance document type.", { docType: [`Choose one of: ${INSURANCE_DOCUMENT_TYPES.map(documentLabel).join(", ")}.`] });
    }
    const found = await PatientRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "patient:read"), requireId(patientId, "Patient"));
    if (!found) throw new NotFoundError("Patient not found.");
    const patient = found.patient;
    if (scope !== "all" && (ctx.principal.orgType !== "hospital" || patient.hospitalId !== ctx.principal.organizationId)) throw new ForbiddenError();

    const stored = await checkScanAndStore(ctx, input.docType, input.file, { resourceType: "patient", resourceId: patient.id });

    return ctx.db.transaction(async (tx) => {
      const row = await DocumentRepository.insert(tx, {
        organizationId: patient.hospitalId,
        patientId: patient.id,
        subjectType: null,
        subjectId: null,
        category: DOCUMENT_TYPES[input.docType]!.category,
        docType: input.docType,
        ...stored,
      });
      await JobQueue.enqueue(tx, "document.scan", { documentId: row.id });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "document.uploaded",
        resourceType: "document",
        resourceId: row.id,
        newState: { stage: "insurance", patientId: patient.id, docType: input.docType, sizeBytes: row.sizeBytes, sha256: row.sha256 },
      });
      return row;
    });
  },

  /** The patient's insurance / coverage documents (Stage A), inside the caller's patient scope. */
  async insuranceDocuments(ctx: ServiceContext, patientId: string) {
    requirePermission(ctx.principal, "document:read");
    const found = await PatientRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "patient:read"), requireId(patientId, "Patient"));
    if (!found) throw new NotFoundError("Patient not found.");
    return DocumentRepository.insuranceForPatient(ctx.db, found.patient.id);
  },

  /** The patient's saved case registration forms (signed PDFs from Register Case) the caller may see. */
  async registrationForms(ctx: ServiceContext, patientId: string) {
    const scope = requirePermission(ctx.principal, "document:read");
    const found = await PatientRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "patient:read"), requireId(patientId, "Patient"));
    if (!found) throw new NotFoundError("Patient not found.");
    return DocumentRepository.registrationForms(ctx.db, ctx.principal, scope, found.patient.id);
  },

  async forPreauth(ctx: ServiceContext, preauthId: string) {
    requirePermission(ctx.principal, "document:read");
    const subject = await PreauthRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "preauth:read"), requireId(preauthId, "Pre-authorization"));
    if (!subject) throw new NotFoundError("Pre-authorization not found.");
    return DocumentRepository.forSubject(ctx.db, "preauth", preauthId);
  },

  /**
   * Hospital staff remove a document they uploaded by mistake. Only the owning hospital can, only while the
   * request is still the hospital's to edit (a draft, or a query waiting for its answer), never once the payer
   * has verified the document, and never a document a recorded coverage was filled from.
   */
  async remove(ctx: ServiceContext, id: string) {
    // An insurer / TPA may only remove what it uploaded to a draft it raised (checked through the subject below).
    const payer = ctx.principal.orgType === "insurer" || ctx.principal.orgType === "tpa";
    const scope = requirePermission(ctx.principal, payer ? "document:read" : "document:upload");
    const doc = await DocumentRepository.findScoped(ctx.db, ctx.principal, scope, requireId(id, "Document"));
    if (!doc) throw new NotFoundError("Document not found.");
    if (payer) {
      if (doc.subjectType !== "preauth" || doc.uploadedBy !== ctx.principal.userId) throw new ForbiddenError();
    } else if (scope !== "all" && (ctx.principal.orgType !== "hospital" || doc.organizationId !== ctx.principal.organizationId)) throw new ForbiddenError();
    if (doc.status === "verified") throw new ValidationError("A document the payer has verified can't be deleted.");

    let invalidate: ((tx: DbOrTx) => Promise<unknown>) | null = null;
    if (doc.subjectType === "preauth" || doc.subjectType === "claim") {
      const subject = await resolveSubject(ctx, doc.subjectType, doc.subjectId!);
      const editable = doc.subjectType === "claim" ? CLAIM_EDITABLE.has(subject.status as ClaimStatus) : HOSPITAL_EDITABLE.has(subject.status as PreauthStatus);
      if (!editable) throw new ValidationError("Documents can't be deleted once the request has been sent to the payer. Upload a corrected document instead.");
      invalidate = subject.invalidate;
    } else if (await DocumentRepository.usedByCoverage(ctx.db, doc.id)) {
      throw new ValidationError("This document was used to fill in a coverage, so it can't be deleted.");
    }

    return ctx.db.transaction(async (tx) => {
      await DocumentRepository.softDelete(tx, doc.id);
      if (invalidate) await invalidate(tx);
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "document.deleted",
        resourceType: "document",
        resourceId: doc.id,
        previousState: { docType: doc.docType, name: doc.originalName, status: doc.status, subjectType: doc.subjectType, subjectId: doc.subjectId },
      });
    });
  },

  /** Authorized, audited download. Only files that passed scanning are served. */
  async download(ctx: ServiceContext, id: string) {
    const scope = requirePermission(ctx.principal, "document:read");
    const doc = await DocumentRepository.findScoped(ctx.db, ctx.principal, scope, requireId(id, "Document"));
    if (!doc) throw new NotFoundError("Document not found.");
    if (doc.scanStatus !== "clean") throw new ForbiddenError("This document is not available until its security scan has passed.");
    const bytes = await getStorage().get(doc.storageKey);
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "document.accessed", resourceType: "document", resourceId: doc.id, newState: { subjectType: doc.subjectType, subjectId: doc.subjectId } });
    return { bytes, mimeType: doc.mimeType, name: doc.originalName };
  },

  /**
   * Payer review of a document: verify, reject, or ask for a re-upload (with a
   * reason). Only the insurer/TPA assigned to the request can do this, and only
   * while the request is open. Rejected / re-upload documents stop counting as
   * evidence, so the rules flag them as missing again.
   */
  async review(ctx: ServiceContext, id: string, input: unknown) {
    const d = parseOrThrow(documentReviewSchema, input);
    const scope = requirePermission(ctx.principal, "document:verify");
    if (ctx.principal.orgType !== "insurer" && ctx.principal.orgType !== "tpa") throw new ForbiddenError("Documents are verified by the reviewing insurer or TPA.");
    return ctx.db.transaction(async (tx) => {
      const doc = await DocumentRepository.findScoped(tx, ctx.principal, scope, requireId(id, "Document"));
      if (!doc || !doc.subjectType || !doc.subjectId) throw new NotFoundError("Document not found.");
      const subjectStatus = await DocumentRepository.subjectStatus(tx, doc.subjectType as "preauth" | "claim", doc.subjectId);
      if (!subjectStatus || CLOSED.has(subjectStatus)) throw new ValidationError("Documents on a closed request can't be reviewed.");
      const row = await DocumentRepository.setStatus(tx, doc.id, { status: d.status, statusNote: d.note ?? null, verifiedBy: ctx.principal.userId, verifiedAt: new Date() });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: `document.${d.status}`,
        resourceType: "document",
        resourceId: doc.id,
        previousState: { status: doc.status },
        newState: { status: d.status, note: d.note ?? null, subjectType: doc.subjectType, subjectId: doc.subjectId },
      });
      if (d.status !== "verified") {
        await NotificationService.toOrganizations(tx, [doc.organizationId], {
          kind: d.status === "requires_reupload" ? "document.reupload_required" : "document.rejected",
          title: `${documentLabel(doc.docType)}: ${d.status === "requires_reupload" ? "re-upload required" : "rejected"}`,
          body: d.note ?? undefined,
          resourceType: doc.subjectType,
          resourceId: doc.subjectId,
        });
      }
      return row;
    });
  },
};

/** Document listings (scoped). */
export const DocumentListService = {
  async list(ctx: ServiceContext, q: ListQuery, f: { status?: DocStatus; subjectType?: "preauth" | "claim" }) {
    const scope = requirePermission(ctx.principal, "document:read");
    return DocumentQueries.list(ctx.db, ctx.principal, scope, q, f);
  },

  async missing(ctx: ServiceContext) {
    return DocumentQueries.missing(ctx.db, ctx.principal, scopeFor(ctx.principal, "preauth:read"), scopeFor(ctx.principal, "claim:read"));
  },
};
