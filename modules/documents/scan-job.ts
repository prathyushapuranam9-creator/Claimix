import type { Db } from "@/db/client";
import { logger } from "@/lib/logging/logger";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/notifications/notifications.service";
import { documentLabel } from "./document-types";
import { DocumentRepository } from "./documents.repository";
import type { Scanner } from "./scanner";
import { getStorage } from "./storage";

/**
 * Background "document.scan" job: re-scans the stored file with the configured
 * scanner (plug an antivirus engine in here). An infected file is blocked from
 * download, marked rejected, audited, and the hospital is told.
 */
export function documentScanJob(db: Db, scanner: Scanner) {
  return async (payload: Record<string, unknown>) => {
    const id = String(payload.documentId ?? "");
    const doc = await DocumentRepository.get(db, id);
    if (!doc) return;
    const kind = doc.mimeType === "application/pdf" ? "pdf" : doc.mimeType === "image/png" ? "png" : "jpg";
    const bytes = await getStorage().get(doc.storageKey);
    const verdict = await scanner.scan(bytes, kind);
    if (verdict.status === "clean") return;

    await db.transaction(async (tx) => {
      await DocumentRepository.setScan(tx, doc.id, "infected", verdict.reason);
      await AuditService.record(tx, { action: "document.quarantined", resourceType: "document", resourceId: doc.id, newState: { reason: verdict.reason } });
      await NotificationService.toOrganizations(tx, [doc.organizationId], {
        kind: "document.rejected",
        title: `${documentLabel(doc.docType)} blocked by security scan`,
        body: "Upload a clean copy of this document.",
        resourceType: doc.subjectType ?? undefined,
        resourceId: doc.subjectId ?? undefined,
      });
    });
    logger.warn("document_quarantined", { documentId: doc.id });
  };
}
