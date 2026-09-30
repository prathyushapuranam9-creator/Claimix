"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { accessRequestSchema, ORGANIZATION_TYPES, type AccessRequestInput } from "@/modules/access-requests/access-requests.validation";
import { useServerResult } from "@/lib/use-action-form";
import { Button } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import { requestAccessAction } from "../actions";
import styles from "../auth.module.css";

export function RequestAccessForm() {
  const [done, setDone] = useState(false);
  const { register, handleSubmit, setError, formState } = useForm<AccessRequestInput>({
    resolver: zodResolver(accessRequestSchema),
    defaultValues: { organizationType: "" },
  });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    if (apply(await requestAccessAction(values))) setDone(true);
  });

  if (done) {
    return (
      <Alert tone="success" title="Request received">
        Thank you. An administrator will review your request and contact you by email. No account has been created yet.
      </Alert>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <TextField label="Full name" autoComplete="name" required error={e.fullName?.message} {...register("fullName")} />
      <TextField label="Work email" type="email" autoComplete="email" required error={e.email?.message} {...register("email")} />
      <TextField label="Organization" autoComplete="organization" required error={e.organizationName?.message} {...register("organizationName")} />
      <SelectField label="Organization type" required error={e.organizationType?.message} {...register("organizationType")}>
        <option value="" disabled>Choose…</option>
        {ORGANIZATION_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </SelectField>
      <TextField label="Job title" autoComplete="organization-title" error={e.jobTitle?.message} {...register("jobTitle")} />
      <TextField label="Phone" type="tel" autoComplete="tel" error={e.phone?.message} {...register("phone")} />
      <TextAreaField label="Anything we should know?" rows={3} maxLength={1000} error={e.message?.message} {...register("message")} />
      {/* Honeypot: invisible to people and assistive tech; bots that fill it are ignored. */}
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>
      <p className={styles.muted}>Please don&apos;t include any patient or medical information.</p>
      <Button type="submit" block loading={formState.isSubmitting}>
        Send request
      </Button>
    </form>
  );
}
