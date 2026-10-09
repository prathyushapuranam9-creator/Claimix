"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import type { WizardKycInput } from "@/modules/preauth/preauth.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { KYC_FORM_ID, KycStep, type KycActions, type KycOptions } from "./KycStep";
import { FormPanel, WizardFooter, WizardStepper } from "./WizardChrome";
import styles from "./NewClaimWizard.module.css";

/**
 * KYC & Policy for the patient chosen with Find, before the case exists. Next (or clicking any later step) validates
 * and saves the KYC, which creates the draft and its case ID, then opens the chosen step.
 */
export function NewCaseStart({
  defaults,
  beneficiaryId,
  matched,
  patientName,
  aadhaarOnFile,
  options,
  actions,
}: {
  defaults: Partial<WizardKycInput>;
  beneficiaryId: string;
  matched: string;
  patientName: string;
  aadhaarOnFile?: string | null;
  options: KycOptions;
  actions: KycActions;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // The step to open once the case is created (Next: 2; a click on a step name: that step).
  const target = useRef(2);
  const goTo = (n: number) => {
    if (n === 1) return;
    target.current = n;
    (document.getElementById(KYC_FORM_ID) as HTMLFormElement | null)?.requestSubmit();
  };

  return (
    <FormPanel heading={<><strong>{patientName}</strong> <ButtonLink href="/pre-authorizations/raise" variant="ghost" size="sm">Change patient</ButtonLink></>}>
      <div className={styles.wizard}>
        <WizardStepper current={1} onGo={goTo} />
        <h2 className="visually-hidden">KYC &amp; Policy</h2>
        <KycStep
          defaults={defaults}
          beneficiaryId={beneficiaryId}
          matched={matched}
          options={options}
          aadhaarOnFile={aadhaarOnFile}
          actions={actions}
          onDone={(id) => start(() => router.replace(`/pre-authorizations/raise?id=${id}&step=${target.current}`))}
        />
        <WizardFooter info="Step 1 of 5 · the case is created when you continue">
          <Button type="submit" form={KYC_FORM_ID} loading={pending} onClick={() => (target.current = 2)}>Next</Button>
        </WizardFooter>
      </div>
    </FormPanel>
  );
}
