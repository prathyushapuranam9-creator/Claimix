import Link from "next/link";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/Surface";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Set a new password · Claimix", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1>Set a new password</h1>
      {token ? (
        <ResetForm token={token} />
      ) : (
        <Alert tone="warning" title="This link is incomplete">
          Open the full link from your email, or <Link href="/forgot-password">request a new one</Link>.
        </Alert>
      )}
    </>
  );
}
