"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import type { KycCardReading } from "@/modules/preauth/kyc-card.service";
import { wizardKycSchema, type WizardKycInput } from "@/modules/preauth/preauth.validation";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { FormGrid, FormSection, formStyles } from "@/components/ui/Form";
import { Alert, Card, Stack } from "@/components/ui/Surface";
import { WizardDropzone, type WizardFile } from "./WizardDropzone";
import styles from "./NewClaimWizard.module.css";

export const KYC_FORM_ID = "wizard-kyc";

export interface KycOptions {
  insurers: { id: string; name: string }[];
  tpasByInsurer: Record<string, { id: string; name: string }[]>;
}

export interface KycActions {
  readCard: (fd: FormData) => Promise<ActionResult<KycCardReading>>;
  raise: (input: { beneficiaryId?: string; kyc: WizardKycInput }) => Promise<ActionResult<string>>;
  saveKyc: (id: string, kyc: WizardKycInput) => Promise<ActionResult>;
  upload: (id: string, fd: FormData) => Promise<ActionResult>;
  remove: (documentId: string) => Promise<ActionResult>;
}

const PHOTO_ID = { type: "id_proof", title: "Photo ID", hint: "Aadhaar, PAN, voter ID, passport or licence — it tells which" };
const CARD = { type: "insurance_card", title: "Policy Card / E-Card", hint: "The card, the e-card, the policy copy" };

/**
 * Step 1: KYC & Policy, opened for the patient chosen with Find (its details arrive filled from the record). Before the
 * case exists the dropped files are held in the browser and filed with the case when Next creates it; on a draft they
 * upload straight away. "Use These Details" reads a text PDF card (photos and scans can't be read: no OCR engine), and
 * every value stays editable. `onDirty` reports unsaved edits, so the wizard can warn before leaving them unsaved.
 */
export function KycStep({
  caseId,
  defaults,
  beneficiaryId,
  matched,
  options,
  files = [],
  actions,
  disabled,
  onDone,
  onDirty,
}: {
  caseId?: string;
  defaults: Partial<WizardKycInput>;
  beneficiaryId: string;
  matched: string;
  options: KycOptions;
  files?: WizardFile[];
  actions: KycActions;
  disabled?: boolean;
  onDone: (id: string) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { register, handleSubmit, setError, setValue, control, formState } = useForm<WizardKycInput>({
    resolver: zodResolver(wizardKycSchema),
    defaultValues: { mode: "typed", ...defaults },
  });
  const { formError, setFormError, apply } = useServerResult(setError);
  const e = formState.errors;
  const insurerId = useWatch({ control, name: "insurerId" });
  const mode = useWatch({ control, name: "mode" });
  const tpas = insurerId ? (options.tpasByInsurer[insurerId] ?? []) : [];

  const [held, setHeld] = useState<Record<string, File[]>>({});
  const [card, setCard] = useState<File | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "warning" | "danger" | "info"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const useDetails = () =>
    start(async () => {
      if (!card) return setNote({ tone: "danger", text: "Drop the policy card / e-card first." });
      const fd = new FormData();
      fd.set("file", card);
      const r = await actions.readCard(fd);
      if (!r.ok) return setNote({ tone: "danger", text: r.error });
      if (!r.data.hasText) {
        setValue("mode", "typed");
        return setNote({ tone: "warning", text: "This card is a photo or scan with no text layer, and Claimix has no OCR engine, so nothing could be read. Type the details instead." });
      }
      const v = r.data.values;
      const n = Object.keys(v).length;
      if (!n) return setNote({ tone: "warning", text: "No labelled policy details were found on this card. Type the details instead." });
      for (const [k, val] of Object.entries(v)) setValue(k as keyof WizardKycInput, val as never, { shouldDirty: true });
      onDirty?.(true);
      setValue("mode", "document");
      setNote({ tone: "success", text: `Read ${n} ${n === 1 ? "value" : "values"} from the card — check each one before continuing.` });
    });

  const submit = handleSubmit(async (kyc) => {
    setFormError(null);
    if (caseId) {
      if (apply(await actions.saveKyc(caseId, kyc))) {
        onDirty?.(false);
        onDone(caseId);
      }
      return;
    }
    const r = await actions.raise({ beneficiaryId, kyc });
    if (!apply(r)) return;
    // The case exists now: file the held documents against it.
    const failed: string[] = [];
    for (const [docType, list] of Object.entries(held)) {
      for (const f of list) {
        const fd = new FormData();
        fd.set("docType", docType);
        fd.set("file", f);
        const u = await actions.upload(r.data, fd);
        if (!u.ok) failed.push(`${f.name}: ${u.error}`);
      }
    }
    onDirty?.(false);
    if (failed.length) setNote({ tone: "danger", text: `The case was created, but some files didn't upload: ${failed.join(" ")}` });
    onDone(r.data);
  });

  const zone = (z: typeof PHOTO_ID) =>
    caseId ? (
      <WizardDropzone
        title={z.title}
        hint={z.hint}
        docType={z.type}
        files={files.filter((f) => f.docType === z.type)}
        upload={(fd) => actions.upload(caseId, fd)}
        remove={actions.remove}
        onPicked={z.type === CARD.type ? (l) => setCard(l[0] ?? null) : undefined}
        disabled={disabled}
      />
    ) : (
      <WizardDropzone
        title={z.title}
        hint={z.hint}
        docType={z.type}
        held={held[z.type] ?? []}
        onHold={(l) => setHeld((h) => ({ ...h, [z.type]: l }))}
        onPicked={z.type === CARD.type ? (l) => setCard(l[0] ?? null) : undefined}
        disabled={disabled}
      />
    );

  return (
    <form id={KYC_FORM_ID} className={formStyles.form} noValidate onSubmit={submit} onChange={() => onDirty?.(true)} aria-busy={formState.isSubmitting || undefined}>
      <Stack>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Card title="Photo ID and policy card">
          <div className={styles.grid2}>
            {zone(PHOTO_ID)}
            {zone(CARD)}
          </div>
          <div className={styles.modeRow} role="group" aria-label="How to fill the details">
            <button type="button" className={styles.pill} aria-pressed={mode === "document"} onClick={useDetails} disabled={disabled || pending}>
              Use These Details
            </button>
            <button type="button" className={styles.pill} aria-pressed={mode !== "document"} onClick={() => setValue("mode", "typed")} disabled={disabled}>
              Type the Details Instead
            </button>
          </div>
          <p className={styles.muted}>Use These Details reads a PDF card that carries text. Photos and scans can&apos;t be read here — type the details.</p>
        </Card>
        {note && <Alert tone={note.tone}>{note.text}</Alert>}

        <Card>
          <fieldset disabled={disabled} className={styles.plainFieldset}>
            <FormSection title="Patient details">
              <p className={styles.matched} data-testid="matched-member">Patient on record: {matched}</p>
              <FormGrid>
                <TextField label="UHID / IP Number" readOnly hint="From the patient record." {...register("uhid")} />
                <TextField label="Patient Name" required error={e.patientName?.message} {...register("patientName")} />
                <SelectField label="Gender" required error={e.gender?.message} {...register("gender")}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </SelectField>
                <TextField label="Date of Birth" type="date" required error={e.dob?.message} {...register("dob")} />
                <TextField label="Mobile" type="tel" inputMode="numeric" maxLength={10} required error={e.mobile?.message} {...register("mobile")} />
              </FormGrid>
            </FormSection>
            <FormSection title="Policy details">
              <FormGrid>
                <SelectField
                  label="Insurer"
                  required
                  error={e.insurerId?.message}
                  {...register("insurerId", { onChange: () => setValue("tpaId", "") })}
                >
                  <option value="">Select the insurer</option>
                  {options.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </SelectField>
                <SelectField label="TPA" error={e.tpaId?.message} disabled={!insurerId} {...register("tpaId")}>
                  {!insurerId ? <option value="">Choose the insurer first</option> : <option value="">{tpas.length ? "No TPA / select" : "No TPA on this insurer's policies"}</option>}
                  {tpas.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </SelectField>
                <TextField label="Policy Number" required error={e.policyNumber?.message} {...register("policyNumber")} />
                <TextField label="Policy From" type="date" required error={e.policyFrom?.message} {...register("policyFrom")} />
                <TextField label="Policy To" type="date" required error={e.policyTo?.message} {...register("policyTo")} />
                <TextField label="Sum Insured (₹)" inputMode="decimal" error={e.sumInsured?.message} {...register("sumInsured")} />
                <TextField label="TPA Card / Member ID" error={e.memberId?.message} {...register("memberId")} />
              </FormGrid>
            </FormSection>
          </fieldset>
        </Card>
        {formState.isSubmitting && <p className={styles.muted} role="status">Saving…</p>}
        <input type="hidden" {...register("mode")} />
      </Stack>
    </form>
  );
}
