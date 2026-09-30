import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Sign in · Claimix" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <>
      <div>
        <h1>Sign in</h1>
        <p className={styles.muted}>For hospital staff, insurer and TPA reviewers, patients and administrators.</p>
      </div>
      <LoginForm next={next} />
      {process.env.NODE_ENV !== "production" && (
        <p className={styles.demo}>
          DEMO DATA accounts: <code>staff.a@demo.claimix.invalid</code>, <code>insurer.a@demo.claimix.invalid</code>,{" "}
          <code>patient.a1@demo.claimix.invalid</code>, <code>admin@demo.claimix.invalid</code>. The password is the{" "}
          <code>SEED_DEMO_PASSWORD</code> in your <code>.env.local</code>.
        </p>
      )}
    </>
  );
}
