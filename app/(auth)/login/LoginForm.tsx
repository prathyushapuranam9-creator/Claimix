"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { rememberAccount } from "@/lib/auth/remembered-accounts";
import { offerToSaveLogin, requestSavedLogin } from "@/lib/auth/save-credential";
import { EmailWithSuggestions } from "@/components/auth/EmailWithSuggestions";
import { loginSchema } from "@/modules/auth/auth.validation";
import { Button } from "@/components/ui/Button";
import { PasswordField } from "@/components/ui/PasswordField";
import { Alert } from "@/components/ui/Surface";
import { loginAction } from "../actions";
import styles from "../auth.module.css";

type LoginResult = Awaited<ReturnType<typeof loginAction>>;

/**
 * A real <form action> submission with stable id/name/autocomplete attributes, so the
 * browser's password manager recognises the sign-in. After the server accepts a login we
 * explicitly offer to save it (Credential Management API); the browser then suggests saved
 * accounts in its own dropdown when the email field is focused and fills both fields.
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
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

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
      rememberAccount(values.email); // email only, for the suggestions on this device
      await offerToSaveLogin(values.email, values.password);
      router.replace(result.data.next);
    });
  }

  // A saved account was chosen: fill the email, then ask the browser's password manager for its
  // password (masked field). Without that support, focus the password so the browser can autofill it.
  async function pickSaved() {
    setErrors({});
    const saved = await requestSavedLogin();
    if (saved && emailRef.current && passwordRef.current) {
      emailRef.current.value = saved.email;
      passwordRef.current.value = saved.password;
      return;
    }
    passwordRef.current?.focus();
  }

  return (
    <>
      <form className={styles.form} action={formAction} onSubmit={onSubmit} noValidate>
        {state && !state.ok && !pending && <Alert tone="danger">{state.error}</Alert>}
        <input type="hidden" name="next" value={next ?? ""} />
        <EmailWithSuggestions inputRef={emailRef} onPick={() => void pickSaved()} error={errors.email} />
        <PasswordField
          ref={passwordRef}
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
