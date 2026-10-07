import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { beneficiaries, claims, documents, preAuthorizations, users } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";

/**
 * Documents belong to the uploading hospital and the patient. Payers reach a
 * document only through a pre-auth or claim assigned to them.
 */
const viaSubject = (col: "insurer_id" | "tpa_id") => (orgId: string) => sql`(
  (${documents.subjectType} = 'preauth' and exists (select 1 from ${preAuthorizations} p where p.id = ${documents.subjectId} and p.${sql.raw(col)} = ${orgId} and p.submitted_at is not null))
  or (${documents.subjectType} = 'claim' and exists (select 1 from ${claims} c where c.id = ${documents.subjectId} and c.${sql.raw(col)} = ${orgId} and c.submitted_at is not null))
)`;

export const DOCUMENT_SCOPE: ScopeColumns = {
  hospitalId: documents.organizationId,
  patientId: documents.patientId,
  insurerId: viaSubject("insurer_id"),
  tpaId: viaSubject("tpa_id"),
};

export const DocumentRepository = {
  async insert(db: DbOrTx, values: typeof documents.$inferInsert) {
    const [row] = await db.insert(documents).values(values).returning();
    return row!;
  },

  async findScoped(db: DbOrTx, principal: Principal, scope: Scope, id: string) {
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt), scopePredicate(principal, scope, DOCUMENT_SCOPE)))
      .limit(1);
    return row;
  },

  /**
   * The patient's coverage-stage (insurance) documents: filed against the patient with no pre-auth or
   * claim subject. These are the documents the coverage form reads; treatment documents never appear here.
   */
  async insuranceForPatient(db: DbOrTx, patientId: string) {
    return db
      .select({
        id: documents.id,
        docType: documents.docType,
        category: documents.category,
        status: documents.status,
        scanStatus: documents.scanStatus,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        statusNote: documents.statusNote,
        createdAt: documents.createdAt,
        uploadedByName: users.fullName,
      })
      .from(documents)
      .leftJoin(users, eq(users.id, documents.uploadedBy))
      .where(and(eq(documents.patientId, patientId), isNull(documents.subjectId), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt));
  },

  async forSubject(db: DbOrTx, subjectType: "preauth" | "claim", subjectId: string) {
    return db
      .select({
        id: documents.id,
        docType: documents.docType,
        category: documents.category,
        status: documents.status,
        scanStatus: documents.scanStatus,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        statusNote: documents.statusNote,
        createdAt: documents.createdAt,
        uploadedByName: users.fullName,
      })
      .from(documents)
      .leftJoin(users, eq(users.id, documents.uploadedBy))
      .where(and(eq(documents.subjectType, subjectType), eq(documents.subjectId, subjectId), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt));
  },

  /** Document types usable as evidence: uploaded or verified, and scanned clean. */
  async usableTypes(db: DbOrTx, subjectType: "preauth" | "claim", subjectId: string) {
    const rows = await db
      .selectDistinct({ docType: documents.docType })
      .from(documents)
      .where(and(
        eq(documents.subjectType, subjectType),
        eq(documents.subjectId, subjectId),
        isNull(documents.deletedAt),
        eq(documents.scanStatus, "clean"),
        inArray(documents.status, ["uploaded", "verified"]),
      ));
    return rows.map((r) => r.docType);
  },

  async setStatus(db: DbOrTx, id: string, values: Pick<typeof documents.$inferInsert, "status" | "statusNote" | "verifiedBy" | "verifiedAt">) {
    const [row] = await db.update(documents).set(values).where(eq(documents.id, id)).returning();
    return row!;
  },

  async setScan(db: DbOrTx, id: string, scanStatus: "clean" | "infected" | "failed", note?: string) {
    const [row] = await db
      .update(documents)
      .set({ scanStatus, ...(scanStatus === "infected" ? { status: "rejected" as const, statusNote: note ?? "Blocked by security scan" } : {}) })
      .where(eq(documents.id, id))
      .returning();
    return row;
  },

  async subjectStatus(db: DbOrTx, subjectType: "preauth" | "claim", id: string) {
    const t = subjectType === "claim" ? claims : preAuthorizations;
    const [row] = await db.select({ status: t.status }).from(t).where(eq(t.id, id)).limit(1);
    return row?.status;
  },

  /** Removes the document from every view (the stored file is kept for the audit trail and is no longer reachable). */
  async softDelete(db: DbOrTx, id: string) {
    await db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, id));
  },

  /** Whether a recorded coverage was filled from this document. */
  async usedByCoverage(db: DbOrTx, id: string) {
    const [row] = await db.select({ id: beneficiaries.id }).from(beneficiaries).where(eq(beneficiaries.sourceDocumentId, id)).limit(1);
    return !!row;
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    return row;
  },
};
