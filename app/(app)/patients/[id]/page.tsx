import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { ageOn, formatDate, formatDateTime, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { todayIso } from "@/lib/validation";
import { DocumentService } from "@/modules/documents/documents.service";
import { InsuranceExtractionService } from "@/modules/documents/insurance-extraction.service";
import { EligibilityService } from "@/modules/eligibility/eligibility.service";
import { OVERALL_LABEL } from "@/modules/eligibility/eligibility.sections";
import { coverageWorkflowSteps } from "@/modules/eligibility/workflow";
import { CoverageService } from "@/modules/patients/coverage.service";
import { COVER_PERIOD_LABEL, coverPeriodStatus, RELATIONSHIP_LABEL, VERIFICATION_LABEL } from "@/modules/patients/coverage.validation";
import { PatientService } from "@/modules/patients/patients.service";
import { PatientEligibilityService } from "@/modules/eligibility/patient-eligibility.service";
import { PolicyCheckService } from "@/modules/patients/policy-check.service";
import { departmentLabel, GENDER_LABEL, NO_VISIT_REASON } from "@/modules/patients/patients.validation";
import { PolicyService } from "@/modules/policies/policies.service";
import { CoverageForm } from "@/components/patients/CoverageForm";
import { ExtractedDetailsNotice, InsuranceDocumentsCard } from "@/components/patients/InsuranceDocuments";
import { EligibilityCheckButton, EligibilityCheckProvider, EligibilityResultCard } from "@/components/patients/PatientEligibility";
import { PolicyCheck } from "@/components/patients/PolicyCheck";
import { OUTCOME_TONE } from "@/components/eligibility/EligibilityResult";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Details, formStyles } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { WorkflowStepper } from "@/components/workflow/WorkflowStepper";
import { deleteDocumentAction } from "@/app/(app)/documents/actions";
import { addCoverageAction, uploadInsuranceDocumentAction } from "../actions";

export const metadata: Metadata = { title: "Patient · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const COVER_TONE = { in_force: "success", expired: "danger", not_started: "warning" } as const;

export default async function PatientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const ctx = await pageContext("patient:read");
  const { id } = await params;
  const sp = await searchParams;
  const { patient: p, hospitalName } = await orNotFound(PatientService.get(ctx, id));
  const canWrite = can(ctx.principal, "patient:write");
  const canCheck = can(ctx.principal, "eligibility:check");
  const canUploadDocs = canWrite && can(ctx.principal, "document:upload");
  const canReadDocs = can(ctx.principal, "document:read");
  // The profile check is also offered to payer reviewers, for their own policies only (enforced server-side).
  const canProfileCheck = PatientEligibilityService.canCheck(ctx.principal);
  const [coverage, policyOptions, policyCheck, insuranceDocs] = await Promise.all([
    CoverageService.forPatient(ctx, p.id),
    canWrite ? PolicyService.options(ctx) : Promise.resolve([]),
    PolicyCheckService.forPatient(ctx, p.id),
    canReadDocs ? DocumentService.insuranceDocuments(ctx, p.id) : Promise.resolve([]),
  ]);
  // Contact details are shown to the registering hospital and the patient only.
  const showContact = ctx.principal.orgType === "hospital" || ctx.principal.orgType === "platform";
  const today = todayIso();
  // Latest recorded eligibility check per coverage (read only; never re-runs the check).
  const lastChecks = await EligibilityService.latestChecks(ctx, coverage.map((c) => c.id));

  // Details read from one of the patient's insurance documents, when staff asked to review them.
  // Nothing is saved here: the values only pre-fill the coverage form below.
  const fromDocument = canUploadDocs ? param(sp, "fromDocument") : undefined;
  const extraction = fromDocument ? await orNotFound(InsuranceExtractionService.fromDocument(ctx, p.id, fromDocument)) : null;
  const justRegistered = canWrite && param(sp, "registered") === "1";
  const coverageAdded = canWrite && param(sp, "coverage") === "added";

  const lastCheck = [...lastChecks.values()].sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())[0]?.overall ?? null;
  const requestCount = (policyCheck.preauths?.length ?? 0) + (policyCheck.claims?.length ?? 0);
  const inForceCoverage = coverage.filter((c) => coverPeriodStatus(c, today) === "in_force");

  const content = (
    <>
      <PageHeader
        title={p.fullName}
        description={<>Patient <span className="mono">{p.patientNo}</span> · {hospitalName}</>}
        actions={
          <>
            {canWrite && <ButtonLink href={`/patients/${p.id}/edit`} variant="secondary">Edit details</ButtonLink>}
            <ButtonLink href={`/api/patients/${p.id}/export`} variant="secondary">Download details</ButtonLink>
            {canProfileCheck && <EligibilityCheckButton />}
          </>
        }
      />
      <Stack>
        {justRegistered && (
          <Alert tone="success" title="Patient registered successfully.">
            <p>Next step: add insurance coverage. Upload the insurance document to fill the details from it, or add the coverage manually.</p>
            <p>
              <a href="#insurance-documents">Upload insurance document</a> · <a href="#add-coverage">Add coverage manually</a>
            </p>
          </Alert>
        )}
        {coverageAdded && (
          <Alert tone="success" title="Coverage added successfully.">
            <p>Next step: check eligibility against the policy&apos;s own rules, below.</p>
          </Alert>
        )}
        {canWrite && (
          <Card title="Insurance workflow">
            <WorkflowStepper
              steps={coverageWorkflowSteps({
                hasInsuranceDocument: insuranceDocs.length > 0,
                coverageCount: coverage.length,
                lastCheck,
                requestCount,
              })}
            />
          </Card>
        )}
        <Card title="Details">
          <Details
            columns={3}
            items={[
              ["Patient number", <span key="no" className="mono">{p.patientNo}</span>],
              ["Name", p.fullName],
              ["Department", departmentLabel(p.department)],
              ["Reason for Visit", p.visitReason ?? NO_VISIT_REASON],
              ["Date of birth", `${formatDate(p.dob)} (${ageOn(p.dob)} years)`],
              ["Gender", GENDER_LABEL[p.gender]],
              ["Registered", formatDateTime(p.createdAt)],
              ...(showContact
                ? ([
                    ["Mobile", p.phone],
                    ["Email", p.email],
                  ] as [string, string | null][])
                : []),
            ]}
          />
        </Card>
        {canProfileCheck && <EligibilityResultCard />}
        {canReadDocs && (
          <div id="insurance-documents">
            <InsuranceDocumentsCard
              patientId={p.id}
              docs={insuranceDocs}
              canUpload={canUploadDocs}
              upload={canUploadDocs ? uploadInsuranceDocumentAction.bind(null, p.id) : undefined}
              remove={canUploadDocs ? deleteDocumentAction : undefined}
            />
          </div>
        )}
        <Card
          title="Insurance & scheme coverage"
          padded={false}
          actions={canWrite && coverage.length > 0 ? <ButtonLink size="sm" variant="secondary" href={`/patients/${p.id}#add-coverage`}>Add coverage</ButtonLink> : undefined}
        >
          <DataTable
            caption="Coverage"
            rows={coverage}
            rowKey={(c) => c.id}
            empty={
              <EmptyState
                title="No coverage recorded"
                action={
                  canWrite ? (
                    <div className={formStyles.actionsInline}>
                      {canUploadDocs && <ButtonLink href={`/patients/${p.id}#insurance-documents`} variant="secondary">Upload insurance document</ButtonLink>}
                      <ButtonLink href={`/patients/${p.id}#add-coverage`}>Add coverage</ButtonLink>
                    </div>
                  ) : undefined
                }
              >
                {canWrite ? "Add the patient's insurance policy or scheme enrolment to check eligibility. Either path works — the insurance document is not required." : undefined}
              </EmptyState>
            }
            columns={[
              { key: "p", header: "Policy / scheme", cell: (c) => <CellText sub={c.category === "government" ? c.schemeName : c.insurerName}>{c.policyName}</CellText> },
              { key: "m", header: "Member ID", cell: (c) => <CellText sub={RELATIONSHIP_LABEL[c.relationship as keyof typeof RELATIONSHIP_LABEL] ?? c.relationship}><span className="mono">{c.memberId}</span></CellText> },
              {
                key: "d",
                header: "Cover period",
                nowrap: true,
                cell: (c) => {
                  const st = coverPeriodStatus(c, today);
                  return (
                    <CellText sub={<Badge tone={COVER_TONE[st]}>{COVER_PERIOD_LABEL[st]}</Badge>}>
                      {formatDate(c.coverStart)} – {formatDate(c.coverEnd)}
                    </CellText>
                  );
                },
              },
              { key: "b", header: "Available", align: "right", cell: (c) => <CellText sub={`of ${formatINR(c.sumInsured)}`}>{formatINR(c.sumInsuredAvailable)}</CellText> },
              {
                key: "v",
                header: "Verification",
                cell: (c) =>
                  c.verificationStatus === "verified" ? (
                    <Badge tone="success">Verified</Badge>
                  ) : (
                    <CellText sub={canUploadDocs ? "Upload the insurance document to confirm" : undefined}>
                      <Badge tone="warning">{VERIFICATION_LABEL.requires_verification}</Badge>
                    </CellText>
                  ),
              },
              ...(canCheck
                ? [{
                    key: "e",
                    header: "Last eligibility check",
                    nowrap: true,
                    cell: (c: (typeof coverage)[number]) => {
                      const last = lastChecks.get(c.id);
                      if (!last) return <span>Not checked yet</span>;
                      return (
                        <CellText sub={formatDateTime(last.evaluatedAt)}>
                          <Link href={`/eligibility?beneficiary=${c.id}#previous-checks`}>
                            <Badge tone={OUTCOME_TONE[last.overall]}>{OVERALL_LABEL[last.overall].title}</Badge>
                          </Link>
                        </CellText>
                      );
                    },
                  }]
                : []),
              ...(canCheck || canWrite
                ? [{
                    key: "a",
                    header: "",
                    nowrap: true,
                    cell: (c: (typeof coverage)[number]) => (
                      <span className={formStyles.actionsInline}>
                        {canCheck && <ButtonLink size="sm" variant="secondary" href={`/eligibility?beneficiary=${c.id}`}>Check eligibility</ButtonLink>}
                        {canWrite && <ButtonLink size="sm" variant="ghost" href={`/patients/${p.id}/coverage/${c.id}/edit`}>Edit</ButtonLink>}
                      </span>
                    ),
                  }]
                : []),
            ]}
          />
        </Card>
        {canWrite && inForceCoverage.length > 0 && (can(ctx.principal, "preauth:create") || can(ctx.principal, "claim:create")) && (
          <Card title="Treatment request">
            <p>
              Eligibility is checked against the policy&apos;s published rules before you raise a request. Start from the coverage the patient is treated
              under:
            </p>
            <Details
              columns={2}
              items={inForceCoverage.map((c) => [
                `${c.policyName} · ${c.memberId}`,
                <span key={c.id} className={formStyles.actionsInline}>
                  {can(ctx.principal, "preauth:create") && <ButtonLink size="sm" href={`/pre-authorizations/new?beneficiary=${c.id}`}>New pre-authorization</ButtonLink>}
                  {can(ctx.principal, "claim:create") && <ButtonLink size="sm" variant="secondary" href={`/claims/new?beneficiary=${c.id}`}>New claim</ButtonLink>}
                </span>,
              ])}
            />
          </Card>
        )}
        <PolicyCheck
          key={p.id}
          patient={{ id: p.id, fullName: p.fullName, patientNo: p.patientNo, dob: p.dob, gender: p.gender, hospitalName, department: p.department, visitReason: p.visitReason }}
          coverage={coverage}
          data={policyCheck}
          today={today}
        />
        {canWrite && (
          <div id="add-coverage">
            <Card title={extraction ? "Add coverage from the insurance document" : "Add coverage"}>
              <Stack>
                {extraction && <ExtractedDetailsNotice extraction={extraction} />}
                <CoverageForm
                  key={extraction?.documentId ?? "manual"}
                  action={addCoverageAction.bind(null, p.id)}
                  policies={policyOptions}
                  defaults={extraction ? { ...extraction.values, sourceDocumentId: extraction.documentId, verificationStatus: "verified" } : undefined}
                  startOpen={!!extraction}
                  toggleLabel={coverage.length ? "Add another coverage" : "Add coverage manually"}
                />
              </Stack>
            </Card>
          </div>
        )}
      </Stack>
    </>
  );

  if (!canProfileCheck) return content;
  return (
    <EligibilityCheckProvider
      key={p.id}
      patientId={p.id}
      coverage={PatientEligibilityService.checkable(ctx.principal, coverage).map((c) => ({ id: c.id, policyName: c.policyName, memberId: c.memberId }))}
      addCoverageHref={canWrite ? "#add-coverage" : null}
      next={{
        preauth: can(ctx.principal, "preauth:create"),
        claim: can(ctx.principal, "claim:create"),
        coverageEditBase: canWrite ? `/patients/${p.id}/coverage` : null,
        uploadDocumentHref: canUploadDocs ? "#insurance-documents" : null,
      }}
    >
      {content}
    </EligibilityCheckProvider>
  );
}
