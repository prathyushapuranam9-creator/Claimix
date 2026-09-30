"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { GOVERNMENT_PRODUCT_TYPES, POLICY_INFO_FIELDS, PRIVATE_PRODUCT_TYPES, policyInputSchema, type PolicyInfoKey, type PolicyInput } from "@/modules/policies/policies.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormActions, FormGrid, FormSection, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

type Opt = { id: string; name: string };

export function PolicyForm({
  action,
  defaults,
  insurers,
  tpas,
  schemes,
  lockCategory,
  cancelHref,
  submitLabel,
}: {
  action: (i: PolicyInput) => Promise<ActionResult>;
  defaults?: Partial<PolicyInput>;
  insurers: Opt[];
  tpas: Opt[];
  schemes: Opt[];
  lockCategory?: boolean;
  cancelHref: string;
  submitLabel: string;
}) {
  const { register, handleSubmit, setError, control, formState } = useForm<PolicyInput>({
    resolver: zodResolver(policyInputSchema),
    defaultValues: { category: "private", ...defaults },
  });
  const { formError, apply } = useServerResult(setError);
  const category = useWatch({ control, name: "category" });
  const types = category === "government" ? GOVERNMENT_PRODUCT_TYPES : PRIVATE_PRODUCT_TYPES;
  const e = formState.errors as Record<string, { message?: string } | undefined>;

  return (
    <form className={formStyles.form} onSubmit={handleSubmit(async (v) => apply(await action(v)))} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormSection title="Product">
        <FormGrid>
          <SelectField label="Category" required hint={lockCategory ? "Category can't change after creation." : undefined} error={e.category?.message} {...register("category")}>
            {(!lockCategory || category === "private") && <option value="private">Private insurance</option>}
            {(!lockCategory || category === "government") && <option value="government">Government scheme</option>}
          </SelectField>
          <SelectField label="Product type" required error={e.productType?.message} {...register("productType")}>
            <option value="">Select…</option>
            {Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <FullWidth>
            <TextField label={category === "government" ? "Scheme cover name" : "Policy name"} required error={e.name?.message} {...register("name")} />
          </FullWidth>
          {category === "private" ? (
            <>
              <SelectField label="Insurer" required error={e.insurerId?.message} {...register("insurerId")}>
                <option value="">Select insurer…</option>
                {insurers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </SelectField>
              <SelectField label="TPA (optional)" error={e.tpaId?.message} {...register("tpaId")}>
                <option value="">No TPA</option>
                {tpas.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </SelectField>
            </>
          ) : (
            <SelectField label="Government scheme" required error={e.schemeId?.message} {...register("schemeId")}>
              <option value="">Select scheme…</option>
              {schemes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </SelectField>
          )}
          <TextField label="Minimum sum insured (₹)" inputMode="numeric" error={e.sumInsuredMin?.message} {...register("sumInsuredMin")} />
          <TextField label="Maximum sum insured (₹)" inputMode="numeric" error={e.sumInsuredMax?.message} {...register("sumInsuredMax")} />
          <FullWidth>
            <TextAreaField label="Summary" error={e.summary?.message} {...register("summary")} />
          </FullWidth>
        </FormGrid>
      </FormSection>
      <FormSection title="Information shown on policy tabs" hint="Descriptive text only. Eligibility and coverage decisions come from the published rules, never from this text.">
        <FormGrid>
          {(Object.entries(POLICY_INFO_FIELDS) as [PolicyInfoKey, string][]).map(([k, label]) => (
            <TextAreaField key={k} label={label} error={e[k]?.message} {...register(k)} />
          ))}
        </FormGrid>
      </FormSection>
      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>{submitLabel}</Button>
      </FormActions>
    </form>
  );
}
