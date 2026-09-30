"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema } from "@/modules/auth/auth.validation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import { forgotPasswordAction } from "../actions";
import styles from "../auth.module.css";

export function ForgotForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const r = await forgotPasswordAction(values);
    if (r.ok) setDone(true);
    else setError(r.error);
  });

  if (done) {
    return (
      <Alert tone="success" title="Check your email">
        If an account exists for that address, we&apos;ve sent a link to reset the password. The link expires in 30 minutes.
      </Alert>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField label="Email" type="email" autoComplete="email" required error={formState.errors.email?.message} {...register("email")} />
      <Button type="submit" block loading={formState.isSubmitting}>
        Send reset link
      </Button>
    </form>
  );
}
