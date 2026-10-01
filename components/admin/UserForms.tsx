"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { roleFitsOrg, type OrgType } from "@/lib/permissions/catalog";
import { useServerResult } from "@/lib/use-action-form";
import { userCreateSchema, userUpdateSchema, type UserCreateInput, type UserUpdateInput } from "@/modules/users/users.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Checkbox, FormActions, FormGrid, formStyles } from "@/components/ui/Form";
import { Alert } from "@/components/ui/Surface";

type Role = { id: string; key: string; name: string; orgType: OrgType | null };
type Org = { id: string; name: string; type: OrgType };

export function CreateUserForm({ action, roles, orgs }: { action: (i: UserCreateInput) => Promise<ActionResult>; roles: Role[]; orgs: Org[] }) {
  const { register, handleSubmit, setError, control, formState } = useForm<UserCreateInput>({ resolver: zodResolver(userCreateSchema) });
  const { formError, apply } = useServerResult(setError);
  const roleId = useWatch({ control, name: "roleId" });
  const role = roles.find((r) => r.id === roleId);
  const orgType = role?.orgType;
  // Only organizations matching the chosen role's type are offered (the server enforces this too).
  const orgOptions = role ? orgs.filter((o) => roleFitsOrg(role, o.type)) : [];
  const e = formState.errors;

  return (
    <form className={formStyles.form} onSubmit={handleSubmit(async (v) => apply(await action(v)))} noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Alert tone="info">The user receives a one-time link to set their own password. You never choose or see it.</Alert>
      <FormGrid>
        <TextField label="Full name" required error={e.fullName?.message} {...register("fullName")} />
        <TextField label="Work email" type="email" required autoComplete="off" error={e.email?.message} {...register("email")} />
        <SelectField label="Role" required error={e.roleId?.message} {...register("roleId")}>
          <option value="">Select role…</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </SelectField>
        <SelectField label="Organization" required disabled={!orgType} hint={orgType ? undefined : "Choose a role first."} error={e.organizationId?.message} {...register("organizationId")}>
          <option value="">Select organization…</option>
          {orgOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </SelectField>
      </FormGrid>
      <FormActions>
        <ButtonLink href="/admin/users" variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>Create and send invite</Button>
      </FormActions>
    </form>
  );
}

export function EditUserForm({
  action,
  roles,
  defaults,
  isSelf,
}: {
  action: (i: UserUpdateInput) => Promise<ActionResult>;
  roles: Role[];
  defaults: UserUpdateInput;
  isSelf: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, setError, formState } = useForm<UserUpdateInput>({ resolver: zodResolver(userUpdateSchema), defaultValues: defaults });
  const { formError, apply } = useServerResult(setError);
  const e = formState.errors;
  return (
    <form
      className={formStyles.form}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setSaved(false);
        if (apply(await action(v))) setSaved(true);
      })}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      {saved && <Alert tone="success">Saved. If the role or status changed, the user has been signed out everywhere.</Alert>}
      <FormGrid>
        <TextField label="Full name" required error={e.fullName?.message} {...register("fullName")} />
        <SelectField label="Role" required hint={isSelf ? "You can't change your own role." : undefined} error={e.roleId?.message} {...register("roleId")}>
          {(isSelf ? roles.filter((r) => r.id === defaults.roleId) : roles).map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </SelectField>
        {isSelf ? <p>You can&apos;t deactivate your own account.</p> : <Checkbox label="Account active" {...register("isActive")} />}
      </FormGrid>
      <div>
        <Button type="submit" loading={formState.isSubmitting}>Save changes</Button>
      </div>
    </form>
  );
}
