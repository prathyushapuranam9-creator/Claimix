import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { ClinicalRepository } from "./clinical.repository";
import { diagnosisInputSchema, procedureInputSchema } from "./clinical.validation";

/** Diagnosis and procedure masters. Installations start empty; platform admins maintain them. */
export const ClinicalService = {
  async lists(ctx: ServiceContext) {
    requirePermission(ctx.principal, "policy:read");
    const [diagnoses, procedures] = await Promise.all([ClinicalRepository.diagnosisOptions(ctx.db), ClinicalRepository.procedureOptions(ctx.db)]);
    return { diagnoses, procedures };
  },

  async addDiagnosis(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "policy:manage");
    const d = parseOrThrow(diagnosisInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      if (await ClinicalRepository.diagnosisCodeTaken(tx, d.code)) throw new ConflictError(`Diagnosis code ${d.code} already exists.`);
      const row = await ClinicalRepository.insertDiagnosis(tx, d);
      await AuditService.record(tx, { ...actorOf(ctx), action: "diagnosis.created", resourceType: "diagnosis", resourceId: row.id, newState: d });
      return row;
    });
  },

  async addProcedure(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "policy:manage");
    const d = parseOrThrow(procedureInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      if (await ClinicalRepository.procedureCodeTaken(tx, d.code)) throw new ConflictError(`Procedure code ${d.code} already exists.`);
      const row = await ClinicalRepository.insertProcedure(tx, d);
      await AuditService.record(tx, { ...actorOf(ctx), action: "procedure.created", resourceType: "procedure", resourceId: row.id, newState: d });
      return row;
    });
  },
};
