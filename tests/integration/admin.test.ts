import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { hospitalNetworks, jobs, roles } from "@/db/schema";
import { DEMO } from "@/db/seed/ids";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { randomToken } from "@/lib/security/crypto";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { OrganizationService } from "@/modules/organizations/organizations.service";
import { UserService } from "@/modules/users/users.service";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const APP = "http://localhost:3000";
const uniq = () => randomToken(5).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

let roleId: Record<string, string>;
beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  roleId = Object.fromEntries((await ctx.db.select().from(roles)).map((r) => [r.key, r.id]));
});
afterAll(() => ctx.close());

const hospitalInput = (over: Record<string, unknown> = {}) => ({ name: "Test Hospital", city: "Mysuru", state: "Karnataka", departments: "Cardiology, , Cardiology, Oncology", ...over });

describe("HospitalService", () => {
  it("only admins can create hospitals", async () => {
    await expect(HospitalService.create(as("staffA"), hospitalInput())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(HospitalService.create(as("insurerA"), hospitalInput())).rejects.toBeInstanceOf(ForbiddenError);
    const h = await HospitalService.create(as("admin"), hospitalInput());
    expect(h.departments).toEqual(["Cardiology", "Oncology"]);
  });

  it("rejects unknown states", async () => {
    await expect(HospitalService.create(as("admin"), hospitalInput({ state: "Atlantis" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("everyone with hospital:read can search; read-only included; patients cannot", async () => {
    const r = await HospitalService.list(as("readOnly"), { page: 1, pageSize: 50 }, { insurerId: DEMO.org.insurerA });
    expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining([DEMO.org.hospitalA, DEMO.org.hospitalC]));
    expect(r.rows.map((x) => x.id)).not.toContain(DEMO.org.hospitalB); // only "unverified" there
    await expect(HospitalService.list(as("patientA1"), { page: 1, pageSize: 10 }, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("search input with LIKE wildcards is matched literally", async () => {
    const r = await HospitalService.list(as("readOnly"), { q: "%", page: 1, pageSize: 50 }, {});
    expect(r.total).toBe(0);
  });

  it("network status: upserts per payer, stamps verification, and enforces scheme vs private wording", async () => {
    const h = await HospitalService.create(as("admin"), hospitalInput({ name: "Network Test Hospital" }));
    await HospitalService.setNetwork(as("admin"), h.id, { payerType: "insurer", payerId: DEMO.org.insurerA, status: "unverified", cashlessAvailable: true });
    await HospitalService.setNetwork(as("admin"), h.id, { payerType: "insurer", payerId: DEMO.org.insurerA, status: "network", cashlessAvailable: true });
    const rows = await ctx.db.select().from(hospitalNetworks).where(eq(hospitalNetworks.hospitalId, h.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("network");
    expect(rows[0]!.lastVerifiedAt).toBeInstanceOf(Date);

    await expect(HospitalService.setNetwork(as("admin"), h.id, { payerType: "scheme", payerId: DEMO.scheme.pmjay, status: "network", cashlessAvailable: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(HospitalService.setNetwork(as("admin"), h.id, { payerType: "insurer", payerId: DEMO.org.insurerA, status: "empanelled", cashlessAvailable: true })).rejects.toBeInstanceOf(ValidationError);
    // An insurer id passed as a TPA is rejected (payer must exist with that type).
    await expect(HospitalService.setNetwork(as("admin"), h.id, { payerType: "tpa", payerId: DEMO.org.insurerA, status: "network", cashlessAvailable: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(HospitalService.setNetwork(as("staffA"), h.id, { payerType: "insurer", payerId: DEMO.org.insurerA, status: "network", cashlessAvailable: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("non-network statuses never claim cashless", async () => {
    const h = await HospitalService.create(as("admin"), hospitalInput({ name: "Cashless Guard Hospital" }));
    const row = await HospitalService.setNetwork(as("admin"), h.id, { payerType: "insurer", payerId: DEMO.org.insurerB, status: "suspended", cashlessAvailable: true });
    expect(row.cashlessAvailable).toBe(false);
  });
});

describe("InsurerService", () => {
  it("enforces unique codes and admin-only writes", async () => {
    const code = `T-${uniq()}`.toUpperCase();
    await InsurerService.create(as("admin"), { name: "Code Test Insurer", code });
    await expect(InsurerService.create(as("admin"), { name: "Another Insurer", code })).rejects.toBeInstanceOf(ConflictError);
    await expect(InsurerService.create(as("insurerA"), { name: "Self Made Insurer", code: `X-${uniq()}` })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("UserService (privilege management)", () => {
  it("is admin-only", async () => {
    await expect(UserService.list(as("staffA"), { page: 1, pageSize: 10 }, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      UserService.create(as("staffA"), { email: `x-${uniq()}@test.claimix.invalid`, fullName: "Escalation Attempt", roleId: roleId.admin!, organizationId: DEMO.org.platform }, APP),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses role/organization type mismatches (e.g. admin role in a hospital)", async () => {
    await expect(
      UserService.create(as("admin"), { email: `m-${uniq()}@test.claimix.invalid`, fullName: "Mismatch User", roleId: roleId.admin!, organizationId: DEMO.org.hospitalA }, APP),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      UserService.create(as("admin"), { email: `m-${uniq()}@test.claimix.invalid`, fullName: "Mismatch User", roleId: roleId.insurer_reviewer!, organizationId: DEMO.org.tpaA }, APP),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("never assigns the patient role from user admin", async () => {
    await expect(
      UserService.create(as("admin"), { email: `p-${uniq()}@test.claimix.invalid`, fullName: "Portal User", roleId: roleId.patient!, organizationId: DEMO.org.hospitalA }, APP),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("invites by one-time link, rejects duplicate emails", async () => {
    const email = `inv-${uniq()}@test.claimix.invalid`;
    const { id } = await UserService.create(as("admin"), { email, fullName: "Invited Staff", roleId: roleId.hospital_staff!, organizationId: DEMO.org.hospitalB }, APP);
    const [job] = await ctx.db.select().from(jobs).where(and(eq(jobs.type, "email.send"), sql`${jobs.payload}->>'userId' = ${id}`)).orderBy(desc(jobs.createdAt)).limit(1);
    expect(job?.payload.template).toBe("invite");
    await expect(UserService.create(as("admin"), { email: email.toUpperCase(), fullName: "Dup User", roleId: roleId.hospital_staff!, organizationId: DEMO.org.hospitalB }, APP)).rejects.toBeInstanceOf(ConflictError);
  });

  it("role change or deactivation signs the user out everywhere", async () => {
    const email = `rc-${uniq()}@test.claimix.invalid`;
    const { id } = await UserService.create(as("admin"), { email, fullName: "Role Change User", roleId: roleId.admin!, organizationId: DEMO.org.platform }, APP);
    // Give the account a known password via the reset flow, then sign in.
    const [job] = await ctx.db.select().from(jobs).where(sql`${jobs.payload}->>'userId' = ${id}`).orderBy(desc(jobs.createdAt)).limit(1);
    const token = new URL(String(job!.payload.link)).searchParams.get("token")!;
    await ctx.auth.resetPassword({ token, password: "Role-change-pass-1", confirmPassword: "Role-change-pass-1" }, { ipAddress: "203.0.113.1" });
    const session = await ctx.auth.login({ email, password: "Role-change-pass-1" }, { ipAddress: "203.0.113.1" });
    expect(await ctx.auth.resolve(session.token)).not.toBeNull();

    await UserService.update(as("admin"), id, { fullName: "Role Change User", roleId: roleId.read_only!, isActive: true });
    expect(await ctx.auth.resolve(session.token)).toBeNull();
  });

  it("admins cannot demote or deactivate themselves", async () => {
    const self = who.admin.userId;
    await expect(UserService.update(as("admin"), self, { fullName: "Asha Admin", roleId: roleId.read_only!, isActive: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(UserService.update(as("admin"), self, { fullName: "Asha Admin", roleId: roleId.admin!, isActive: false })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("OrganizationService", () => {
  it("deactivating an organization ends its users' sessions; admins can't deactivate their own org", async () => {
    const h = await HospitalService.create(as("admin"), hospitalInput({ name: "Deactivation Test Hospital" }));
    const email = `org-${uniq()}@test.claimix.invalid`;
    const { id } = await UserService.create(as("admin"), { email, fullName: "Org Staff", roleId: roleId.hospital_staff!, organizationId: h.id }, APP);
    const [job] = await ctx.db.select().from(jobs).where(sql`${jobs.payload}->>'userId' = ${id}`).orderBy(desc(jobs.createdAt)).limit(1);
    const token = new URL(String(job!.payload.link)).searchParams.get("token")!;
    await ctx.auth.resetPassword({ token, password: "Org-staff-pass-1", confirmPassword: "Org-staff-pass-1" }, { ipAddress: "203.0.113.2" });
    const s = await ctx.auth.login({ email, password: "Org-staff-pass-1" }, { ipAddress: "203.0.113.2" });

    await OrganizationService.setActive(as("admin"), h.id, false);
    expect(await ctx.auth.resolve(s.token)).toBeNull();
    await expect(OrganizationService.setActive(as("admin"), DEMO.org.platform, false)).rejects.toBeInstanceOf(ValidationError);
    await expect(OrganizationService.setActive(as("staffA"), h.id, true)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
