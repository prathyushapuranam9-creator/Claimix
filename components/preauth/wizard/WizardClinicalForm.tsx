"use client";

import { useId, useState } from "react";
import { Controller, useController, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { formatINR } from "@/lib/india";
import { CHRONIC_ILLNESSES, COST_HEADS, expectedCost, stayDays, wizardClinicalSchema, type PreauthDetailsInput } from "@/modules/preauth/preauth.validation";
import { Button } from "@/components/ui/Button";
import { ComboBox } from "@/components/ui/ComboBox";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormGrid, FormSection, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";
import styles from "./NewClaimWizard.module.css";

type Coded = { id: string; code: string; name: string };

export const CLINICAL_FORM_ID = "wizard-clinical";

const ROOM_CATEGORIES = ["General ward", "Twin sharing", "Single private", "Deluxe / suite", "ICU", "Day care"];
const COMPLAINT_SAMPLE = "e.g. Pain in the right lower abdomen for 2 days, fever and vomiting since last night";

/** A segmented pill toggle over a radio group (keyboard and screen-reader friendly). */
function Pills({ legend, name, options, value, onChange, error }: { legend: string; name: string; options: [string, string][]; value?: string; onChange: (v: string) => void; error?: string }) {
  return (
    <fieldset className={styles.radioRow}>
      <legend>{legend}</legend>
      <div className={styles.segmented}>
        {options.map(([v, label]) => (
          <label key={v} className={styles.segment}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
      {error && <span role="alert" className={styles.fieldError}>{error}</span>}
    </fieldset>
  );
}

/** One end of the stay: its date and time fields, edited together in the date-and-time picker. */
function StayPicker({ control, dateName, timeName, heading, error, onDirty }: {
  control: Control<PreauthDetailsInput>;
  dateName: "admissionDate" | "dischargeDate";
  timeName: "admissionTime" | "dischargeTime";
  heading: string;
  error?: string;
  onDirty?: (d: boolean) => void;
}) {
  const headingId = useId();
  const date = useController({ control, name: dateName });
  const time = useController({ control, name: timeName });
  return (
    <div className={styles.dateTime} data-no-dirty>
      <span id={headingId} className={styles.stayHeading}>{heading}</span>
      <DateTimePicker
        required
        labelledBy={headingId}
        value={{ date: (date.field.value as string | undefined) || undefined, time: (time.field.value as string | undefined) || undefined }}
        onChange={(v) => {
          date.field.onChange(v.date ?? "");
          time.field.onChange(v.time ?? "");
          onDirty?.(true);
        }}
        error={error}
      />
    </div>
  );
}

/**
 * Past history of chronic illness: pick common conditions from the list, or type any other. Each choice shows as a chip
 * that can be removed; "None" can't be combined with a condition.
 */
export function ChronicIllnessInput({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const id = useId();
  const [other, setOther] = useState("");
  const add = (x: string) => {
    const t = x.trim().replace(/\s+/g, " ");
    if (t.length < 2 || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange(t === "None" ? ["None"] : [...value.filter((v) => v !== "None"), t]);
  };
  const addOther = () => {
    add(other);
    setOther("");
  };
  return (
    <fieldset className={styles.radioRow} aria-describedby={error ? `${id}-err` : undefined}>
      <legend>Past History of Chronic Illness *</legend>
      <div className={styles.illnessRow}>
        <SelectField
          label="Choose a condition"
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value);
          }}
        >
          <option value="">Select from the list…</option>
          {CHRONIC_ILLNESSES.filter((x) => !value.includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
        </SelectField>
        <div className={styles.illnessOther}>
          <TextField
            label="Or type another condition"
            value={other}
            maxLength={80}
            placeholder="e.g. Thyroid disorder"
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOther();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addOther} disabled={other.trim().length < 2}>Add</Button>
        </div>
      </div>
      {value.length > 0 && (
        <ul className={styles.illnessChips} aria-label="Chosen conditions">
          {value.map((v) => (
            <li key={v} className={styles.illnessChip}>
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {error && <span id={`${id}-err`} role="alert" className={styles.fieldError}>{error}</span>}
    </fieldset>
  );
}

/**
 * Step 2: Clinical Details & Package. The same schema runs on the server (wizardClinicalSchema), so these messages are only
 * an early copy of the server's answer. "Register the Case" saves it.
 */
export function WizardClinicalForm({
  defaults,
  diagnoses,
  procedures,
  departments,
  save,
  onSaved,
  onDirty,
  disabled,
}: {
  defaults: PreauthDetailsInput;
  diagnoses: Coded[];
  procedures: Coded[];
  departments: string[];
  save: (v: PreauthDetailsInput) => Promise<ActionResult>;
  onSaved: () => void;
  /** Reports unsaved edits (true on any change, false once saved). */
  onDirty?: (dirty: boolean) => void;
  disabled?: boolean;
}) {
  const { register, handleSubmit, setError, control, formState } = useForm<PreauthDetailsInput>({
    resolver: zodResolver(wizardClinicalSchema),
    defaultValues: {
      treatmentType: "medical",
      admissionType: "planned",
      ...defaults,
      costItems: defaults.costItems?.length ? defaults.costItems : [{ head: "Room rent", description: "", perDay: "" as unknown as number, days: 1 }],
    },
  });
  const { formError, apply } = useServerResult(setError);
  const items = useFieldArray({ control, name: "costItems" });
  const watchedItems = useWatch({ control, name: "costItems" });
  const packageAmount = useWatch({ control, name: "packageAmount" });
  const diagnosisIds = (useWatch({ control, name: "diagnosisIds" }) as string[] | undefined) ?? [];
  const [admissionDate, admissionTime, dischargeDate, dischargeTime] = useWatch({ control, name: ["admissionDate", "admissionTime", "dischargeDate", "dischargeTime"] }) as (string | undefined)[];
  const e = formState.errors;
  const [costOpen, setCostOpen] = useState(false);
  const costInvalid = !!(e.costItems || e.packageAmount);

  const total = expectedCost(watchedItems as { perDay?: unknown; days?: unknown }[], packageAmount);
  const days = stayDays(admissionDate, admissionTime, dischargeDate, dischargeTime);
  const codes = diagnosisIds.map((id) => diagnoses.find((d) => d.id === id)?.code).filter(Boolean).join(", ");
  const costErr = (i: number, k: "head" | "description" | "perDay" | "days") => (e.costItems?.[i] as Record<string, { message?: string }> | undefined)?.[k]?.message;
  const err = (k: string) => (e as Record<string, { message?: string } | undefined>)[k]?.message;

  return (
    <form
      id={CLINICAL_FORM_ID}
      className={formStyles.form}
      noValidate
      onChange={() => onDirty?.(true)}
      onClick={(e) => {
        // Chips, + Add a Head, Remove and list picks change values without a native change event (the date-and-time
        // picker reports its own changes on Confirm).
        const t = e.target as HTMLElement;
        if (!t.closest("[data-no-dirty]") && t.closest("button:not([type=submit]), [role=option]")) onDirty?.(true);
      }}
      onSubmit={handleSubmit(
        async (v) => {
          if (apply(await save(v))) {
            onDirty?.(false);
            onSaved();
          }
        },
        (errs) => {
          // A problem inside the cost dropdown opens it so the message is seen.
          if (errs.costItems || errs.packageAmount) setCostOpen(true);
        },
      )}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      <fieldset disabled={disabled} className={styles.plainFieldset}>
        <FormSection title="Medical details">
          <FormGrid>
            <FullWidth>
              <Controller
                control={control}
                name="procedureId"
                render={({ field }) => (
                  <ComboBox
                    label="Treatment / Packages"
                    placeholder="Search the package or treatment"
                    options={procedures.map((p) => ({ value: p.id, label: p.name, hint: p.code }))}
                    value={field.value ? [String(field.value)] : []}
                    onChange={(v) => field.onChange(v[0] ?? "")}
                    error={err("procedureId")}
                  />
                )}
              />
            </FullWidth>
            <FullWidth>
              <Controller
                control={control}
                name="treatmentType"
                render={({ field }) => (
                  <Pills legend="Line of Treatment" name="treatmentType" options={[["medical", "Medical"], ["surgical", "Surgical"]]} value={field.value as string | undefined} onChange={field.onChange} error={err("treatmentType")} />
                )}
              />
            </FullWidth>
            <FullWidth>
              <Controller
                control={control}
                name="diagnosisIds"
                render={({ field }) => (
                  <ComboBox
                    label="Diagnoses"
                    required
                    multiple
                    placeholder="Search by name or ICD-10 code"
                    options={diagnoses.map((d) => ({ value: d.id, label: `${d.name} (${d.code})`, hint: d.code }))}
                    value={(field.value as string[] | undefined) ?? []}
                    onChange={field.onChange}
                    error={err("diagnosisIds")}
                    hint="The first is the primary diagnosis."
                  />
                )}
              />
            </FullWidth>
            <TextField label="ICD-10 Codes" readOnly value={codes} placeholder="Filled from the diagnoses" />
            <FullWidth>
              <TextAreaField label="Presenting Complaint" required rows={3} placeholder={COMPLAINT_SAMPLE} error={err("symptoms")} {...register("symptoms")} />
            </FullWidth>
            <FullWidth>
              <fieldset className={styles.radioRow}>
                <legend>Length of Stay *</legend>
                <div className={styles.stayRow}>
                  <StayPicker control={control} dateName="admissionDate" timeName="admissionTime" heading="Stay starts" error={err("admissionDate")} onDirty={onDirty} />
                  <StayPicker control={control} dateName="dischargeDate" timeName="dischargeTime" heading="Stay ends" error={err("dischargeDate")} onDirty={onDirty} />
                </div>
                <p className={styles.stayTotal} data-testid="stay-total">Total stay: {days ?? "—"} {days === 1 ? "day" : "days"}</p>
              </fieldset>
            </FullWidth>
          </FormGrid>
        </FormSection>

        <FormSection title="Hospitalization details">
          <FormGrid>
            <FullWidth>
              <Controller
                control={control}
                name="admissionType"
                render={({ field }) => (
                  <Pills legend="Admission Type" name="admissionType" options={[["planned", "Planned"], ["emergency", "Emergency"]]} value={field.value as string | undefined} onChange={field.onChange} error={err("admissionType")} />
                )}
              />
            </FullWidth>
            <TextField label="Treating Doctor" required error={err("doctorName")} {...register("doctorName")} />
            <TextField label="Department" list="wizard-departments" error={err("department")} {...register("department")} />
            <datalist id="wizard-departments">{departments.map((d) => <option key={d} value={d} />)}</datalist>
            <TextField label="Room Category" list="wizard-rooms" placeholder="e.g. Twin sharing" error={err("roomCategory")} {...register("roomCategory")} />
            <datalist id="wizard-rooms">{ROOM_CATEGORIES.map((d) => <option key={d} value={d} />)}</datalist>
            <FullWidth>
              <Controller
                control={control}
                name="chronicIllness"
                render={({ field }) => (
                  <ChronicIllnessInput value={(field.value as string[] | undefined) ?? []} onChange={field.onChange} error={err("chronicIllness")} />
                )}
              />
            </FullWidth>
          </FormGrid>
        </FormSection>

        <details
          className={styles.collapsible}
          open={costOpen || costInvalid}
          onToggle={(ev) => setCostOpen((ev.currentTarget as HTMLDetailsElement).open)}
          data-testid="cost-section"
        >
          <summary>
            Expected Cost Breakdown <span className={styles.summaryTotal}>{total === null ? "not entered" : formatINR(total)}</span>
          </summary>
          <div className={styles.collapsibleBody}>
          <p className={styles.muted}>The payer decides the approved amount; this is the hospital&apos;s estimate.</p>
          <div className={styles.tableWrap}>
            <table className={styles.costTable} aria-label="Expected cost breakdown">
              <thead>
                <tr>
                  <th scope="col">Head</th>
                  <th scope="col">What it covers</th>
                  <th scope="col" className={styles.num}>Per day</th>
                  <th scope="col" className={styles.num}>Days</th>
                  <th scope="col" className={styles.num}>Amount</th>
                  <th scope="col"><span className="visually-hidden">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {items.fields.map((row, i) => {
                  const line = Number(watchedItems?.[i]?.perDay) * Number(watchedItems?.[i]?.days);
                  return (
                    <tr key={row.id}>
                      <td style={{ minWidth: 150 }}>
                        <select aria-label={`Head ${i + 1}`} aria-invalid={!!costErr(i, "head") || undefined} {...register(`costItems.${i}.head`)}>
                          {COST_HEADS.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <input aria-label={`Head ${i + 1} covers`} placeholder="e.g. Twin sharing room" {...register(`costItems.${i}.description`)} />
                      </td>
                      <td className={styles.num} style={{ minWidth: 110 }}>
                        <input aria-label={`Head ${i + 1} per day`} inputMode="decimal" aria-invalid={!!costErr(i, "perDay") || undefined} {...register(`costItems.${i}.perDay`)} />
                        {costErr(i, "perDay") && <span className={styles.cellError}>{costErr(i, "perDay")}</span>}
                      </td>
                      <td className={styles.num} style={{ minWidth: 70 }}>
                        <input aria-label={`Head ${i + 1} days`} inputMode="numeric" aria-invalid={!!costErr(i, "days") || undefined} {...register(`costItems.${i}.days`)} />
                        {costErr(i, "days") && <span className={styles.cellError}>{costErr(i, "days")}</span>}
                      </td>
                      <td className={styles.num}>{Number.isFinite(line) ? formatINR(line) : "—"}</td>
                      <td>
                        <Button type="button" size="sm" variant="ghost" aria-label={`Remove head ${i + 1}`} onClick={() => items.remove(i)}>Remove</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err("costItems") && <span role="alert" className={styles.fieldError}>{err("costItems")}</span>}
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => items.append({ head: "Other", description: "", perDay: "" as unknown as number, days: days ?? 1 })} disabled={items.fields.length >= 50}>
              + Add a Head
            </Button>
          </div>
          <FormGrid>
            <TextField label="All-inclusive package (₹)" inputMode="decimal" hint="leave empty if the case is billed head by head" error={err("packageAmount")} {...register("packageAmount")} />
            <div className={styles.costTotal} aria-live="polite">
              <span className={styles.muted}>Expected Cost</span>
              <strong data-testid="cost-total">{total === null ? "—" : formatINR(total)}</strong>
              <span className={styles.muted}>{packageAmount !== undefined && packageAmount !== "" ? "all-inclusive package" : "sum of the heads"}</span>
            </div>
          </FormGrid>
          </div>
        </details>

        <details className={styles.collapsible}>
          <summary>Pre-Auth Form Details (IRDAI)</summary>
          <div className={styles.collapsibleBody}>
            <FormSection title="1. Filled by the insured / patient">
              <FormGrid>
                <TextField label="Family Physician" error={err("familyPhysician")} {...register("familyPhysician")} />
                <TextField label="Family Physician's Contact" type="tel" inputMode="numeric" maxLength={10} error={err("familyPhysicianContact")} {...register("familyPhysicianContact")} />
                <TextField label="Current Address" error={err("currentAddress")} {...register("currentAddress")} />
                <TextField label="Occupation" error={err("occupation")} {...register("occupation")} />
              </FormGrid>
            </FormSection>
            <FormSection title="2. Filled by the treating doctor / hospital">
              <FormGrid>
                <FullWidth><TextAreaField label="Relevant Critical Findings" rows={2} error={err("criticalFindings")} {...register("criticalFindings")} /></FullWidth>
                <TextField label="Duration of the Present Ailment (Days)" inputMode="numeric" error={err("ailmentDurationDays")} {...register("ailmentDurationDays")} />
                <TextField label="Route of Drug Administration" placeholder="IV, oral, IM…" error={err("drugRoute")} {...register("drugRoute")} />
                <FullWidth><TextField label="Past History of the Present Ailment" error={err("presentAilmentHistory")} {...register("presentAilmentHistory")} /></FullWidth>
                <TextField label="Doctor's Registration Number" error={err("doctorRegistrationNo")} {...register("doctorRegistrationNo")} />
                <SelectField label="Due to an accident?" {...register("isAccident")}>
                  <option value="unknown">Not known yet</option><option value="yes">Yes</option><option value="no">No</option>
                </SelectField>
                <SelectField label="Pre-existing disease declared?" hint="As declared on the policy proposal." {...register("pedDeclared")}>
                  <option value="unknown">Not known yet</option><option value="yes">Yes</option><option value="no">No</option>
                </SelectField>
                <SelectField label="Is this treatment related to that disease?" error={err("pedRelated")} {...register("pedRelated")}>
                  <option value="unknown">Not known yet</option><option value="yes">Yes</option><option value="no">No</option>
                </SelectField>
              </FormGrid>
            </FormSection>
            <FormSection title="3. The stay">
              <FormGrid>
                <TextField label="Days in ICU" inputMode="numeric" error={err("icuDays")} {...register("icuDays")} />
              </FormGrid>
            </FormSection>
          </div>
        </details>
      </fieldset>
    </form>
  );
}
