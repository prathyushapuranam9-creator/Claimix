import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { organizations, users } from "@/db/schema";
import { setupSystem } from "@/db/setup";
import { ValidationError } from "@/lib/errors";
import { hashPassword } from "@/lib/security/crypto";
import { AuditService } from "@/modules/audit/audit.service";
import { AuthRepository } from "@/modules/auth/auth.repository";
import { emailSchema } from "@/modules/auth/auth.validation";

/**
 * The three shared demo logins, one per portal. Emails are fixed here; passwords are never in the
 * source — they come from the environment (`.env.local`, git-ignored) and are stored only as hashes.
 * The portal each one opens follows from its organization, exactly like any other account.
 */
export const DEMO_ACCOUNTS = [
  { key: "admin", email: "admin@claimix.com", name: "Claimix Administrator", role: "admin", orgType: "platform", passwordEnv: "DEMO_ADMIN_PASSWORD" },
  { key: "insurer", email: "insurer@claimix.com", name: "Claimix Insurer Reviewer", role: "payer_reviewer", orgType: "insurer", passwordEnv: "DEMO_INSURER_PASSWORD" },
  { key: "hospital", email: "hospital@claimix.com", name: "Claimix Hospital Staff", role: "hospital_staff", orgType: "hospital", passwordEnv: "DEMO_HOSPITAL_PASSWORD" },
] as const;

export type DemoAccountKey = (typeof DEMO_ACCOUNTS)[number]["key"];

export interface DemoAccountResult {
  email: string;
  status: "created" | "updated";
  organization: string;
}

/** The organization each login belongs to: an explicit name, or the first active one of that type by name. */
async function orgFor(db: DbOrTx, type: "platform" | "hospital" | "insurer", preferred?: string) {
  const rows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.type, type), eq(organizations.isActive, true), isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.name));
  if (preferred) {
    const match = rows.find((r) => r.name.toLowerCase() === preferred.toLowerCase());
    if (!match) throw new ValidationError(`No active ${type} organization named "${preferred}".`);
    return match;
  }
  if (type === "platform") {
    return rows[0] ?? (await db.insert(organizations).values({ type: "platform", name: "Claimix Administration" }).returning({ id: organizations.id, name: organizations.name }))[0]!;
  }
  if (!rows[0]) throw new ValidationError(`There is no active ${type} organization yet. Create one first (Administrator → ${type === "hospital" ? "Hospitals" : "Insurance companies"}).`);
  return rows[0];
}

/**
 * Creates the three demo logins, or brings existing ones back to their demo settings (password, role,
 * organization, active). The insurer login gets the existing "insurance portal testing" flag, so this ONE
 * account can switch to every insurance company; ordinary insurer users are untouched and stay limited to
 * their own company. Changing an existing account signs out its other sessions.
 */
export async function configureDemoAccounts(
  db: DbOrTx,
  passwords: Record<DemoAccountKey, string>,
  orgs: { hospital?: string; insurer?: string } = {},
): Promise<DemoAccountResult[]> {
  for (const a of DEMO_ACCOUNTS) {
    if (!passwords[a.key]) throw new ValidationError(`${a.passwordEnv} is not set.`);
  }
  const roleIds = await setupSystem(db);
  const out: DemoAccountResult[] = [];
  for (const a of DEMO_ACCOUNTS) {
    const email = emailSchema.parse(a.email);
    const org = await orgFor(db, a.orgType, a.key === "hospital" ? orgs.hospital : a.key === "insurer" ? orgs.insurer : undefined);
    const values = {
      fullName: a.name,
      organizationId: org.id,
      roleId: roleIds.get(a.role)!,
      passwordHash: await hashPassword(passwords[a.key]),
      isActive: true,
      insuranceContext: a.key === "insurer",
    };
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    let id: string;
    if (existing) {
      await db.update(users).set({ ...values, deletedAt: null }).where(eq(users.id, existing.id));
      await AuthRepository.revokeAllForUser(db, existing.id);
      id = existing.id;
    } else {
      id = (await db.insert(users).values({ email, ...values }).returning({ id: users.id }))[0]!.id;
    }
    await AuditService.record(db, {
      action: existing ? "user.demo_account_updated" : "user.demo_account_created",
      organizationId: org.id,
      resourceType: "user",
      resourceId: id,
      newState: { email, role: a.role, organizationId: org.id, insuranceContext: values.insuranceContext },
    });
    out.push({ email, status: existing ? "updated" : "created", organization: org.name });
  }
  return out;
}
