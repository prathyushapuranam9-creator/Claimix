import type { DbOrTx } from "@/db/client";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { JobQueue } from "@/modules/jobs/job-queue";
import { AuthRepository } from "./auth.repository";

const TTL_MS = { reset: 30 * 60 * 1000, invite: 72 * 60 * 60 * 1000 } as const;

/**
 * Creates a one-time password link (hash stored, raw token only in the queued
 * email) inside the caller's transaction. Used for resets and new-user invites.
 */
export async function issuePasswordSetup(db: DbOrTx, userId: string, appUrl: string, kind: "reset" | "invite") {
  const token = randomToken();
  await AuthRepository.createResetToken(db, userId, sha256Hex(token), new Date(Date.now() + TTL_MS[kind]));
  await JobQueue.enqueue(db, "email.send", {
    template: kind === "invite" ? "invite" : "password_reset",
    userId,
    link: `${appUrl}/reset-password?token=${encodeURIComponent(token)}`,
  });
}
