import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { beneficiaries, claims, patients, policies, users } from "@/db/schema";
import { DEMO } from "@/db/seed/ids";
import { ForbiddenError } from "@/lib/errors";
import type { Principal } from "@/lib/permissions/principal";
import { requirePermission } from "@/lib/permissions/principal";
import { scopePredicate } from "@/lib/permissions/scope";
import { principalFor, testContext } from "./helpers";

/**
 * Proves tenant isolation against real PostgreSQL through the same scope
 * predicate every repository uses.
 */
const ctx = testContext();
const F = {
  policyA: "00000000-0000-4000-8000-00000000f0a1",
  policyB: "00000000-0000-4000-8000-00000000f0b1",
  benA1: "00000000-0000-4000-8000-00000000f1a1",
  benB1: "00000000-0000-4000-8000-00000000f1b1",
  claimA1: "00000000-0000-4000-8000-00000000f2a1",
  claimB1: "00000000-0000-4000-8000-00000000f2b1",
};

const who: Record<string, Principal> = {};

beforeAll(async () => {
  const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, "admin@demo.claimix.invalid"));
  // Fixture: patient A1 (hospital A) insured by insurer A via TPA A; patient B1 (hospital B) insured by insurer B.
  await ctx.db.insert(policies).values([
    { id: F.policyA, category: "private", insurerId: DEMO.org.insurerA, tpaId: DEMO.org.tpaA, name: "Isolation Fixture A", productType: "individual", isDemo: true },
    { id: F.policyB, category: "private", insurerId: DEMO.org.insurerB, name: "Isolation Fixture B", productType: "individual", isDemo: true },
  ]).onConflictDoNothing();
  await ctx.db.insert(beneficiaries).values([
    { id: F.benA1, patientId: DEMO.patient.a1, category: "private", policyId: F.policyA, memberId: "ISO-A1", coverStart: "2026-01-01", coverEnd: "2026-12-31", isDemo: true },
    { id: F.benB1, patientId: DEMO.patient.b1, category: "private", policyId: F.policyB, memberId: "ISO-B1", coverStart: "2026-01-01", coverEnd: "2026-12-31", isDemo: true },
  ]).onConflictDoNothing();
  await ctx.db.insert(claims).values([
    { id: F.claimA1, reference: "ISO-CLM-A1", claimType: "cashless", hospitalId: DEMO.org.hospitalA, patientId: DEMO.patient.a1, beneficiaryId: F.benA1, policyId: F.policyA, insurerId: DEMO.org.insurerA, tpaId: DEMO.org.tpaA, status: "submitted", submittedAt: new Date(), createdBy: admin!.id, isDemo: true },
    { id: F.claimB1, reference: "ISO-CLM-B1", claimType: "cashless", hospitalId: DEMO.org.hospitalB, patientId: DEMO.patient.b1, beneficiaryId: F.benB1, policyId: F.policyB, insurerId: DEMO.org.insurerB, status: "submitted", submittedAt: new Date(), createdBy: admin!.id, isDemo: true },
  ]).onConflictDoNothing();

  for (const [k, email] of Object.entries({
    staffA: "staff.a@demo.claimix.invalid",
    staffB: "staff.b@demo.claimix.invalid",
    insurerA: "insurer.a@demo.claimix.invalid",
    insurerB: "insurer.b@demo.claimix.invalid",
    tpaA: "tpa.a@demo.claimix.invalid",
    patientA1: "patient.a1@demo.claimix.invalid",
    patientA2: "patient.a2@demo.claimix.invalid",
    readOnly: "readonly@demo.claimix.invalid",
    admin: "admin@demo.claimix.invalid",
  })) {
    who[k] = await principalFor(ctx.auth, email, ctx.demoPassword);
  }
});

afterAll(() => ctx.close());

async function visibleClaimIds(p: Principal) {
  const scope = requirePermission(p, "claim:read");
  const where = scopePredicate(p, scope, { hospitalId: claims.hospitalId, insurerId: claims.insurerId, tpaId: claims.tpaId, patientId: claims.patientId });
  const rows = await ctx.db.select({ id: claims.id }).from(claims).where(where);
  return rows.map((r) => r.id);
}

async function visiblePatientIds(p: Principal) {
  const scope = requirePermission(p, "patient:read");
  const where = scopePredicate(p, scope, { hospitalId: patients.hospitalId, patientId: patients.id });
  const rows = await ctx.db.select({ id: patients.id }).from(patients).where(where);
  return rows.map((r) => r.id);
}

describe("organization isolation", () => {
  it("Hospital A → Hospital B patients = DENIED", async () => {
    const ids = await visiblePatientIds(who.staffA!);
    expect(ids).toContain(DEMO.patient.a1);
    expect(ids).not.toContain(DEMO.patient.b1);
    expect(await visiblePatientIds(who.staffB!)).not.toContain(DEMO.patient.a1);
  });

  it("Hospital A → Hospital B claims = DENIED", async () => {
    const ids = await visibleClaimIds(who.staffA!);
    expect(ids).toContain(F.claimA1);
    expect(ids).not.toContain(F.claimB1);
  });

  it("Insurer A → Insurer B claims = DENIED", async () => {
    const a = await visibleClaimIds(who.insurerA!);
    expect(a).toContain(F.claimA1);
    expect(a).not.toContain(F.claimB1);
    const b = await visibleClaimIds(who.insurerB!);
    expect(b).toContain(F.claimB1);
    expect(b).not.toContain(F.claimA1);
  });

  it("TPA sees only claims assigned to it", async () => {
    const ids = await visibleClaimIds(who.tpaA!);
    expect(ids).toContain(F.claimA1);
    expect(ids).not.toContain(F.claimB1);
  });

  it("Patient A → Patient B records = DENIED (even at the same hospital)", async () => {
    expect(await visiblePatientIds(who.patientA1!)).toEqual([DEMO.patient.a1]);
    expect(await visiblePatientIds(who.patientA2!)).toEqual([DEMO.patient.a2]);
    expect(await visibleClaimIds(who.patientA1!)).toEqual([F.claimA1]);
    expect(await visibleClaimIds(who.patientA2!)).toEqual([]);
  });

  it("read-only users cannot read claims or patients at all", async () => {
    await expect(visibleClaimIds(who.readOnly!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(visiblePatientIds(who.readOnly!)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("platform admin sees across organizations", async () => {
    const ids = await visibleClaimIds(who.admin!);
    expect(ids).toEqual(expect.arrayContaining([F.claimA1, F.claimB1]));
  });

  it("the patient link is derived from the session, not client input", () => {
    expect(who.patientA1!.patientId).toBe(DEMO.patient.a1);
    expect(who.staffA!.patientId).toBeNull();
  });
});
