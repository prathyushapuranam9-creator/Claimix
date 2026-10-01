import { inject } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { roles, users } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { hashPassword, randomToken } from "@/lib/security/crypto";
import { createAuthService, type AuthService } from "@/modules/auth/auth.service";
import type { Principal } from "@/lib/permissions/principal";

export const META = { ipAddress: "203.0.113.10", userAgent: "vitest", requestId: "test" };

export function testContext() {
  const { db, close } = createDb(inject("testDbUrl"), { max: 4 });
  const auth = createAuthService(db, { secret: "test-secret-".padEnd(40, "x"), appUrl: "http://localhost:3000" });
  return { db, close, auth, demoPassword: inject("demoPassword") };
}

/** Logs in as a seeded demo user through the real AuthService and returns the resolved principal. */
export async function principalFor(auth: AuthService, email: string, password: string): Promise<Principal> {
  const { token } = await auth.login({ email, password }, { ...META, ipAddress: uniqueIp() });
  const user = await auth.resolve(token);
  if (!user) throw new Error(`Could not resolve session for ${email}`);
  return user.principal;
}

/** Throwaway user with a unique email so lockout tests never affect other tests or reruns. */
export async function createThrowawayUser(db: Db, password: string, roleKey = "hospital_staff") {
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey));
  const email = `tmp-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "")}@test.claimix.invalid`;
  const [u] = await db
    .insert(users)
    .values({ email, fullName: "Throwaway Test User", organizationId: DEMO.org.hospitalA, roleId: role!.id, passwordHash: await hashPassword(password), isDemo: true })
    .returning({ id: users.id });
  return { id: u!.id, email };
}

let ipCounter = Math.floor(Math.random() * 200);
/** Distinct documentation-range IPs per login so the per-IP limiter never trips across tests. */
export function uniqueIp() {
  ipCounter = (ipCounter + 1) % 250;
  return `198.51.100.${ipCounter + 1}`;
}

/** Builds a service context for a principal, as server actions do. */
export function svc(db: Db, principal: Principal) {
  return { db, principal, meta: META };
}

/** Signs in all seeded demo users once and returns their principals by key. */
export async function demoPrincipals(auth: AuthService, password: string) {
  const emails = {
    admin: "admin@demo.claimix.invalid",
    readOnly: "readonly@demo.claimix.invalid",
    staffA: "staff.a@demo.claimix.invalid",
    staffB: "staff.b@demo.claimix.invalid",
    insurerA: "insurer.a@demo.claimix.invalid",
    insurerB: "insurer.b@demo.claimix.invalid",
    tpaA: "tpa.a@demo.claimix.invalid",
    patientA1: "patient.a1@demo.claimix.invalid",
    patientA2: "patient.a2@demo.claimix.invalid",
    patientB1: "patient.b1@demo.claimix.invalid",
  } as const;
  const out = {} as Record<keyof typeof emails, Principal>;
  for (const [k, email] of Object.entries(emails) as [keyof typeof emails, string][]) {
    out[k] = await principalFor(auth, email, password);
  }
  return out;
}
