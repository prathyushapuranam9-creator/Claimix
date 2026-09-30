"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@/modules/auth/auth.validation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import { resetPasswordAction } from "../actions";
import styles from "../auth.module.css";

export function ResetForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const r = await resetPasswordAction(values);
    if (r.ok) setDone(true);
    else setError(r.error);
  });

  if (done) {
    return (
      <Alert tone="success" title="Password updated">
        You&apos;ve been signed out on all devices. <Link href="/login">Sign in with your new password.</Link>
      </Alert>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <input type="hidden" {...register("token")} />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 12 characters, with a letter and a number."
        error={formState.errors.password?.message}
        {...register("password")}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        error={formState.errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      <Button type="submit" block loading={formState.isSubmitting}>
        Set new password
      </Button>
    </form>
  );
}
