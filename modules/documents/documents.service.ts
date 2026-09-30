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
import { DOCUMENTS_ALLOWED, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { ClaimRepository } from "@/modules/claims/claims.repository";
import { CLAIM_DOCUMENTS_ALLOWED, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { documentLabel, DOCUMENT_TYPES } from "./document-types";
import { documentReviewSchema } from "./documents.validation";
import { NotificationService } from "@/modules/notifications/notifications.service";
import { JobQueue } from "@/modules/jobs/job-queue";

const CLOSED = new Set(["rejected", "cancelled", "settled"]);
import { DocumentRepository } from "./documents.repository";
import { basicScanner, type Scanner } from "./scanner";
import { getStorage } from "./storage";

export interface UploadInput {
  subjectType: "preauth" | "claim";
  subjectId: string;
  docType: string;
  file: { name: string; size: number; bytes: Uint8Array };
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
      invalidate: (tx) => (r.claim.status === "draft" ? ClaimRepository.update(tx, r.claim.id, { latestEvaluationId: null }) : Promise.resolve()),
    };
  }
  const r = await PreauthRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "preauth:create"), requireId(id, "Pre-authorization"));
  if (!r) throw new NotFoundError("Pre-authorization not found.");
  return {
    type, id: r.preauth.id, hospitalId: r.preauth.hospitalId, patientId: r.preauth.patientId, status: r.preauth.status,
    acceptsDocuments: DOCUMENTS_ALLOWED.has(r.preauth.status as PreauthStatus),
    invalidate: (tx) => (r.preauth.status === "draft" ? PreauthRepository.update(tx, r.preauth.id, { latestEvaluationId: null }) : Promise.resolve()),
  };
}

export const DocumentService = {
  /**
   * Upload pipeline: authenticate (ctx) → authorize (permission + subject scope) →
   * validate size, extension and real content type → scan → generate a safe key →
   * store privately → record + audit.
   */
  async upload(ctx: ServiceContext, input: UploadInput) {
    const scope = requirePermission(ctx.principal, "document:upload");
    const docDef = DOCUMENT_TYPES[input.docType];
    if (!docDef) throw new ValidationError("Choose a document type.", { docType: ["Choose a document type."] });

    // The subject decides the patient and owning hospital — never the client.
    const subject = await resolveSubject(ctx, input.subjectType, input.subjectId);
    if (scope !== "all" && (ctx.principal.orgType !== "hospital" || subject.hospitalId !== ctx.principal.organizationId)) throw new ForbiddenError();
    if (!subject.acceptsDocuments) throw new ValidationError("Documents can't be added in the current status.");

    const check = validateUpload(input.file);
    if (!check.ok) throw new ValidationError(check.error, { file: [check.error] });

    const verdict = await scanner.scan(input.file.bytes, check.kind);
    if (verdict.status === "infected") {
      await AuditService.record(ctx.db, { ...actorOf(ctx), action: "document.upload_blocked", resourceType: subject.type, resourceId: subject.id, newState: { reason: verdict.reason, docType: input.docType } });
      throw new ValidationError(`This file was blocked by the security scan: ${verdict.reason}`, { file: ["Blocked by security scan."] });
    }

    const storageKey = `${randomUUID()}.${check.ext}`;
    await getStorage().put(storageKey, input.file.bytes, check.mime);

    return ctx.db.transaction(async (tx) => {
      const row = await DocumentRepository.insert(tx, {
        organizationId: subject.hospitalId,
        patientId: subject.patientId,
        subjectType: subject.type,
        subjectId: subject.id,
        category: docDef.category,
        docType: input.docType,
        status: "uploaded",
        scanStatus: "clean",
        originalName: check.displayName,
        storageKey,
        mimeType: check.mime,
        sizeBytes: input.file.bytes.length,
        sha256: sha256Hex(Buffer.from(input.file.bytes)),
        uploadedBy: ctx.principal.userId,
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
        newState: { subjectType: subject.type, subjectId: subject.id, docType: input.docType, sizeBytes: row.sizeBytes, sha256: row.sha256 },
      });
      return row;
    });
  },

  async forPreauth(ctx: ServiceContext, preauthId: string) {
    requirePermission(ctx.principal, "document:read");
    const subject = await PreauthRepository.findScoped(ctx.db, ctx.principal, requirePermission(ctx.principal, "preauth:read"), requireId(preauthId, "Pre-authorization"));
    if (!subject) throw new NotFoundError("Pre-authorization not found.");
    return DocumentRepository.forSubject(ctx.db, "preauth", preauthId);
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
