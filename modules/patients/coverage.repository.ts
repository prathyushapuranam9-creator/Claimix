import "server-only";
import { aliasedTable, and, asc, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { likeContains } from "@/lib/pagination";
import type { DbOrTx } from "@/db/client";
import { beneficiaries, claims, governmentSchemes, organizations, patients, policies, preAuthorizations } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { scopePredicate } from "@/lib/permissions/scope";
import { PATIENT_SCOPE } from "./patients.repository";

const insurerOrg = aliasedTable(organizations, "cov_insurer_org");

const coverageColumns = {
  id: beneficiaries.id,
  patientId: beneficiaries.patientId,
  category: beneficiaries.category,
  policyId: beneficiaries.policyId,
  schemeId: beneficiaries.schemeId,
  memberId: beneficiaries.memberId,
  policyNumber: beneficiaries.policyNumber,
  policyholderName: beneficiaries.policyholderName,
  relationship: beneficiaries.relationship,
  coverStart: beneficiaries.coverStart,
  coverEnd: beneficiaries.coverEnd,
  inceptionDate: beneficiaries.inceptionDate,
  sumInsured: beneficiaries.sumInsured,
  sumInsuredAvailable: beneficiaries.sumInsuredAvailable,
  verificationStatus: beneficiaries.verificationStatus,
  sourceDocumentId: beneficiaries.sourceDocumentId,
  isDemo: beneficiaries.isDemo,
  policyName: policies.name,
  insurerId: policies.insurerId,
  tpaId: policies.tpaId,
  insurerName: insurerOrg.name,
  schemeName: governmentSchemes.name,
};

/** Coverage is visible exactly when its patient is visible (same scope rules). */
export const CoverageRepository = {
  async forPatient(db: DbOrTx, patientId: string) {
    return db
      .select(coverageColumns)
      .from(beneficiaries)
      .innerJoin(policies, eq(policies.id, beneficiaries.policyId))
      .leftJoin(insurerOrg, eq(insurerOrg.id, policies.insurerId))
      .leftJoin(governmentSchemes, eq(governmentSchemes.id, beneficiaries.schemeId))
      .where(and(eq(beneficiaries.patientId, patientId), isNull(beneficiaries.deletedAt)))
      .orderBy(desc(beneficiaries.coverEnd));
  },

  /** A coverage row with its patient, only if the patient is inside the caller's scope. */
  async findScoped(db: DbOrTx, principal: Principal, scope: Scope, beneficiaryId: string) {
    const [row] = await db
      .select({ ...coverageColumns, patient: patients })
      .from(beneficiaries)
      .innerJoin(patients, eq(patients.id, beneficiaries.patientId))
      .innerJoin(policies, eq(policies.id, beneficiaries.policyId))
      .leftJoin(insurerOrg, eq(insurerOrg.id, policies.insurerId))
      .leftJoin(governmentSchemes, eq(governmentSchemes.id, beneficiaries.schemeId))
      .where(and(eq(beneficiaries.id, beneficiaryId), isNull(beneficiaries.deletedAt), isNull(patients.deletedAt), scopePredicate(principal, scope, PATIENT_SCOPE)))
      .limit(1);
    return row;
  },

  /** Coverage of a hospital's own patients, for pickers (search by patient name, number or member ID). */
  async searchForHospital(db: DbOrTx, hospitalId: string, q: string | undefined) {
    const term = q ? likeContains(q) : undefined;
    return db
      .select({
        id: beneficiaries.id,
        memberId: beneficiaries.memberId,
        coverStart: beneficiaries.coverStart,
        coverEnd: beneficiaries.coverEnd,
        verificationStatus: beneficiaries.verificationStatus,
        patientId: patients.id,
        patientName: patients.fullName,
        patientNo: patients.patientNo,
        policyName: policies.name,
      })
      .from(beneficiaries)
      .innerJoin(patients, eq(patients.id, beneficiaries.patientId))
      .innerJoin(policies, eq(policies.id, beneficiaries.policyId))
      .where(and(
        eq(patients.hospitalId, hospitalId),
        isNull(beneficiaries.deletedAt),
        isNull(patients.deletedAt),
        term ? or(ilike(patients.fullName, term), ilike(patients.patientNo, term), ilike(beneficiaries.memberId, term)) : undefined,
      ))
      .orderBy(asc(patients.fullName))
      .limit(50);
  },

  async memberIdTaken(db: DbOrTx, category: "private" | "government", memberId: string, exceptId?: string) {
    const [row] = await db
      .select({ id: beneficiaries.id })
      .from(beneficiaries)
      .where(and(eq(beneficiaries.category, category), eq(beneficiaries.memberId, memberId), exceptId ? ne(beneficiaries.id, exceptId) : undefined))
      .limit(1);
    return !!row;
  },

  async insert(db: DbOrTx, values: typeof beneficiaries.$inferInsert) {
    const [row] = await db.insert(beneficiaries).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof beneficiaries.$inferInsert>) {
    const [row] = await db.update(beneficiaries).set(values).where(eq(beneficiaries.id, id)).returning();
    return row!;
  },

  /**
   * Pre-authorizations and claims already raised on this coverage. They fix which policy (and so which
   * payer) the request went to, so the policy of a coverage in use can no longer be changed.
   */
  async requestsUsing(db: DbOrTx, beneficiaryId: string) {
    const [[pre], [cl]] = await Promise.all([
      db.select({ reference: preAuthorizations.reference }).from(preAuthorizations).where(eq(preAuthorizations.beneficiaryId, beneficiaryId)).limit(1),
      db.select({ reference: claims.reference }).from(claims).where(eq(claims.beneficiaryId, beneficiaryId)).limit(1),
    ]);
    return [pre?.reference, cl?.reference].filter((r): r is string => !!r);
  },
};
