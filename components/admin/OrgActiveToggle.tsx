"use client";

import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

/** Activate / deactivate an organization. Deactivation blocks sign-in for all its users. */
export function OrgActiveToggle({ active, name, action }: { active: boolean; name: string; action: () => Promise<ActionResult<unknown>> }) {
  const router = useRouter();
  return active ? (
    <ConfirmButton
      label="Deactivate"
      title={`Deactivate ${name}?`}
      body="All users in this organization will be signed out and unable to sign in until it is reactivated. Records are kept."
      confirmLabel="Deactivate"
      tone="danger"
      action={action}
      onDone={() => router.refresh()}
    />
  ) : (
    <ConfirmButton
      label="Reactivate"
      title={`Reactivate ${name}?`}
      body="Users in this organization will be able to sign in again."
      confirmLabel="Reactivate"
      action={action}
      onDone={() => router.refresh()}
    />
  );
}
