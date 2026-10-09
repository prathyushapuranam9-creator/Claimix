import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { claims } from "@/db/schema";
import { ConflictError } from "@/lib/errors";
import { parseListQuery } from "@/lib/pagination";
import { ClaimService } from "@/modules/claims/claims.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { PatientService } from "@/modules/patients/patients.service";
import { PolicyCheckService } from "@/modules/patients/policy-check.service";
import { approvedPreauth, codes, useTempStorage } from "./fixtures";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(async () => {
  setStorageForTests(undefined);
  await ctx.close();
});

/** The patient's row in one Patients view (searched by patient number, so other patients don't interfere). */
async function inView(k: keyof typeof who, patientNo: string, view: "patients" | "preauth" | "claims") {
  const page = await PatientService.list(as(k), parseListQuery({ q: patientNo }), view);
  return page.rows.find((r) => r.patientNo === patientNo) ?? null;
}

describe("Patients | Pre-Auth | Claims and Submit", () => {
  it("an approved pre-auth is in Pre-Auth until Submit; Submit moves the patient to Claims without duplicates", async () => {
    const { preauth, patient } = await approvedPreauth(ctx.db, who, c);

    // Before Submit: Pre-Auth (approved, no claim yet), not Claims; the Patients view is unchanged.
    expect(await inView("deskA", patient.patientNo, "patients")).not.toBeNull();
    const pre = await inView("deskA", patient.patientNo, "preauth");
    expect(pre).toMatchObject({ caseId: preauth.id, caseRef: preauth.reference, caseStatus: "approved" });
    expect(await inView("deskA", patient.patientNo, "claims")).toBeNull();

    // Policy Check data: the pre-auth with its saved form and no live claim (so Submit is offered).
    const before = await PolicyCheckService.forPatient(as("deskA"), patient.id);
    const row = before.preauths?.find((r) => r.id === preauth.id);
    expect(row).toBeDefined();
    expect(row!.liveClaimId).toBeNull();
    expect(row!.form.map((s) => s.title)).toEqual(["Patient and policy", "Clinical details", "The stay"]);
    expect(row).not.toHaveProperty("clinical"); // the raw JSON is not passed to the page

    // Submit = a claim started from the approved pre-auth (the existing rule).
    const claim = await ClaimService.createCashless(as("deskA"), { preAuthId: preauth.id });
    expect(claim).toMatchObject({ status: "draft", preAuthId: preauth.id, patientId: patient.id });

    // After Submit: Claims, no longer Pre-Auth.
    expect(await inView("deskA", patient.patientNo, "preauth")).toBeNull();
    expect(await inView("deskA", patient.patientNo, "claims")).toMatchObject({ caseId: claim.id, caseRef: claim.reference, caseStatus: "draft" });
    const after = await PolicyCheckService.forPatient(as("deskA"), patient.id);
    expect(after.preauths?.find((r) => r.id === preauth.id)?.liveClaimId).toBe(claim.id);
    expect(after.claims?.find((r) => r.id === claim.id)?.preauthReference).toBe(preauth.reference);

    // Submitting again creates nothing.
    await expect(ClaimService.createCashless(as("deskA"), { preAuthId: preauth.id })).rejects.toBeInstanceOf(ConflictError);
    const live = await ctx.db.select({ id: claims.id }).from(claims).where(and(eq(claims.preAuthId, preauth.id), ne(claims.status, "cancelled")));
    expect(live).toHaveLength(1);
  });

  it("views are limited to what the viewer may open: another hospital sees neither the patient nor the case", async () => {
    const { patient } = await approvedPreauth(ctx.db, who, c);
    for (const view of ["patients", "preauth", "claims"] as const) expect(await inView("deskB", patient.patientNo, view)).toBeNull();
  });
});
