import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { validateUpload } from "@/lib/security/file-validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { documentText, parseInsuranceDetails, type ReadField } from "@/modules/documents/insurance-extraction";
import type { UploadFile } from "@/modules/documents/documents.service";
import { PreauthRepository } from "./preauth.repository";

/** KYC & Policy values read from a policy card (only what is clearly labelled in the file). */
export interface KycCardReading {
  values: { patientName?: string; policyNumber?: string; memberId?: string; policyFrom?: string; policyTo?: string; sumInsured?: number; insurerId?: string };
  read: ReadField[];
  /** False for photos / scans: this build has no OCR engine, so nothing can be read from them. */
  hasText: boolean;
}

/**
 * "Use These Details" on New Claim: reads the policy card the reviewer dropped, with the same deterministic,
 * offline reader the coverage form uses. The file is only read here (it is filed against the case separately, through
 * the normal upload pipeline); nothing is guessed, and the reviewer checks every value before it is used.
 */
export const KycCardService = {
  async read(ctx: ServiceContext, file: UploadFile): Promise<KycCardReading> {
    requirePermission(ctx.principal, "preauth:raise");
    if (ctx.principal.orgType !== "insurer" && ctx.principal.orgType !== "tpa") throw new ForbiddenError();
    const check = validateUpload(file);
    if (!check.ok) throw new ValidationError(check.error, { file: [check.error] });
    const text = documentText(file.bytes);
    const parsed = parseInsuranceDetails(text);
    const d = parsed.details;

    // The insurer printed on the card, matched only against the payer's own insurers.
    let insurerId: string | undefined;
    if (d.insurerName) {
      const { insurers } = await PreauthRepository.kycOptions(ctx.db, { orgType: ctx.principal.orgType, orgId: ctx.principal.organizationId });
      const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");
      insurerId = insurers.find((i) => norm(i.name).includes(norm(d.insurerName!)) || norm(d.insurerName!).includes(norm(i.name)))?.id;
    }
    const values: KycCardReading["values"] = {
      ...(d.patientName ?? d.policyHolderName ? { patientName: d.patientName ?? d.policyHolderName } : {}),
      ...(d.policyNumber ? { policyNumber: d.policyNumber } : {}),
      ...(d.memberId ? { memberId: d.memberId } : {}),
      ...(d.coverStart ? { policyFrom: d.coverStart } : {}),
      ...(d.coverEnd ? { policyTo: d.coverEnd } : {}),
      ...(d.sumInsured !== undefined ? { sumInsured: d.sumInsured } : {}),
      ...(insurerId ? { insurerId } : {}),
    };
    await AuditService.record(ctx.db, {
      ...actorOf(ctx),
      action: "kyc.card_read",
      resourceType: "kyc_card",
      newState: { fields: Object.keys(values), hasText: text.trim().length > 0 },
    });
    return { values, read: parsed.read, hasText: text.trim().length > 0 };
  },
};
