import type { DbOrTx } from "@/db/client";
import { todayIso } from "@/lib/validation";
import { DocumentRepository } from "@/modules/documents/documents.repository";
import { networkForPolicy } from "@/modules/hospitals/hospitals.repository";
import type { CaseFacts } from "@/modules/rules/engine/types";
import type { PreauthRepository } from "./preauth.repository";

type Row = NonNullable<Awaited<ReturnType<typeof PreauthRepository.findScoped>>>;

const num = (v: string | null | undefined) => (v === null || v === undefined ? undefined : Number(v));
const tri = (v: unknown) => (v === "yes" ? true : v === "no" ? false : undefined);

/**
 * Case facts for a pre-authorization, built only from stored data: the recorded
 * coverage, the request's own fields, the hospital's network status for this
 * payer, and documents that are uploaded and scanned clean.
 */
export async function buildPreauthFacts(db: DbOrTx, r: Row, stage: CaseFacts["stage"] = "preauth"): Promise<CaseFacts> {
  const p = r.preauth;
  const clinical = p.clinical as Record<string, unknown>;
  const [net, uploaded] = await Promise.all([
    networkForPolicy(db, p.hospitalId, r.policy),
    DocumentRepository.usableTypes(db, "preauth", p.id),
  ]);
  return {
    stage,
    asOf: todayIso(),
    claimType: p.claimType,
    patient: { dob: r.patient.dob, relationship: r.beneficiary.relationship },
    cover: {
      start: r.beneficiary.coverStart,
      end: r.beneficiary.coverEnd,
      inceptionDate: r.beneficiary.inceptionDate ?? undefined,
      sumInsured: num(r.beneficiary.sumInsured),
      availableBalance: num(r.beneficiary.sumInsuredAvailable),
    },
    admissionDate: p.expectedAdmission ?? undefined,
    hospital: { networkStatus: net?.status ?? null, cashlessAvailable: net?.cashlessAvailable ?? false, lastVerifiedAt: net?.lastVerifiedAt?.toISOString() ?? null },
    diagnosisCode: r.diagnosisCode ?? undefined,
    procedureCode: r.procedureCode ?? undefined,
    isAccident: tri(clinical.isAccident),
    ped: { declared: tri(clinical.pedDeclared), related: tri(clinical.pedRelated) },
    estimatedCost: num(p.estimatedCost),
    roomRentPerDay: num(p.roomRentPerDay),
    uploadedDocuments: uploaded,
  };
}
