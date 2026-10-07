import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/india";
import { param } from "@/lib/pagination";
import { InsuranceExtractionService } from "@/modules/documents/insurance-extraction.service";
import { DocumentService } from "@/modules/documents/documents.service";
import { CoverageService } from "@/modules/patients/coverage.service";
import { coverPeriodStatus, type CoverageInput } from "@/modules/patients/coverage.validation";
import { PatientService } from "@/modules/patients/patients.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { CoverageForm } from "@/components/patients/CoverageForm";
import { ExtractedDetailsNotice } from "@/components/patients/InsuranceDocuments";
import { ButtonLink } from "@/components/ui/Button";
import { Alert, Card, PageHeader, Stack } from "@/components/ui/Surface";
import { todayIso } from "@/lib/validation";
import { updateCoverageAction } from "@/app/(app)/patients/actions";

export const metadata: Metadata = { title: "Edit coverage · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Corrects one recorded coverage — the path for "review / edit coverage" after an eligibility result
 * that could not be confirmed, and for confirming details once the insurance document arrives.
 */
export default async function EditCoveragePage({ params, searchParams }: { params: Promise<{ id: string; coverageId: string }>; searchParams: SP }) {
  const ctx = await pageContext("patient:write");
  const { id, coverageId } = await params;
  const sp = await searchParams;
  const { patient } = await orNotFound(PatientService.get(ctx, id));
  const cov = await orNotFound(CoverageService.get(ctx, coverageId));
  // A coverage id from another patient is not this patient's coverage, whatever the path says.
  if (cov.patientId !== patient.id) notFound();

  const fromDocument = param(sp, "fromDocument");
  const [policies, extraction, insuranceDocs] = await Promise.all([
    PolicyService.options(ctx),
    fromDocument ? orNotFound(InsuranceExtractionService.fromDocument(ctx, patient.id, fromDocument)) : Promise.resolve(null),
    DocumentService.insuranceDocuments(ctx, patient.id),
  ]);
  const period = coverPeriodStatus(cov, todayIso());

  return (
    <>
      <PageHeader
        title="Edit coverage"
        description={<>{patient.fullName} · <span className="mono">{patient.patientNo}</span> · {cov.policyName}</>}
        actions={<ButtonLink href={`/patients/${patient.id}`} variant="secondary">Back to patient</ButtonLink>}
      />
      <Stack>
        {period !== "in_force" && (
          <Alert tone="warning" title={period === "expired" ? "This cover has ended" : "This cover has not started yet"}>
            <p>
              Recorded period: {formatDate(cov.coverStart)} – {formatDate(cov.coverEnd)}. Correct the dates if they were recorded wrongly, or go back and
              add the coverage the patient is insured under today — pre-authorizations can only be raised on cover that is in force.
            </p>
          </Alert>
        )}
        {extraction ? (
          <ExtractedDetailsNotice extraction={extraction} />
        ) : (
          insuranceDocs.length > 0 &&
          cov.verificationStatus === "requires_verification" && (
            <Alert tone="info" title="Insurance document on record">
              <p>
                This patient has {insuranceDocs.length === 1 ? "an insurance document" : `${insuranceDocs.length} insurance documents`} on record. Read
                the details from one of them:{" "}
                {insuranceDocs.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && " · "}
                    <a href={`/patients/${patient.id}/coverage/${cov.id}/edit?fromDocument=${d.id}`}>{d.originalName}</a>
                  </span>
                ))}
              </p>
            </Alert>
          )
        )}
        <Card>
          <CoverageForm
            action={updateCoverageAction.bind(null, patient.id, cov.id)}
            policies={policies}
            startOpen
            submitLabel="Save coverage"
            cancelHref={`/patients/${patient.id}`}
            defaults={{
              policyId: cov.policyId ?? "",
              memberId: cov.memberId,
              relationship: cov.relationship as CoverageInput["relationship"],
              coverStart: cov.coverStart,
              coverEnd: cov.coverEnd,
              inceptionDate: cov.inceptionDate ?? "",
              sumInsured: cov.sumInsured ?? "",
              sumInsuredAvailable: cov.sumInsuredAvailable ?? "",
              verificationStatus: cov.verificationStatus,
              sourceDocumentId: cov.sourceDocumentId ?? undefined,
              // Reviewing a document means these details are now confirmed against it on save.
              ...(extraction ? { ...extraction.values, sourceDocumentId: extraction.documentId, verificationStatus: "verified" as const } : {}),
            }}
          />
        </Card>
      </Stack>
    </>
  );
}
