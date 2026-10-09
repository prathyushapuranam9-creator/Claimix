import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { ageOn, formatDate, formatDateTime, formatINR, maskAadhaar } from "@/lib/india";
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
import { PREAUTH_APPROVED } from "@/modules/patients/patients.repository";
import { RegistrationService } from "@/modules/scheduling/scheduling.service";
import { PatientEligibilityService } from "@/modules/eligibility/patient-eligibility.service";
import { PolicyCheckService } from "@/modules/patients/policy-check.service";
import { departmentLabel, GENDER_LABEL, NO_VISIT_REASON } from "@/modules/patients/patients.validation";
import { PolicyService } from "@/modules/policies/policies.service";
import { CoverageForm } from "@/components/patients/CoverageForm";
import { ExtractedDetailsNotice, InsuranceDocumentsCard } from "@/components/patients/InsuranceDocuments";
import { EligibilityCheckButton, EligibilityCheckProvider, EligibilityResultCard } from "@/components/patients/PatientEligibility";
import { BillBreakup, PreForms } from "@/components/patients/PatientCaseViews";
import { PatientDialogButton } from "@/components/patients/PatientDialog";
import { PatientVisits } from "@/components/patients/PatientVisits";
import { SubmitToClaims } from "@/components/patients/SubmitToClaims";
import { PolicyCheck } from "@/components/patients/PolicyCheck";
import { OUTCOME_TONE } from "@/components/eligibility/EligibilityResult";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Details, formStyles } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { WorkflowStepper } from "@/components/workflow/WorkflowStepper";
import { DocumentViewButton } from "@/components/documents/DocumentViewer";
import { deleteDocumentAction } from "@/app/(app)/documents/actions";
import { addCoverageAction, submitPatientToClaimsAction, uploadInsuranceDocumentAction } from "../actions";
import { dischargeAction } from "../registration-actions";

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
  // The insurance side of the profile: coverage needs a policy to record against, so `policy:read` is
  // what decides whether any of it is shown. Front-desk staff hold none of these.
  const canSeeInsurance = can(ctx.principal, "policy:read");
  const canManageCoverage = canWrite && canSeeInsurance;
  const canUploadDocs = canManageCoverage && can(ctx.principal, "document:upload");
  const canReadDocs = canSeeInsurance && can(ctx.principal, "document:read");
  const canSeePolicyCheck = can(ctx.principal, "preauth:read") || can(ctx.principal, "claim:read") || can(ctx.principal, "document:read");
  // The profile check is also offered to payer reviewers, for their own policies only (enforced server-side).
  const canProfileCheck = PatientEligibilityService.canCheck(ctx.principal);
  const [coverage, policyOptions, policyCheck, insuranceDocs, visits, registrationForms] = await Promise.all([
    canSeeInsurance ? CoverageService.forPatient(ctx, p.id) : Promise.resolve([]),
    canManageCoverage ? PolicyService.options(ctx) : Promise.resolve([]),
    canSeePolicyCheck ? PolicyCheckService.forPatient(ctx, p.id) : Promise.resolve({ preauths: null, claims: null, documents: null }),
    canReadDocs ? DocumentService.insuranceDocuments(ctx, p.id) : Promise.resolve([]),
    RegistrationService.forPatient(ctx, p.id),
    canReadDocs ? DocumentService.registrationForms(ctx, p.id) : Promise.resolve([]),
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
  const coverageAdded = canWrite && param(sp, "coverage") === "added";

  const lastCheck = [...lastChecks.values()].sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())[0]?.overall ?? null;
  const requestCount = (policyCheck.preauths?.length ?? 0) + (policyCheck.claims?.length ?? 0);
  const inForceCoverage = coverage.filter((c) => coverPeriodStatus(c, today) === "in_force");

  // Submit (Pre-Auth → Claims) follows the existing claim rule: hospital staff with claim:create, from an approved
  // pre-auth that has no live claim. The server checks all of it again.
  const canSubmit = can(ctx.principal, "claim:create") && ctx.principal.orgType === "hospital" && ctx.principal.roleKey !== "patient";
  const approved = new Set<string>(PREAUTH_APPROVED);
  const submittable = policyCheck.preauths?.find((r) => approved.has(r.status) && !r.liveClaimId) ?? null;
  const submitReason = policyCheck.preauths?.some((r) => approved.has(r.status))
    ? "This patient's approved pre-authorization is already in Claims."
    : "Submit is available once the patient's pre-authorization is approved.";
  // After Submit: the claim that was started (only when it is one of this patient's claims).
  const claimParam = param(sp, "claim");
  const startedClaim = claimParam ? policyCheck.claims?.find((c) => c.id === claimParam) ?? null : null;
  const hasCaseData = policyCheck.preauths !== null || policyCheck.claims !== null;

  const content = (
    <>
      <PageHeader
        title={p.fullName}
        description={<>Patient <span className="mono">{p.patientNo}</span> · {hospitalName}</>}
        actions={
          <>
            {canWrite && <ButtonLink href={`/patients/${p.id}/edit`} variant="secondary">Edit details</ButtonLink>}
            <ButtonLink href={`/api/patients/${p.id}/export`} variant="secondary">Download details</ButtonLink>
            {canSubmit && (
              <SubmitToClaims
                patientId={p.id}
                preauth={submittable ? { reference: submittable.reference } : null}
                reason={submitReason}
                submit={submittable ? submitPatientToClaimsAction.bind(null, p.id, submittable.id) : undefined}
              />
            )}
          </>
        }
      />
      <Stack>
        {startedClaim && (
          <Alert tone="success" title="Patient moved to Claims.">
            <p>
              Claim <Link href={`/claims/${startedClaim.id}`} className="mono">{startedClaim.reference}</Link> was started from
              {startedClaim.preauthReference ? <> pre-authorization <span className="mono">{startedClaim.preauthReference}</span></> : " the approved pre-authorization"}. The
              patient now appears under <Link href="/patients?view=claims">Patients → Claims</Link>.
            </p>
          </Alert>
        )}
        {coverageAdded && (
          <Alert tone="success" title="Coverage added successfully.">
            <p>Next step: check eligibility against the policy&apos;s own rules, below.</p>
          </Alert>
        )}
        {canManageCoverage && (
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
        <Card
          title="Details"
          actions={
            canProfileCheck || hasCaseData ? (
              <span className={formStyles.actionsInline}>
                {hasCaseData && (
                  <PatientDialogButton label="Bill Breakup" title={`Bill breakup · ${p.fullName}`} size="lg">
                    <BillBreakup preauths={policyCheck.preauths} claims={policyCheck.claims} />
                  </PatientDialogButton>
                )}
                {policyCheck.preauths !== null && (
                  <PatientDialogButton label="Pre-Form" title={`Pre-authorization form · ${p.fullName}`} size="lg">
                    <PreForms preauths={policyCheck.preauths} />
                  </PatientDialogButton>
                )}
                {canProfileCheck && <EligibilityCheckButton />}
              </span>
            ) : undefined
          }
        >
          <Details
            columns={3}
            items={[
              ["Patient number", <span key="no" className="mono">{p.patientNo}</span>],
              ["Name", p.fullName],
              ["Department", departmentLabel(p.department)],
              ["Reason for Visit", p.visitReason ?? NO_VISIT_REASON],
              ["Date of birth", `${formatDate(p.dob)} (${ageOn(p.dob)} years)`],
              ["Gender", GENDER_LABEL[p.gender]],
              // Only the last 4 digits are ever stored next to a keyed hash, so the number is always shown masked.
              ["Aadhaar Number", maskAadhaar(p.aadhaarLast4) ?? "Not provided"],
              ...(p.abhaNumber || p.abhaAddress
                ? ([["ABHA", [p.abhaAddress, p.abhaNumber && p.abhaNumber.replace(/^(\d{2})(\d{4})(\d{4})(\d{4})$/, "$1-$2-$3-$4")].filter(Boolean).join(" · ")]] as [string, string][])
                : []),
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

        {registrationForms.length > 0 && (
          <Card title="Case registration forms" padded={false}>
            <DataTable
              caption="Case registration forms"
              rows={registrationForms}
              rowKey={(r) => r.id}
              columns={[
                { key: "c", header: "Case", cell: (r) => <Link href={`/pre-authorizations/${r.preauthId}`} className="mono">{r.reference}</Link> },
                { key: "f", header: "Form", cell: (r) => <CellText sub={r.uploadedByName ? `Signed and saved by ${r.uploadedByName}` : undefined}>{r.originalName}</CellText> },
                { key: "d", header: "Saved", nowrap: true, cell: (r) => formatDateTime(r.createdAt) },
                {
                  key: "a",
                  header: "",
                  nowrap: true,
                  cell: (r) =>
                    r.scanStatus === "clean" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <DocumentViewButton id={r.id} name={r.originalName} />
                        <a href={`/api/documents/${r.id}`}>Download</a>
                      </span>
                    ) : (
                      "Security scan pending"
                    ),
                },
              ]}
            />
          </Card>
        )}
        {canProfileCheck && <EligibilityResultCard />}
        <PatientVisits
          visits={visits}
          canRegister={canWrite}
          discharge={canWrite ? (admissionId) => dischargeAction.bind(null, admissionId) : undefined}
        />
        {canSeeInsurance && (
          <>
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
              {
                key: "p",
                header: "Policy / scheme",
                cell: (c) => (
                  <CellText sub={[c.category === "government" ? c.schemeName : c.insurerName, c.policyNumber ? `Policy ${c.policyNumber}` : null].filter(Boolean).join(" · ")}>
                    {c.policyName}
                  </CellText>
                ),
              },
              {
                key: "m",
                header: "Member ID",
                cell: (c) => (
                  <CellText
                    sub={[RELATIONSHIP_LABEL[c.relationship as keyof typeof RELATIONSHIP_LABEL] ?? c.relationship, c.policyholderName].filter(Boolean).join(" · ")}
                  >
                    <span className="mono">{c.memberId}</span>
                  </CellText>
                ),
              },
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
          </>
        )}
        {canSeePolicyCheck && (
        <PolicyCheck
          key={p.id}
          patient={{ id: p.id, fullName: p.fullName, patientNo: p.patientNo, dob: p.dob, gender: p.gender, hospitalName, department: p.department, visitReason: p.visitReason }}
          coverage={coverage}
          data={policyCheck}
          today={today}
          insuranceDocuments={
            canReadDocs ? (
              <InsuranceDocumentsCard
                patientId={p.id}
                docs={insuranceDocs}
                canUpload={canUploadDocs}
                upload={canUploadDocs ? uploadInsuranceDocumentAction.bind(null, p.id) : undefined}
                remove={canUploadDocs ? deleteDocumentAction : undefined}
              />
            ) : undefined
          }
        />
        )}
        {canManageCoverage && (
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
      patient={{ name: p.fullName, department: departmentLabel(p.department), visitReason: p.visitReason ?? NO_VISIT_REASON }}
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
