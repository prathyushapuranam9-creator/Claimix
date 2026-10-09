import Link from "next/link";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, type ClaimStatus } from "@/modules/claims/claims.workflow";
import type { PolicyCheckData } from "@/modules/patients/policy-check.service";
import { STATUS_LABEL, STATUS_TONE, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Details } from "@/components/ui/Form";
import { Badge, EmptyState } from "@/components/ui/Surface";
import styles from "./PatientDialog.module.css";

type Preauth = NonNullable<PolicyCheckData["preauths"]>[number];
type Claim = NonNullable<PolicyCheckData["claims"]>[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const shown = (v: string | null) => (v === null || v === "" ? "—" : ISO_DATE.test(v) ? formatDate(v) : v);
const TRI: Record<string, string> = { yes: "Yes", no: "No", unknown: "Not known" };

function PreauthTitle({ r }: { r: Preauth }) {
  return (
    <h3 className={styles.caseTitle}>
      Pre-authorization <Link href={`/pre-authorizations/${r.id}`} className="mono">{r.reference}</Link>
      <Badge tone={STATUS_TONE[r.status as PreauthStatus]}>{STATUS_LABEL[r.status as PreauthStatus]}</Badge>
    </h3>
  );
}

/**
 * Bill Breakup: the selected patient's own records only. Per pre-authorization, the cost estimate exactly as saved
 * (heads × days, or the all-inclusive package); per claim, the final bill figures recorded on it.
 */
export function BillBreakup({ preauths, claims }: { preauths: PolicyCheckData["preauths"]; claims: PolicyCheckData["claims"] }) {
  const withCost = (preauths ?? []).filter((r) => r.cost.length > 0 || r.packageAmount !== null || r.estimatedCost !== null);
  const billed = (claims ?? []).filter((c) => c.claimedAmount !== null || c.billNumber);
  if (!withCost.length && !billed.length) {
    return (
      <EmptyState title="No bill breakup recorded for this patient">
        A breakup appears here once a pre-authorization estimate or a claim bill is saved for this patient.
      </EmptyState>
    );
  }
  return (
    <>
      {withCost.map((r) => (
        <section key={r.id} className={styles.case} aria-label={`Bill breakup for ${r.reference}`}>
          <div className={styles.caseHead}>
            <PreauthTitle r={r} />
            <span className={styles.note}>{r.procedureName ?? (r.diagnosisName ? `${r.diagnosisCode} · ${r.diagnosisName}` : "")}</span>
          </div>
          {r.cost.length > 0 ? (
            <DataTable
              caption={`Estimated cost lines for ${r.reference}`}
              rows={r.cost.map((line, i) => ({ ...line, key: `${i}` }))}
              rowKey={(l) => l.key}
              columns={[
                { key: "h", header: "Head", cell: (l) => <CellText sub={l.covers ?? undefined}>{l.head}</CellText> },
                { key: "p", header: "Per day", align: "right", cell: (l) => formatINR(l.perDay) },
                { key: "d", header: "Days", align: "right", cell: (l) => String(l.days) },
                { key: "a", header: "Amount", align: "right", cell: (l) => formatINR(l.amount) },
              ]}
            />
          ) : (
            <p className={styles.note}>No itemised cost lines were saved for this request.</p>
          )}
          <Details
            columns={3}
            items={[
              ...(r.packageAmount !== null ? ([["All-inclusive package", formatINR(r.packageAmount)]] as [string, string][]) : []),
              ["Estimated total", formatINR(r.estimatedCost)],
              ["Expected from insurance", formatINR(r.expectedInsuranceAmount)],
              ["Patient contribution", formatINR(r.patientContribution)],
              ["Approved", formatINR(r.approvedAmount)],
              ["Room", r.roomCategory ? `${r.roomCategory}${r.roomRentPerDay ? ` · ${formatINR(r.roomRentPerDay)}/day` : ""}` : "—"],
            ]}
          />
        </section>
      ))}
      {billed.length > 0 && (
        <section className={styles.case} aria-label="Claim bills">
          <h3 className={styles.caseTitle}>Claim bills</h3>
          <DataTable
            caption="Final bills recorded on this patient's claims"
            rows={billed}
            rowKey={(c) => c.id}
            columns={[
              {
                key: "c",
                header: "Claim",
                cell: (c: Claim) => (
                  <CellText sub={<Badge tone={CLAIM_STATUS_TONE[c.status as ClaimStatus]}>{CLAIM_STATUS_LABEL[c.status as ClaimStatus]}</Badge>}>
                    <Link href={`/claims/${c.id}`} className="mono">{c.reference}</Link>
                  </CellText>
                ),
              },
              { key: "b", header: "Bill no.", cell: (c: Claim) => <CellText sub={c.preauthReference ? `From ${c.preauthReference}` : undefined}>{c.billNumber ?? "—"}</CellText> },
              { key: "r", header: "Room / day", align: "right", cell: (c: Claim) => formatINR(c.roomRentPerDay) },
              { key: "cl", header: "Claimed", align: "right", cell: (c: Claim) => formatINR(c.claimedAmount) },
              { key: "ap", header: "Approved", align: "right", cell: (c: Claim) => formatINR(c.approvedAmount) },
              { key: "pp", header: "Patient pays", align: "right", cell: (c: Claim) => formatINR(c.patientAmount) },
            ]}
          />
          {billed.some((c) => c.nonPayableNotes) && (
            <Details items={billed.filter((c) => c.nonPayableNotes).map((c) => [`Non-payable items · ${c.reference}`, c.nonPayableNotes as string])} />
          )}
        </section>
      )}
    </>
  );
}

/** Pre-Form: each of the patient's pre-authorization forms as saved in Claimix (read-only). */
export function PreForms({ preauths }: { preauths: PolicyCheckData["preauths"] }) {
  const rows = preauths ?? [];
  if (!rows.length) {
    return <EmptyState title="No pre-authorization form saved for this patient">The filled form appears here once a pre-authorization is started for this patient.</EmptyState>;
  }
  return (
    <>
      {rows.map((r) => (
        <section key={r.id} className={styles.case} aria-label={`Pre-authorization form ${r.reference}`}>
          <div className={styles.caseHead}>
            <PreauthTitle r={r} />
            <span className={styles.note}>{r.submittedAt ? `Submitted ${formatDateTime(r.submittedAt)}` : `Last saved ${formatDateTime(r.updatedAt)}`}</span>
          </div>
          {r.form.map((sec) => (
            <div key={sec.title}>
              <h4 className={styles.sectionTitle}>{sec.title}</h4>
              <Details columns={3} items={sec.rows.map(([label, value]) => [label, label === "Due to an accident" || label === "Pre-existing disease declared" ? (value ? TRI[value] ?? value : "—") : shown(value)])} />
            </div>
          ))}
          <div>
            <h4 className={styles.sectionTitle}>Estimate</h4>
            <Details
              columns={3}
              items={[
                ["Estimated total", formatINR(r.estimatedCost)],
                ["Expected from insurance", formatINR(r.expectedInsuranceAmount)],
                ["Approved", formatINR(r.approvedAmount)],
              ]}
            />
          </div>
        </section>
      ))}
    </>
  );
}
