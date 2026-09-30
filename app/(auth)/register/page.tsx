import Link from "next/link";
import type { Metadata } from "next";
import { RequestAccessForm } from "./RequestAccessForm";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Request access · Claimix" };

export default function RegisterPage() {
  return (
    <>
      <div>
        <h1>Request access</h1>
        <p className={styles.muted}>
          Accounts are created by an administrator after checking your organization. Tell us who you are and we&apos;ll get back to you by email.
        </p>
      </div>
      <RequestAccessForm />
      <p className={styles.muted}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
