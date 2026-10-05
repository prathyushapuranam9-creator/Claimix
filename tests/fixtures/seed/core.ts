import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { hospitals, insurers, organizations, patients, tpas, users } from "@/db/schema";
import { hashPassword } from "@/lib/security/crypto";
import { DEMO } from "./ids";

const DEMO_TAG = " (DEMO DATA)";

/** Fictional organizations, users per role and patients. Upserts only. */
export async function seedCore(
  db: DbOrTx,
  roleIds: Map<string, string>,
  demoPassword: string,
  opts: { resetDemoPasswords?: boolean } = {},
) {
  const orgs = [
    { id: DEMO.org.platform, type: "platform" as const, name: "Claimix Platform" + DEMO_TAG },
    { id: DEMO.org.hospitalA, type: "hospital" as const, name: "Sunrise Multispeciality Hospital" + DEMO_TAG },
    { id: DEMO.org.hospitalB, type: "hospital" as const, name: "Lakeview Care Hospital" + DEMO_TAG },
    { id: DEMO.org.insurerA, type: "insurer" as const, name: "Aarogya Shield General Insurance" + DEMO_TAG },
    { id: DEMO.org.insurerB, type: "insurer" as const, name: "Suraksha Health Insurance" + DEMO_TAG },
    { id: DEMO.org.tpaA, type: "tpa" as const, name: "MediAssist Claims Services" + DEMO_TAG },
    { id: DEMO.org.tpaB, type: "tpa" as const, name: "CareLink TPA" + DEMO_TAG },
  ];
  await db
    .insert(organizations)
    .values(orgs.map((o) => ({ ...o, isDemo: true })))
    .onConflictDoUpdate({ target: organizations.id, set: { name: sql`excluded.name` } });

  await db.insert(hospitals).values([
    { id: DEMO.org.hospitalA, city: "Hyderabad", state: "Telangana", registrationNo: "DEMO-HOSP-001", departments: ["Cardiology", "Orthopaedics", "General Surgery", "Nephrology"], phone: "+91-40-0000-0001" },
    { id: DEMO.org.hospitalB, city: "Bengaluru", state: "Karnataka", registrationNo: "DEMO-HOSP-002", departments: ["Ophthalmology", "Obstetrics", "General Medicine"], phone: "+91-80-0000-0002" },
  ]).onConflictDoNothing();

  await db.insert(insurers).values([
    { id: DEMO.org.insurerA, code: "DEMO-ASGI", claimsPhone: "1800-000-0001", claimsEmail: "claims@aarogya-demo.invalid" },
    { id: DEMO.org.insurerB, code: "DEMO-SHI", claimsPhone: "1800-000-0002", claimsEmail: "claims@suraksha-demo.invalid" },
  ]).onConflictDoNothing();

  await db.insert(tpas).values([
    { id: DEMO.org.tpaA, code: "DEMO-MACS", phone: "1800-000-0101" },
    { id: DEMO.org.tpaB, code: "DEMO-CLT", phone: "1800-000-0102" },
  ]).onConflictDoNothing();

  const passwordHash = await hashPassword(demoPassword);
  const demoUsers = [
    { email: "admin@demo.claimix.invalid", fullName: "Asha Admin", role: "admin", org: DEMO.org.platform },
    { email: "readonly@demo.claimix.invalid", fullName: "Ravi Viewer", role: "read_only", org: DEMO.org.platform },
    { email: "staff.a@demo.claimix.invalid", fullName: "Kiran Desk (Sunrise)", role: "hospital_staff", org: DEMO.org.hospitalA },
    { email: "staff.b@demo.claimix.invalid", fullName: "Meera Desk (Lakeview)", role: "hospital_staff", org: DEMO.org.hospitalB },
    { email: "insurer.a@demo.claimix.invalid", fullName: "Vikram Reviewer (Aarogya)", role: "payer_reviewer", org: DEMO.org.insurerA },
    { email: "insurer.b@demo.claimix.invalid", fullName: "Nisha Reviewer (Suraksha)", role: "payer_reviewer", org: DEMO.org.insurerB },
    { email: "tpa.a@demo.claimix.invalid", fullName: "Farhan Analyst (MediAssist)", role: "payer_reviewer", org: DEMO.org.tpaA },
    // The designated testing / demo Insurance Portal login: an Aarogya payer reviewer an administrator has flagged to switch insurer and role.
    { email: "insurer.portal@demo.claimix.invalid", fullName: "Portal Reviewer (Aarogya)", role: "payer_reviewer", org: DEMO.org.insurerA, insuranceContext: true },
    { email: "patient.a1@demo.claimix.invalid", fullName: "Demo Patient Anil", role: "patient", org: DEMO.org.hospitalA },
    { email: "patient.a2@demo.claimix.invalid", fullName: "Demo Patient Bhavna", role: "patient", org: DEMO.org.hospitalA },
    { email: "patient.b1@demo.claimix.invalid", fullName: "Demo Patient Chetan", role: "patient", org: DEMO.org.hospitalB },
  ];
  const userIds = new Map<string, string>();
  for (const u of demoUsers) {
    const [row] = await db
      .insert(users)
      .values({ email: u.email, fullName: u.fullName, organizationId: u.org, roleId: roleIds.get(u.role)!, passwordHash, isDemo: true, insuranceContext: u.insuranceContext ?? false })
      .onConflictDoUpdate({ target: users.email, set: { fullName: u.fullName, insuranceContext: u.insuranceContext ?? false, ...(opts.resetDemoPasswords ? { passwordHash } : {}) } })
      .returning({ id: users.id });
    userIds.set(u.email, row!.id);
  }

  await db.insert(patients).values([
    { id: DEMO.patient.a1, hospitalId: DEMO.org.hospitalA, userId: userIds.get("patient.a1@demo.claimix.invalid"), patientNo: "SUN-0001", fullName: "Demo Patient Anil", dob: "1978-04-12", gender: "male", phone: "+91-90000-00001", isDemo: true },
    { id: DEMO.patient.a2, hospitalId: DEMO.org.hospitalA, userId: userIds.get("patient.a2@demo.claimix.invalid"), patientNo: "SUN-0002", fullName: "Demo Patient Bhavna", dob: "1990-09-30", gender: "female", phone: "+91-90000-00002", isDemo: true },
    { id: DEMO.patient.b1, hospitalId: DEMO.org.hospitalB, userId: userIds.get("patient.b1@demo.claimix.invalid"), patientNo: "LAK-0001", fullName: "Demo Patient Chetan", dob: "1956-01-20", gender: "male", phone: "+91-90000-00003", isDemo: true },
  ]).onConflictDoNothing();

  return userIds;
}
