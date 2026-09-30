import type { DbOrTx } from "@/db/client";
import { todayIso } from "@/lib/validation";
import { DocumentRepository } from "@/modules/documents/documents.repository";
import { networkForPolicy } from "@/modules/hospitals/hospitals.repository";
import type { CaseFacts } from "@/modules/rules/engine/types";
import type { ClaimRepository } from "./claims.repository";

type Row = NonNullable<Awaited<ReturnType<typeof ClaimRepository.findScoped>>>;

const num = (v: string | null | undefined) => (v === null || v === undefined ? undefined : Number(v));
const tri = (v: unknown) => (v === "yes" ? true : v === "no" ? false : undefined);

/**
 * Facts for final claim assessment, from stored data only. Documents uploaded
 * to the linked pre-authorization count as evidence for the claim too.
 */
export async function buildClaimFacts(db: DbOrTx, r: Row): Promise<CaseFacts> {
  const c = r.claim;
  const clinical = c.clinical as Record<string, unknown>;
  const [net, claimDocs, preauthDocs] = await Promise.all([
    networkForPolicy(db, c.hospitalId, r.policy),
    DocumentRepository.usableTypes(db, "claim", c.id),
    c.preAuthId ? DocumentRepository.usableTypes(db, "preauth", c.preAuthId) : Promise.resolve([] as string[]),
  ]);
  return {
    stage: "claim",
    asOf: todayIso(),
    claimType: c.claimType,
    patient: { dob: r.patient.dob, relationship: r.beneficiary.relationship },
    cover: {
      start: r.beneficiary.coverStart,
      end: r.beneficiary.coverEnd,
      inceptionDate: r.beneficiary.inceptionDate ?? undefined,
      sumInsured: num(r.beneficiary.sumInsured),
      availableBalance: num(r.beneficiary.sumInsuredAvailable),
    },
    admissionDate: c.admissionDate ?? undefined,
    dischargeDate: c.dischargeDate ?? undefined,
    submissionDate: todayIso(),
    hospital: { networkStatus: net?.status ?? null, cashlessAvailable: net?.cashlessAvailable ?? false, lastVerifiedAt: net?.lastVerifiedAt?.toISOString() ?? null },
    diagnosisCode: r.diagnosisCode ?? undefined,
    procedureCode: r.procedureCode ?? undefined,
    isAccident: tri(clinical.isAccident),
    ped: { declared: tri(clinical.pedDeclared), related: tri(clinical.pedRelated) },
    estimatedCost: num(c.claimedAmount),
    roomRentPerDay: num(c.roomRentPerDay),
    uploadedDocuments: [...new Set([...claimDocs, ...preauthDocs])],
  };
}
