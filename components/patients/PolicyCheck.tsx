import Link from "next/link";
import type { ReactNode } from "react";
import { ageOn, formatDate, formatDateTime, formatINR } from "@/lib/india";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { documentLabel } from "@/modules/documents/document-types";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import type { PolicyCheckData } from "@/modules/patients/policy-check.service";
import { GENDER_LABEL } from "@/modules/patients/patients.validation";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { DOC_STATUS } from "@/components/documents/DocumentList";
import { DocumentViewButton } from "@/components/documents/DocumentViewer";
import { ButtonTabs } from "@/components/ui/ButtonTabs";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Badge, EmptyState } from "@/components/ui/Surface";
import styles from "./PolicyCheck.module.css";

interface PatientInfo {
  /** The selected patient's unique ID: every record below was loaded for this ID only. */
  id: string;
  fullName: string;
  patientNo: string;
  dob: string;
  gender: string;
  hospitalName: string;
}

interface CoverageRow {
  id: string;
  policyName: string;
  category: string;
  insurerName: string | null;
  schemeName: string | null;
  memberId: string;
  relationship: string;
  coverStart: string;
  coverEnd: string;
  sumInsured: string | null;
  sumInsuredAvailable: string | null;
}

const TRI: Record<string, string> = { yes: "Yes", no: "No", unknown: "Not known" };
const tri = (v: string | null) => (v ? TRI[v] ?? v : "—");

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function NoAccess({ what }: { what: string }) {
  return <p className={styles.note}>Your role doesn&apos;t include access to {what}.</p>;
}

/**
 * "Policy Check": one collapsible block with three in-place views of this patient's
 * information. Switching views never navigates; all data is this patient's only,
 * already filtered to what the viewer may see.
 */
export function PolicyCheck({ patient, coverage, data, today }: { patient: PatientInfo; coverage: CoverageRow[]; data: PolicyCheckData; today: string }) {
  const coverStatus = (c: CoverageRow) =>
    c.coverEnd < today ? <Badge tone="danger">Expired</Badge> : c.coverStart > today ? <Badge tone="warning">Not started</Badge> : <Badge tone="success">In force</Badge>;

  const patientPolicy = (
    <div className={styles.stack}>
      <Section title="Patient">
        <Details
          columns={3}
          items={[
            ["Name", patient.fullName],
            ["Patient no", <span key="no" className="mono">{patient.patientNo}</span>],
            ["Date of birth", `${formatDate(patient.dob)} (${ageOn(patient.dob)} years)`],
            ["Gender", GENDER_LABEL[patient.gender as keyof typeof GENDER_LABEL] ?? patient.gender],
            ["Registered at", patient.hospitalName],
          ]}
        />
      </Section>
      <Section title="Insurance & policy">
        {coverage.length === 0 ? (
          <EmptyState title="No information available for this patient." />
        ) : (
          <div className={styles.cards}>
            {coverage.map((c) => (
              <div key={c.id} className={styles.cover}>
                <div className={styles.coverHead}>
                  <strong>{c.policyName}</strong>
                  {coverStatus(c)}
                </div>
                <Details
                  items={[
                    [c.category === "government" ? "Scheme" : "Insurer", (c.category === "government" ? c.schemeName : c.insurerName) ?? "—"],
                    ["Type", c.category === "government" ? "Government scheme" : "Private insurance"],
                    ["Member ID", <span key="m" className="mono">{c.memberId}</span>],
                    ["Relationship", RELATIONSHIP_LABEL[c.relationship as keyof typeof RELATIONSHIP_LABEL] ?? c.relationship],
                    ["Cover period", `${formatDate(c.coverStart)} – ${formatDate(c.coverEnd)}`],
                    ["Sum insured", formatINR(c.sumInsured)],
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );

  const medicalFinancial = (
    <div className={styles.stack}>
      <Section title="Cover available">
        {coverage.length === 0 ? (
          <EmptyState title="No information available for this patient." />
        ) : (
          <div className={styles.cards}>
            {coverage.map((c) => (
              <div key={c.id} className={styles.money}>
                <span className={styles.moneyValue}>{formatINR(c.sumInsuredAvailable)}</span>
                <span className={styles.moneyLabel}>available of {formatINR(c.sumInsured)} · {c.policyName}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
      {/* Pre-authorizations and claims switch in place, inside this block. */}
      <ButtonTabs
        label="Medical & financial records"
        tabs={[
          {
            key: "preauths",
            label: "Pre-authorizations",
            panel: (
              <Section title="Pre-authorization checks">
                      {data.preauths === null ? (
                        <NoAccess what="pre-authorizations" />
                      ) : (
                        <DataTable
                          caption="Pre-authorizations for this patient"
                          rows={data.preauths}
                          rowKey={(r) => r.id}
                          empty={<EmptyState title="No pre-authorizations available for this patient" />}
                          columns={[
                            { key: "ref", header: "Reference", cell: (r) => <CellText sub={<Badge tone={STATUS_TONE[r.status as PreauthStatus]}>{STATUS_LABEL[r.status as PreauthStatus]}</Badge>}><Link href={`/pre-authorizations/${r.id}`} className="mono">{r.reference}</Link></CellText> },
                            { key: "dx", header: "Diagnosis / treatment", cell: (r) => <CellText sub={r.procedureName ?? undefined}>{r.diagnosisCode ? `${r.diagnosisCode} · ${r.diagnosisName ?? ""}` : "—"}</CellText> },
                            { key: "adm", header: "Admission", nowrap: true, cell: (r) => <CellText sub={r.expectedStayDays ? `${r.expectedStayDays} day stay` : undefined}>{formatDate(r.expectedAdmission)}</CellText> },
                            { key: "ped", header: "PED / accident", cell: (r) => <CellText sub={`Accident: ${tri(r.isAccident)}`}>{`PED declared: ${tri(r.pedDeclared)}${r.pedRelated === "yes" ? " (related)" : ""}`}</CellText> },
                            { key: "room", header: "Room", cell: (r) => <CellText sub={r.roomRentPerDay ? `${formatINR(r.roomRentPerDay)}/day` : undefined}>{r.roomCategory ?? "—"}</CellText> },
                            { key: "est", header: "Estimate", align: "right", cell: (r) => <CellText sub={r.expectedInsuranceAmount ? `Insurance ${formatINR(r.expectedInsuranceAmount)}` : undefined}>{formatINR(r.estimatedCost)}</CellText> },
                            { key: "appr", header: "Approved", align: "right", cell: (r) => <CellText sub={r.patientContribution ? `Patient ${formatINR(r.patientContribution)}` : undefined}>{formatINR(r.approvedAmount)}</CellText> },
                          ]}
                        />
                      )}
                    </Section>
            ),
          },
          {
            key: "claims",
            label: "Claims",
            panel: (
              <Section title="Claims">
                      {data.claims === null ? (
                        <NoAccess what="claims" />
                      ) : (
                        <DataTable
                          caption="Claims for this patient"
                          rows={data.claims}
                          rowKey={(r) => r.id}
                          empty={<EmptyState title="No claims available for this patient" />}
                          columns={[
                            { key: "ref", header: "Claim", cell: (r) => <CellText sub={<Badge tone={CLAIM_STATUS_TONE[r.status as ClaimStatus]}>{CLAIM_STATUS_LABEL[r.status as ClaimStatus]}</Badge>}><Link href={`/claims/${r.id}`} className="mono">{r.reference}</Link></CellText> },
                            { key: "dx", header: "Diagnosis / treatment", cell: (r) => <CellText sub={r.procedureName ?? undefined}>{r.diagnosisCode ? `${r.diagnosisCode} · ${r.diagnosisName ?? ""}` : "—"}</CellText> },
                            { key: "stay", header: "Admission – discharge", nowrap: true, cell: (r) => <CellText sub={r.payerName ?? undefined}>{`${formatDate(r.admissionDate)} – ${formatDate(r.dischargeDate)}`}</CellText> },
                            { key: "c", header: "Claimed", align: "right", cell: (r) => formatINR(r.claimedAmount) },
                            { key: "a", header: "Approved", align: "right", cell: (r) => formatINR(r.approvedAmount) },
                            { key: "p", header: "Patient pays", align: "right", cell: (r) => formatINR(r.patientAmount) },
                            { key: "rcv", header: "Received", align: "right", cell: (r) => formatINR(r.received ?? 0) },
                          ]}
                        />
                      )}
                    </Section>
            ),
          },
        ]}
      />
    </div>
  );

  const docs = (
    <div className={styles.stack}>
      {data.documents === null ? (
        <NoAccess what="documents" />
      ) : (
        <DataTable
          caption="Documents for this patient"
          rows={data.documents}
          rowKey={(d) => d.id}
          empty={<EmptyState title="No documents available for this patient" />}
          columns={[
            { key: "t", header: "Document", cell: (d) => <CellText sub={d.originalName}>{documentLabel(d.docType)}</CellText> },
            { key: "c", header: "Category", cell: (d) => d.category.replace("_", " ").replace(/^./, (s) => s.toUpperCase()) },
            { key: "for", header: "For", cell: (d) => (d.subjectRef ? <span className="mono">{d.subjectRef}</span> : "Patient record") },
            { key: "s", header: "Status", cell: (d) => <Badge tone={DOC_STATUS[d.status]?.tone ?? "neutral"}>{DOC_STATUS[d.status]?.label ?? d.status}</Badge> },
            { key: "u", header: "Uploaded", nowrap: true, cell: (d) => formatDateTime(d.createdAt) },
            { key: "v", header: "", cell: (d) => <DocumentViewButton id={d.id} name={d.originalName} /> },
            { key: "dl", header: "", cell: (d) => <a href={`/api/documents/${d.id}`} className={styles.download}>Download</a> },
          ]}
        />
      )}
    </div>
  );

  return (
    <details className={styles.block} data-patient-id={patient.id}>
      <summary className={styles.summary}>
        <span>Policy Check</span>
        <svg className={styles.chev} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className={styles.body}>
        <p className={styles.scope}>
          Showing records for <strong>{patient.fullName}</strong> (<span className="mono">{patient.patientNo}</span>) only.
        </p>
        <ButtonTabs
          label="Policy check"
          tabs={[
            { key: "patient", label: "Patient & Policy", panel: patientPolicy },
            { key: "medical", label: "Medical & Financial", panel: medicalFinancial },
            { key: "documents", label: "Documents", panel: docs },
          ]}
        />
      </div>
    </details>
  );
}
