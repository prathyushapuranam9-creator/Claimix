import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { diagnoses, procedures } from "@/db/schema";

/** Diagnosis (ICD-10) and procedure masters used in pickers. */
export const ClinicalRepository = {
  diagnosisOptions(db: DbOrTx) {
    return db.select({ id: diagnoses.id, code: diagnoses.code, name: diagnoses.name }).from(diagnoses).orderBy(asc(diagnoses.code));
  },
  /** These diagnoses, in the order given (ids not found are skipped). */
  async diagnosesByIds(db: DbOrTx, ids: string[]) {
    if (!ids.length) return [];
    const rows = await db.select({ id: diagnoses.id, code: diagnoses.code, name: diagnoses.name }).from(diagnoses).where(inArray(diagnoses.id, ids));
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => !!r);
  },
  procedureOptions(db: DbOrTx) {
    return db.select({ id: procedures.id, code: procedures.code, name: procedures.name }).from(procedures).orderBy(asc(procedures.name));
  },
  async diagnosisCodeTaken(db: DbOrTx, code: string) {
    return (await db.select({ id: diagnoses.id }).from(diagnoses).where(eq(diagnoses.code, code)).limit(1)).length > 0;
  },
  async procedureCodeTaken(db: DbOrTx, code: string) {
    return (await db.select({ id: procedures.id }).from(procedures).where(eq(procedures.code, code)).limit(1)).length > 0;
  },
  async insertDiagnosis(db: DbOrTx, v: { code: string; name: string }) {
    const [row] = await db.insert(diagnoses).values(v).returning({ id: diagnoses.id });
    return row!;
  },
  async insertProcedure(db: DbOrTx, v: { code: string; name: string }) {
    const [row] = await db.insert(procedures).values(v).returning({ id: procedures.id });
    return row!;
  },
};
