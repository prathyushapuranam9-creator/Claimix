import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { ForbiddenError } from "@/lib/errors";
import { ROLES, WITHDRAWN_HOSPITAL_STAFF_PERMISSIONS } from "@/lib/permissions/catalog";
import { can } from "@/lib/permissions/principal";
import { todayIso } from "@/lib/validation";
import { ClaimService } from "@/modules/claims/claims.service";
import { DocumentListService, DocumentService } from "@/modules/documents/documents.service";
import { EligibilityService } from "@/modules/eligibility/eligibility.service";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { ReportService } from "@/modules/reports/reports.service";
import { RegistrationService } from "@/modules/scheduling/scheduling.service";
import { demoPrincipals, svc, testContext } from "./helpers";

/**
 * Hospital Staff is front-desk registration only: the insurance side of Claimix was deliberately
 * withdrawn from the role. This pins both halves of that — what the role can still do, and that every
 * withdrawn capability is refused by the service layer and absent from the database's grants.
 */
const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const Q = { page: 1, pageSize: 20 };

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

describe("what the front desk can still do", () => {
  it("registers patients and reads its own hospital's records", async () => {
    const p = await PatientService.create(as("staffA"), { fullName: "Front Desk Scope", dob: "1988-08-08", gender: "female", confirmDuplicate: true });
    expect(p.hospitalId).toBe(DEMO.org.hospitalA);
    expect((await PatientService.list(as("staffA"), Q)).rows.length).toBeGreaterThan(0);
    await expect(PatientService.get(as("staffA"), p.id)).resolves.toBeTruthy();
  });

  it("books doctors and slots, and sees its own day sheet", async () => {
    expect(await RegistrationService.departments(as("staffA"))).toContain("general_medicine");
    const overview = await RegistrationService.dayOverview(as("staffA"), todayIso());
    expect(overview).not.toBeNull();
    await expect(RegistrationService.list(as("staffA"), Q, {})).resolves.toBeTruthy();
  });
});

describe("the insurance side is refused", () => {
  it("cannot record coverage or run an eligibility check", async () => {
    await expect(CoverageService.forPatient(as("staffA"), DEMO.patient.a1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(CoverageService.add(as("staffA"), DEMO.patient.a1, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(EligibilityService.check(as("staffA"), { beneficiaryId: DEMO.beneficiary.a1Floater, claimType: "cashless" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot read or raise pre-authorizations and claims", async () => {
    await expect(PreauthService.list(as("staffA"), Q, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PreauthService.create(as("staffA"), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ClaimService.list(as("staffA"), Q, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot browse policies, upload documents or open the case reports", async () => {
    await expect(PolicyService.list(as("staffA"), Q, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(DocumentListService.list(as("staffA"), Q, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      DocumentService.uploadInsuranceDocument(as("staffA"), DEMO.patient.a1, { docType: "insurance_card", file: { name: "c.pdf", size: 4, bytes: new Uint8Array([1, 2, 3, 4]) } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ReportService.overview(as("staffA"), {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("holds none of the withdrawn permissions, in the matrix or in the database", async () => {
    const staff = ROLES.find((r) => r.key === "hospital_staff")!;
    for (const key of WITHDRAWN_HOSPITAL_STAFF_PERMISSIONS) {
      expect(staff.grants[key], `${key} is still in the role matrix`).toBeUndefined();
      expect(can(who.staffA, key), `${key} is still granted at runtime`).toBe(false);
    }

    // db:setup revokes them, so a database seeded under the old matrix no longer grants them either.
    const [role] = await ctx.db.select({ id: roles.id }).from(roles).where(eq(roles.key, "hospital_staff"));
    const granted = await ctx.db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, role!.id));
    const keys = granted.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(["dashboard:view", "patient:read", "patient:write", "notification:read"]));
    for (const key of WITHDRAWN_HOSPITAL_STAFF_PERMISSIONS) expect(keys, `${key} is still granted in the database`).not.toContain(key);
  });

  it("leaves no hospital-side role able to raise a pre-authorization or claim", async () => {
    // A known consequence of withdrawing the insurance side: creation requires a hospital organization,
    // and no hospital role now holds the permission, so the payer workflow has no inbound requests.
    const hospitalRoles = ROLES.filter((r) => r.orgType === "hospital");
    expect(hospitalRoles.map((r) => r.key)).toEqual(["hospital_staff", "patient"]);
    for (const r of hospitalRoles) {
      expect(r.grants["preauth:create"]).toBeUndefined();
      expect(r.grants["claim:create"]).toBeUndefined();
    }
    const withPermission = await ctx.db
      .select({ key: roles.key })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(permissions.key, ["preauth:create", "claim:create"]));
    // Only the platform administrator keeps it, and creation is restricted to hospital organizations.
    expect([...new Set(withPermission.map((r) => r.key))]).toEqual(["admin"]);
    await expect(PreauthService.create(as("admin"), {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
