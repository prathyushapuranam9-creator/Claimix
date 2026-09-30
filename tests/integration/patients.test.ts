import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, beneficiaries, policies, preAuthorizations, users } from "@/db/schema";
import { DEMO } from "@/db/seed/ids";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { PatientService } from "@/modules/patients/patients.service";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const Q = { page: 1, pageSize: 100 };

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

const valid = (over: Record<string, unknown> = {}) => ({ fullName: "Test Patient", dob: "1985-06-15", gender: "female", ...over });

describe("PatientService scoping", () => {
  it("hospital staff always register into their own hospital, ignoring a client-sent hospitalId", async () => {
    const p = await PatientService.create(as("staffA"), valid({ hospitalId: DEMO.org.hospitalB }));
    expect(p.hospitalId).toBe(DEMO.org.hospitalA);
  });

  it("Hospital B cannot read or edit Hospital A's patient (404, not 403, so existence isn't leaked)", async () => {
    await expect(PatientService.get(as("staffB"), DEMO.patient.a1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PatientService.update(as("staffB"), DEMO.patient.a1, valid())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists only the caller's hospital patients", async () => {
    const a = await PatientService.list(as("staffA"), Q);
    expect(a.rows.every((r) => r.hospitalId === DEMO.org.hospitalA)).toBe(true);
    expect(a.rows.map((r) => r.id)).not.toContain(DEMO.patient.b1);
  });

  it("a patient can read only their own record", async () => {
    await expect(PatientService.get(as("patientA1"), DEMO.patient.a1)).resolves.toBeTruthy();
    await expect(PatientService.get(as("patientA1"), DEMO.patient.a2)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PatientService.get(as("patientA1"), DEMO.patient.b1)).rejects.toBeInstanceOf(NotFoundError);
    const list = await PatientService.list(as("patientA1"), Q);
    expect(list.rows.map((r) => r.id)).toEqual([DEMO.patient.a1]);
  });

  it("patients and payers cannot register or edit patients", async () => {
    await expect(PatientService.create(as("patientA1"), valid())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PatientService.create(as("insurerA"), valid())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PatientService.update(as("patientA1"), DEMO.patient.a1, valid())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("read-only users cannot see patients at all", async () => {
    await expect(PatientService.list(as("readOnly"), Q)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an insurer sees a patient only once a request is assigned to it", async () => {
    const p = await PatientService.create(as("staffA"), valid({ fullName: "Payer Visibility Patient" }));
    await expect(PatientService.get(as("insurerB"), p.id)).rejects.toBeInstanceOf(NotFoundError);

    const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, "admin@demo.claimix.invalid"));
    const [policy] = await ctx.db.insert(policies).values({ category: "private", insurerId: DEMO.org.insurerB, name: "Visibility fixture", productType: "individual", isDemo: true }).returning();
    const [ben] = await ctx.db.insert(beneficiaries).values({ patientId: p.id, category: "private", policyId: policy!.id, memberId: `VIS-${p.id.slice(0, 8)}`, coverStart: "2026-01-01", coverEnd: "2026-12-31", isDemo: true }).returning();
    await ctx.db.insert(preAuthorizations).values({ reference: `VIS-${p.id.slice(0, 8)}`, hospitalId: DEMO.org.hospitalA, patientId: p.id, beneficiaryId: ben!.id, policyId: policy!.id, insurerId: DEMO.org.insurerB, status: "submitted", submittedAt: new Date(), createdBy: admin!.id, isDemo: true });

    await expect(PatientService.get(as("insurerB"), p.id)).resolves.toBeTruthy();
    await expect(PatientService.get(as("insurerA"), p.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("malformed ids are treated as not found", async () => {
    await expect(PatientService.get(as("admin"), "../../etc/passwd")).rejects.toBeInstanceOf(NotFoundError);
    await expect(PatientService.get(as("admin"), "1 or 1=1")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("PatientService validation & audit", () => {
  it("rejects future dates of birth and bad phone numbers with field errors", async () => {
    const err = await PatientService.create(as("staffA"), valid({ dob: "2999-01-01", phone: "abc" })).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys((err as ValidationError).fieldErrors)).toEqual(expect.arrayContaining(["dob", "phone"]));
  });

  it("admins must choose a real hospital", async () => {
    await expect(PatientService.create(as("admin"), valid())).rejects.toBeInstanceOf(ValidationError);
    await expect(PatientService.create(as("admin"), valid({ hospitalId: DEMO.org.insurerA }))).rejects.toBeInstanceOf(ValidationError);
    await expect(PatientService.create(as("admin"), valid({ hospitalId: DEMO.org.hospitalB }))).resolves.toHaveProperty("hospitalId", DEMO.org.hospitalB);
  });

  it("records creation, views and edits without contact details in the audit trail", async () => {
    const p = await PatientService.create(as("staffA"), valid({ fullName: "Audit Trail Patient", phone: "+91 98765 43210" }));
    await PatientService.get(as("staffA"), p.id);
    await PatientService.update(as("staffA"), p.id, valid({ fullName: "Audit Trail Patient Renamed" }));
    const rows = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceType, "patient"), eq(auditLogs.resourceId, p.id)));
    expect(rows.map((r) => r.action).sort()).toEqual(["patient.created", "patient.updated", "patient.viewed"]);
    const updated = rows.find((r) => r.action === "patient.updated")!;
    expect(updated.previousState).toMatchObject({ fullName: "Audit Trail Patient" });
    expect(updated.newState).toMatchObject({ fullName: "Audit Trail Patient Renamed" });
    expect(JSON.stringify(rows)).not.toContain("98765");
  });
});
