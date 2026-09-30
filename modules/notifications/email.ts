import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/**
 * Development sender: writes messages to a private outbox folder instead of
 * sending or logging them (reset links are secrets and must not reach logs).
 * Replace with an SMTP/provider adapter in production.
 */
export function outboxSender(dir: string): EmailSender {
  return {
    async send(msg) {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}.txt`);
      await writeFile(file, `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`, { mode: 0o600 });
    },
  };
}

const TEMPLATES: Record<string, (p: Record<string, unknown>) => { subject: string; text: string }> = {
  password_reset: (p) => ({
    subject: "Reset your Claimix password",
    text: `Use this link to set a new password. It expires in 30 minutes and can be used once.\n\n${String(p.link)}\n\nIf you didn't ask for this, you can ignore this email.`,
  }),
  invite: (p) => ({
    subject: "You have been invited to Claimix",
    text: `An administrator created a Claimix account for you. Use this link to set your password. It expires in 72 hours and can be used once.

${String(p.link)}`,
  }),
  notification: (p) => ({ subject: String(p.title ?? "Claimix update"), text: String(p.body ?? "") }),
};

/** Job handler for "email.send": resolves the recipient at send time from userId. */
export function emailJobHandler(db: Db, sender: EmailSender) {
  return async (payload: Record<string, unknown>) => {
    const tpl = TEMPLATES[String(payload.template)];
    if (!tpl) throw new Error("Unknown email template");
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, String(payload.userId))).limit(1);
    if (!u) return; // user removed since enqueue
    await sender.send({ to: u.email, ...tpl(payload) });
  };
}
