import Link from "next/link";
import type { Metadata } from "next";
import { ForgotForm } from "./ForgotForm";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Reset password · Claimix" };

export default function ForgotPasswordPage() {
  return (
    <>
      <div>
        <h1>Reset your password</h1>
        <p className={styles.muted}>Enter the email you sign in with and we&apos;ll send you a reset link.</p>
      </div>
      <ForgotForm />
      <p className={styles.muted}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}
