"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { changePasswordSchema, type ChangePasswordInput } from "@/modules/auth/auth.validation";
import { profileUpdateSchema, type ProfileUpdateInput } from "@/modules/users/users.validation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Details, FormActions, formStyles } from "@/components/ui/Form";
import { PasswordField } from "@/components/ui/PasswordField";
import { Alert, Card, PageHeader, Stack } from "@/components/ui/Surface";
import styles from "./ProfileSettings.module.css";

const SAVE_ERROR = "Unable to update profile. Please try again.";
const PASSWORD_ERROR = "Unable to change password. Please try again.";

type Profile = { fullName: string; email: string };

/** Puts server-side field errors on their inputs; returns the message for the form-level alert. */
function serverError<T extends string>(r: { error: string; fieldErrors?: Record<string, string[]> }, fields: readonly T[], set: (f: T, m: string) => void, fallback: string) {
  let any = false;
  for (const [field, messages] of Object.entries(r.fieldErrors ?? {})) {
    if ((fields as readonly string[]).includes(field) && messages[0]) {
      set(field as T, messages[0]);
      any = true;
    }
  }
  // Known validation / rate-limit messages are shown as-is; anything unexpected gets the generic one.
  return any || r.error !== "Something went wrong. Please try again." ? r.error : fallback;
}

/**
 * Profile Settings for the signed-in user. Name and email are editable (changing the email
 * needs the current password); role, organization and status are admin-controlled and shown
 * read-only. The server re-validates everything and always acts on the session's own user.
 */
export function ProfileSettings({
  user,
  action,
  changePassword,
}: {
  user: { fullName: string; email: string; roleName: string; orgName: string };
  action: (input: ProfileUpdateInput) => Promise<ActionResult<Profile>>;
  changePassword: (input: ChangePasswordInput) => Promise<ActionResult>;
}) {
  // There is no standing Password section: Change Password opens a popup.
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Profile Settings"
        actions={
          <Button
            type="button"
            variant="secondary"
            aria-haspopup="dialog"
            onClick={() => {
              setPasswordNotice(null);
              setPasswordOpen(true);
            }}
          >
            Change Password
          </Button>
        }
      />
      <Stack>
        {passwordNotice && <Alert tone="success">{passwordNotice}</Alert>}
        <DetailsCard user={user} action={action} />
        {passwordOpen && (
          <PasswordDialog
            changePassword={changePassword}
            onClose={() => setPasswordOpen(false)}
            onChanged={() => {
              setPasswordOpen(false);
              setPasswordNotice("Password changed successfully. Other devices have been signed out.");
            }}
          />
        )}
      </Stack>
    </>
  );
}

function DetailsCard({ user, action }: { user: { fullName: string; email: string; roleName: string; orgName: string }; action: (input: ProfileUpdateInput) => Promise<ActionResult<Profile>> }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Profile>({ fullName: user.fullName, email: user.email });
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, control, formState } = useForm<ProfileUpdateInput>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: { ...saved, currentPassword: "" },
  });
  const e = formState.errors;
  const emailChanged = (useWatch({ control, name: "email" }) ?? "").trim().toLowerCase() !== saved.email;

  // Admin-controlled: shown, never editable here. Sessions exist only for active accounts.
  const adminControlled: [string, string][] = [
    ["Role", user.roleName],
    ["Organization", user.orgName],
    ["Status", "Active"],
  ];

  const startEdit = () => {
    reset({ ...saved, currentPassword: "" });
    setFormError(null);
    setNotice(null);
    setEditing(true);
  };

  const cancel = () => {
    // Discard unsaved changes; nothing is sent.
    reset({ ...saved, currentPassword: "" });
    setFormError(null);
    setEditing(false);
  };

  const save = handleSubmit(async (v) => {
    setFormError(null);
    if (emailChanged && !v.currentPassword) {
      setError("currentPassword", { type: "required", message: "Enter your current password to change your email." });
      return;
    }
    let r: ActionResult<Profile>;
    try {
      r = await action({ fullName: v.fullName, email: v.email, currentPassword: emailChanged ? v.currentPassword : undefined });
    } catch {
      setFormError(SAVE_ERROR);
      return;
    }
    if (!r.ok) {
      // Stay in edit mode with the entered values.
      setFormError(serverError(r, ["fullName", "email", "currentPassword"] as const, (f, m) => setError(f, { type: "server", message: m }), SAVE_ERROR));
      return;
    }
    setSaved(r.data);
    reset({ ...r.data, currentPassword: "" });
    setEditing(false);
    setNotice("Profile updated successfully.");
    router.refresh(); // the taskbar, menu and sidebar show the name too
  });

  return (
    <Card
      title="Your details"
      actions={
        !editing && (
          <Button type="button" variant="secondary" size="sm" onClick={startEdit}>
            Edit
          </Button>
        )
      }
    >
      {!editing ? (
        <div className={styles.body}>
          {notice && <Alert tone="success">{notice}</Alert>}
          <Details items={[["Name", saved.fullName], ["Email", saved.email], ...adminControlled]} />
        </div>
      ) : (
        <form className={formStyles.form} onSubmit={save} noValidate aria-label="Edit profile">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <TextField label="Name" required autoComplete="name" error={e.fullName?.message} {...register("fullName")} />
          <TextField label="Email" type="email" required autoComplete="email" hint="Used to sign in." error={e.email?.message} {...register("email")} />
          {emailChanged && (
            <PasswordField
              label="Current password"
              required
              autoComplete="current-password"
              hint="Required to change your sign-in email."
              error={e.currentPassword?.message}
              {...register("currentPassword")}
            />
          )}
          <Details items={adminControlled} />
          <p className={styles.note}>Role, organization and account status are managed by an administrator.</p>
          <FormActions>
            <Button type="button" variant="secondary" onClick={cancel} disabled={formState.isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              {formState.isSubmitting ? "Saving..." : "Save"}
            </Button>
          </FormActions>
        </form>
      )}
    </Card>
  );
}

const EMPTY_PASSWORDS: ChangePasswordInput = { currentPassword: "", newPassword: "", confirmPassword: "" };

/**
 * The Change Password popup: a native modal <dialog> (same pattern as the app's confirm
 * dialogs — focus stays inside, Escape or Cancel closes it). Mounted fresh each time it opens,
 * so it always starts empty and the passwords are discarded when it closes.
 */
function PasswordDialog({
  changePassword,
  onClose,
  onChanged,
}: {
  changePassword: (input: ChangePasswordInput) => Promise<ActionResult>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY_PASSWORDS,
  });
  const e = formState.errors;
  const busy = formState.isSubmitting;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    d.querySelector("input")?.focus();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    let r: ActionResult;
    try {
      r = await changePassword(v);
    } catch {
      setFormError(PASSWORD_ERROR);
      return;
    }
    if (!r.ok) {
      setFormError(serverError(r, ["currentPassword", "newPassword", "confirmPassword"] as const, (f, m) => setError(f, { type: "server", message: m }), PASSWORD_ERROR));
      return;
    }
    onChanged();
  });

  return (
    <dialog
      ref={ref}
      id="change-password"
      className={styles.dialog}
      aria-labelledby={titleId}
      // Escape: keep the dialog while a save is in flight, otherwise close it like Cancel.
      onCancel={(ev) => {
        ev.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id={titleId} className={styles.dialogTitle}>Change Password</h2>
      <form className={formStyles.form} onSubmit={submit} noValidate aria-label="Change password">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <PasswordField label="Current password" required autoComplete="current-password" error={e.currentPassword?.message} {...register("currentPassword")} />
        <PasswordField label="New password" required autoComplete="new-password" hint="At least 12 characters, with a letter and a number." error={e.newPassword?.message} {...register("newPassword")} />
        <PasswordField label="Confirm new password" required autoComplete="new-password" error={e.confirmPassword?.message} {...register("confirmPassword")} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? "Saving..." : "Save password"}
          </Button>
        </FormActions>
      </form>
    </dialog>
  );
}
