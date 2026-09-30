import { sql, type AnyColumn } from "drizzle-orm";
import type { diagnoses, governmentSchemes, organizations, patients, policies, procedures } from "./schema";

type LookupTable = typeof organizations | typeof governmentSchemes | typeof diagnoses | typeof procedures | typeof policies | typeof patients;

/**
 * Name/code of a referenced row as a scalar subquery. Keeps wide list and detail
 * queries simple to type (and cheap: each is a primary-key lookup).
 */
export function lookup(tbl: LookupTable, col: "name" | "code" | "full_name", fk: AnyColumn) {
  return sql<string | null>`(select t.${sql.raw(col)} from ${tbl} t where t.id = ${fk})`;
}
