import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { param } from "@/lib/pagination";
import { ClinicalRepository } from "@/modules/clinical/clinical.repository";
import { PATIENT_DEPARTMENTS } from "@/modules/patients/patients.validation";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { RegistrationService } from "@/modules/preauth/registration.service";
import { CaseRegistration } from "@/components/preauth/wizard/CaseRegistration";
import styles from "@/components/preauth/wizard/NewClaimWizard.module.css";
import { PageHeader } from "@/components/ui/Surface";
import { saveClinicalAction, saveRegistrationCopyAction, submitRegistrationAction } from "../actions";

export const metadata: Metadata = { title: "Register Case · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/** New Claim → Register Case: the case registration form for a draft the reviewer's organization raised. */
export default async function RegisterCasePage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("preauth:raise");
  if (ctx.principal.orgType !== "insurer" && ctx.principal.orgType !== "tpa") redirect("/forbidden");
  const id = param(await searchParams, "id");
  if (!id) notFound();
  const data = await orNotFound(RegistrationService.data(ctx, id));
  const [w, me, diagnoses, procedures] = await Promise.all([
    PreauthService.wizard(ctx, id),
    RegistrationService.signer(ctx),
    ClinicalRepository.diagnosisOptions(ctx.db),
    ClinicalRepository.procedureOptions(ctx.db),
  ]);
  return (
    <div className={styles.page}>
      <PageHeader title="Register Case" description={<>Case registration form for {data.patientName} · <span className="mono">{data.reference}</span></>} />
      <CaseRegistration
        data={data}
        signer={me}
        edit={{ defaults: w.details, diagnoses, procedures, departments: Object.values(PATIENT_DEPARTMENTS) }}
        actions={{ saveClinical: saveClinicalAction, saveCopy: saveRegistrationCopyAction, submit: submitRegistrationAction }}
      />
    </div>
  );
}
