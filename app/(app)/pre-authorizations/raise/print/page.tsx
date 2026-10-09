import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { ageOn, formatDate, formatINR } from "@/lib/india";
import { param } from "@/lib/pagination";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { PrintButton } from "@/components/preauth/wizard/PrintButton";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Surface";
import styles from "./print.module.css";

export const metadata: Metadata = { title: "Pre-authorization request form · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Print template (New Claim, Papers): the cashless request form filled from the stored case, with blank
 * signature lines. It is printed, signed by the patient and treating doctor, stamped, and uploaded back as the
 * signed form. Same access as the wizard: the raising insurer / TPA only.
 */
export default async function PrintTemplatePage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("preauth:raise");
  if (ctx.principal.orgType !== "insurer" && ctx.principal.orgType !== "tpa") redirect("/forbidden");
  const id = param(await searchParams, "id");
  if (!id) notFound();
  const w = await orNotFound(PreauthService.wizard(ctx, id));
  const d = w.details as Record<string, unknown>;
  const k = w.kyc;
  const items = (d.costItems ?? []) as { head: string; description?: string; perDay: number | string; days: number | string }[];
  const blank = (v: unknown) => (v === undefined || v === null || v === "" ? "" : Array.isArray(v) ? v.join(", ") : String(v));
  const row = (label: string, value: string) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      <td>{value}</td>
    </tr>
  );
  const at = (date: unknown, time: unknown) => (date ? `${formatDate(String(date))}${time ? ` ${time}` : ""}` : "");

  return (
    <>
      <PageHeader title="Pre-authorization request form" description={<>Print template for case <span className="mono">{w.preauth.reference}</span></>} />
      <article className={styles.sheet} aria-label="Pre-authorization request form">
        <div className={styles.actions}>
          <PrintButton />
          <ButtonLink href={`/pre-authorizations/raise?id=${w.preauth.id}&step=3`} variant="secondary">Back to papers</ButtonLink>
        </div>
        <p className={styles.note}>
          Request for cashless hospitalisation · Case {w.preauth.reference} · Printed details come from the case as saved; blank lines are completed by hand before
          signing and stamping.
        </p>

        <h2>Patient and policy</h2>
        <table className={styles.table}>
          <tbody>
            {row("Patient name", k?.patientName ?? w.patient.fullName)}
            {row("UHID / IP number", k?.uhid ?? w.patient.patientNo)}
            {row("Gender / age", `${k?.gender ?? w.patient.gender} · ${ageOn(k?.dob ?? w.patient.dob)} years`)}
            {row("Date of birth", formatDate(k?.dob ?? w.patient.dob))}
            {row("Mobile", blank(k?.mobile))}
            {row("Current address", blank(d.currentAddress))}
            {row("Occupation", blank(d.occupation))}
            {row("Insurer / TPA", [w.insurerName, w.tpaName].filter(Boolean).join(" · "))}
            {row("Policy", w.policy.name)}
            {row("Policy number", blank(k?.policyNumber))}
            {row("Policy period", k ? `${formatDate(k.policyFrom)} – ${formatDate(k.policyTo)}` : `${formatDate(w.beneficiary.coverStart)} – ${formatDate(w.beneficiary.coverEnd)}`)}
            {row("TPA card / member ID", k?.memberId ?? w.beneficiary.memberId)}
            {row("Relationship to proposer", RELATIONSHIP_LABEL[w.beneficiary.relationship as keyof typeof RELATIONSHIP_LABEL] ?? w.beneficiary.relationship)}
            {row("Family physician", [blank(d.familyPhysician), blank(d.familyPhysicianContact)].filter(Boolean).join(" · "))}
            {row("Hospital", w.hospitalName ?? "")}
          </tbody>
        </table>

        <h2>Treating doctor</h2>
        <table className={styles.table}>
          <tbody>
            {row("Name", blank(d.doctorName))}
            {row("Contact number", blank(d.doctorContact))}
            {row("Registration number", blank(d.doctorRegistrationNo))}
            {row("Department", blank(d.department))}
            {row("Presenting complaint", blank(d.symptoms))}
            {row("Relevant critical findings", blank(d.criticalFindings))}
            {row("Duration of the present ailment (days)", blank(d.ailmentDurationDays))}
            {row("Past history of the present ailment", blank(d.presentAilmentHistory))}
            {row("Provisional diagnoses (ICD-10)", w.diagnoses.map((x) => `${x.code} — ${x.name}`).join("; "))}
            {row("Line of treatment", blank(d.treatmentType))}
            {row("Treatment / package", w.procedureName ?? "")}
            {row("Route of drug administration", blank(d.drugRoute))}
            {row("Past history of chronic illness", blank(d.chronicIllness))}
            {row("Due to an accident", blank(d.isAccident))}
          </tbody>
        </table>

        <h2>The stay</h2>
        <table className={styles.table}>
          <tbody>
            {row("Admission type", blank(d.admissionType))}
            {row("Stay starts", at(d.admissionDate, d.admissionTime))}
            {row("Stay ends (expected)", at(d.dischargeDate, d.dischargeTime))}
            {row("Expected length of stay (days)", blank(w.preauth.expectedStayDays))}
            {row("Days in ICU", blank(d.icuDays))}
            {row("Room category", blank(d.roomCategory))}
          </tbody>
        </table>

        <h2>Expected cost</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Head</th>
              <th scope="col">What it covers</th>
              <th scope="col" className={styles.num}>Per day</th>
              <th scope="col" className={styles.num}>Days</th>
              <th scope="col" className={styles.num}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={n}>
                <td>{i.head}</td>
                <td>{blank(i.description)}</td>
                <td className={styles.num}>{formatINR(Number(i.perDay))}</td>
                <td className={styles.num}>{String(i.days)}</td>
                <td className={styles.num}>{formatINR(Number(i.perDay) * Number(i.days))}</td>
              </tr>
            ))}
            {d.packageAmount !== undefined && (
              <tr>
                <th scope="row" colSpan={4}>All-inclusive package</th>
                <td className={styles.num}>{formatINR(Number(d.packageAmount))}</td>
              </tr>
            )}
            <tr>
              <th scope="row" colSpan={4}>Expected cost</th>
              <td className={styles.num}><strong>{formatINR(w.preauth.estimatedCost)}</strong></td>
            </tr>
          </tbody>
        </table>

        <p className={styles.note}>
          I declare that the information given is true to the best of my knowledge. I understand that pre-authorization is an initial estimate, approval is not
          guaranteed, and the final amount is decided by the payer on the final bill.
        </p>
        <div className={styles.signatures}>
          <div className={styles.signature}>Patient / attendant signature &amp; date</div>
          <div className={styles.signature}>Treating doctor signature, seal &amp; date</div>
          <div className={styles.signature}>Hospital stamp &amp; authorised signatory</div>
        </div>
      </article>
    </>
  );
}
