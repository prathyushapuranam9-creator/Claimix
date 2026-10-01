import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { organizations, users } from "@/db/schema";
import { setupSystem } from "@/db/setup";
import { ConflictError } from "@/lib/errors";
import { hashPassword, randomToken } from "@/lib/security/crypto";
import { parseOrThrow, zName } from "@/lib/validation";
import { AuditService } from "@/modules/audit/audit.service";
import { emailSchema } from "@/modules/auth/auth.validation";
import { issuePasswordSetup } from "@/modules/auth/password-setup";

export const createAdminSchema = z.object({
  email: emailSchema,
  name: zName,
  org: zName.default("Claimix Administration"),
});

/**
 * Bootstraps an administrator in an installation (used by `npm run admin:create`).
 * Brings system configuration up to date, creates the platform organization once,
 * and issues a one-time password-setup link — no password is ever chosen or shown here.
 */
export async function createAdministrator(db: Db, input: unknown, appUrl: string) {
  const { email, name, org } = parseOrThrow(createAdminSchema, input);
  return db.transaction(async (tx) => {
    const roleIds = await setupSystem(tx);
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictError(`An account for ${email} already exists. Use "Forgot password" or user administration instead.`);

    let [platform] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.type, "platform"), eq(organizations.isDemo, false), isNull(organizations.deletedAt)))
      .limit(1);
    platform ??= (await tx.insert(organizations).values({ type: "platform", name: org }).returning({ id: organizations.id }))[0]!;

    const [user] = await tx
      .insert(users)
      .values({ email, fullName: name, organizationId: platform.id, roleId: roleIds.get("admin")!, passwordHash: await hashPassword(randomToken()) })
      .returning({ id: users.id });
    await AuditService.record(tx, {
      action: "user.created",
      organizationId: platform.id,
      resourceType: "user",
      resourceId: user!.id,
      newState: { role: "admin", via: "admin:create" },
    });
    const setup = await issuePasswordSetup(tx, user!.id, appUrl, "invite");
    return { userId: user!.id, organizationId: platform.id, ...setup };
  });
}
