"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
import { offerToSaveLogin } from "@/lib/auth/save-credential";
import { loginSchema } from "@/modules/auth/auth.validation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { Alert } from "@/components/ui/Surface";
import { loginAction } from "../actions";
import styles from "../auth.module.css";

type LoginResult = Awaited<ReturnType<typeof loginAction>>;

/**
 * A real <form action> submission with stable id/name/autocomplete attributes, so the
 * browser's password manager recognises the sign-in. After the server accepts a login we
 * explicitly offer to save it (Credential Management API); the browser then suggests saved
 * logins in its own dropdown when the email field is focused and fills both fields. The email
 * field is a plain credential input on purpose: no custom menus compete with that dropdown.
 * Passwords are never stored or displayed by Claimix.
 *
 * Email and password are uncontrolled inputs: the browser owns their values, so autofill from
 * a password manager (even when it fires no input events) is never overwritten by a re-render,
 * and a failed attempt keeps what was typed. Submission reads the values from the form itself.
 */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  // Without JavaScript the browser posts the form to the server action (native path).
  const [serverState, formAction] = useActionState(loginAction, null);
  // With JavaScript, onSubmit calls the action itself so the success steps run as soon as the
  // server answers — before the refreshed page (which redirects signed-in users) replaces this form.
  const [clientState, setClientState] = useState<LoginResult | null>(null);
  const [pending, startSubmit] = useTransition();
  const state = clientState ?? serverState;
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    try {
      // Clean up what earlier versions kept in this browser (an email list; the last portal chosen).
      localStorage.removeItem("claimix.rememberedAccounts");
      localStorage.removeItem("claimix.lastPortal");
    } catch {
      // Storage unavailable: nothing to clean up.
    }
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // Read the submitted fields so values filled in by the browser's autofill are always used.
    const values = { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
    // Quick client-side check; the server validates everything again.
    const r = loginSchema.safeParse(values);
    if (!r.success) {
      const f = r.error.flatten().fieldErrors;
      setErrors({ email: f.email?.[0], password: f.password?.[0] });
      return;
    }
    setErrors({});
    form.set("enhanced", "1");
    startSubmit(async () => {
      const result = await loginAction(null, form);
      setClientState(result);
      if (!result.ok) return;
      await offerToSaveLogin(values.email, values.password);
      router.replace(result.data.next);
    });
  }

  return (
    <>
      <form className={styles.form} action={formAction} onSubmit={onSubmit} noValidate>
        {state && !state.ok && !pending && <Alert tone="danger">{state.error}</Alert>}
        <input type="hidden" name="next" value={next ?? ""} />
        <TextField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          error={errors.email}
        />
        <PasswordField
          id="password"
          name="password"
          label="Password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
        <div className={styles.row}>
          <span />
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" block loading={pending || !!state?.ok}>
          Sign in
        </Button>
      </form>
    </>
  );
}
