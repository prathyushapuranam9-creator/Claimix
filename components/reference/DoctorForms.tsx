"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { todayIso } from "@/lib/validation";
import { useServerResult } from "@/lib/use-action-form";
import { PATIENT_DEPARTMENTS } from "@/modules/patients/patients.validation";
import { doctorInputSchema, slotOpeningSchema, type DoctorInput, type SlotOpeningInput } from "@/modules/scheduling/scheduling.validation";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { FormGrid, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

/** Adds one doctor a hospital offers appointments with. */
export function DoctorForm({ action, hospitals }: { action: (i: DoctorInput) => Promise<ActionResult>; hospitals: { id: string; name: string }[] }) {
  const router = useRouter();
  const { register, handleSubmit, setError, reset, formState } = useForm<DoctorInput>({ resolver: zodResolver(doctorInputSchema) });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        if (apply(await action(v))) {
          reset();
          router.refresh();
        }
      })}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormGrid>
        <SelectField label="Hospital" required error={e.hospitalId?.message} {...register("hospitalId")}>
          <option value="">Select hospital…</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </SelectField>
        <TextField label="Doctor's name" required error={e.fullName?.message} {...register("fullName")} />
        <SelectField label="Department" required error={e.department?.message} {...register("department")}>
          <option value="">Select department…</option>
          {Object.entries(PATIENT_DEPARTMENTS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </SelectField>
        <TextField label="Medical registration no." error={e.registrationNo?.message} {...register("registrationNo")} />
        <TextField label="Consultation fee (₹)" required inputMode="decimal" error={e.consultationFee?.message} {...register("consultationFee")} />
      </FormGrid>
      <div className={formStyles.actionsInline}>
        <Button type="submit" loading={formState.isSubmitting}>Add doctor</Button>
      </div>
    </form>
  );
}

/** Opens equal-length slots for one doctor on one day. */
export function SlotForm({ action, doctors }: { action: (i: SlotOpeningInput) => Promise<ActionResult<{ opened: number; requested: number }>>; doctors: { id: string; label: string }[] }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<SlotOpeningInput>({
    resolver: zodResolver(slotOpeningSchema),
    defaultValues: { slotDate: todayIso(), from: "09:00", to: "13:00", minutes: 20 },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  if (!doctors.length) return <p>Add a doctor first; slots are opened per doctor.</p>;

  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        const r = await action(v);
        if (apply(r) && r.ok) {
          setNote(r.data.opened === r.data.requested ? `${r.data.opened} slots opened.` : `${r.data.opened} new slots opened; ${r.data.requested - r.data.opened} already existed.`);
          router.refresh();
        }
      })}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      {note && <Alert tone="success">{note}</Alert>}
      <FormGrid>
        <SelectField label="Doctor" required error={e.doctorId?.message} {...register("doctorId")}>
          <option value="">Select doctor…</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </SelectField>
        <TextField label="Date" type="date" required error={e.slotDate?.message} {...register("slotDate")} />
        <TextField label="From" type="time" required error={e.from?.message} {...register("from")} />
        <TextField label="To" type="time" required error={e.to?.message} {...register("to")} />
        <TextField label="Slot length (minutes)" required inputMode="numeric" error={e.minutes?.message} {...register("minutes")} />
      </FormGrid>
      <div className={formStyles.actionsInline}>
        <Button type="submit" loading={formState.isSubmitting}>Open slots</Button>
      </div>
    </form>
  );
}
