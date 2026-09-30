import "server-only";
import { asc } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { diagnoses, procedures } from "@/db/schema";

/** Diagnosis (ICD-10) and procedure masters used in pickers. */
export const ClinicalRepository = {
  diagnosisOptions(db: DbOrTx) {
    return db.select({ id: diagnoses.id, code: diagnoses.code, name: diagnoses.name }).from(diagnoses).orderBy(asc(diagnoses.code));
  },
  procedureOptions(db: DbOrTx) {
    return db.select({ id: procedures.id, code: procedures.code, name: procedures.name }).from(procedures).orderBy(asc(procedures.name));
  },
};
