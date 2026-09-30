"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@/modules/auth/auth.validation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Surface";
import { loginAction } from "../actions";
import styles from "../auth.module.css";

type Values = { email: string; password: string };

export function LoginForm({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const result = await loginAction({ ...values, next });
    // On success the action redirects; we only get here on failure.
    if (result && !result.ok) setError(result.error);
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField label="Email" type="email" autoComplete="username" required error={formState.errors.email?.message} {...register("email")} />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={formState.errors.password?.message}
        {...register("password")}
      />
      <div className={styles.row}>
        <span />
        <Link href="/forgot-password">Forgot password?</Link>
      </div>
      <Button type="submit" block loading={formState.isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
