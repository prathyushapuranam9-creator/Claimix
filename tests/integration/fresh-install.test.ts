import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createDb, type Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { setupSystem } from "@/db/setup";
import { ConflictError } from "@/lib/errors";
import type { Principal } from "@/lib/permissions/principal";
import { createAuthService } from "@/modules/auth/auth.service";
import { ClaimService } from "@/modules/claims/claims.service";
import { ClinicalService } from "@/modules/clinical/clinical.service";
import { DashboardService } from "@/modules/dashboard/dashboard.service";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { InboxService } from "@/modules/notifications/inbox.service";
import { PatientService } from "@/modules/patients/patients.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { PublicNetworkService } from "@/modules/public/public-network.service";
import { ReportService } from "@/modules/reports/reports.service";
import { SchemeService } from "@/modules/schemes/schemes.service";
import { createAdministrator } from "@/modules/users/create-admin";
import { META } from "./helpers";

/**
 * A brand-new installation: its own throwaway database (created here, dropped afterwards;
 * never the dev, test or E2E database), migrated and set up exactly as in production.
 */
const NAME = `claimix_fresh_${process.pid}_${Date.now()}`;
const BUSINESS_TABLES = [
  "organizations", "users", "hospitals", "insurers", "tpas", "government_schemes", "patients", "hospital_networks",
  "policies", "beneficiaries", "rule_sets", "rule_versions", "rules", "rule_evaluations", "diagnoses", "procedures", "packages",
  "pre_authorizations", "claims", "status_history", "payer_responses", "queries", "settlements", "documents",
  "notifications", "assistant_interactions", "review_requests", "access_requests", "jobs", "sessions",
];
const DEMO_FLAGGED = ["organizations", "users", "patients", "government_schemes", "policies", "beneficiaries", "diagnoses", "procedures", "packages", "pre_authorizations", "claims", "documents"];

let admin: ReturnType<typeof postgres>;
let db: Db;
let close: () => Promise<void>;
let url: string;

async function counts(tables: string[], where = "true") {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [r] = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${t} where ${where}`));
    out[t] = Number(r!.n);
  }
  return out;
}

beforeAll(async () => {
  const base = new URL(inject("testDbUrl"));
  admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${NAME}`);
  base.pathname = `/${NAME}`;
  url = base.toString();
  await runMigrations(url);
  ({ db, close } = createDb(url, { max: 2 }));
}, 60_000);

afterAll(async () => {
  await close?.();
  if (/^claimix_fresh_\d+_\d+$/.test(NAME)) await admin.unsafe(`drop database if exists ${NAME}`); // only the throwaway DB created above
  await admin.end();
});

describe("fresh installation", () => {
  it("system setup installs configuration only: no organizations, users, records or demo rows", async () => {
    await db.transaction((tx) => setupSystem(tx));
    await db.transaction((tx) => setupSystem(tx)); // idempotent
    const [config] = await db.execute<{ roles: number; perms: number; reasons: number }>(
      sql`select (select count(*) from roles)::int as roles, (select count(*) from permissions)::int as perms, (select count(*) from rejection_reasons)::int as reasons`,
    );
    expect(Number(config!.roles)).toBeGreaterThan(0);
    expect(Number(config!.perms)).toBeGreaterThan(0);
    expect(Number(config!.reasons)).toBeGreaterThan(0);
    expect(Object.values(await counts(BUSINESS_TABLES)).every((n) => n === 0)).toBe(true);
  });

  describe("after the first administrator is created", () => {
    let principal: Principal;
    const ctx = () => ({ db, principal, meta: META });
    const q = { page: 1, pageSize: 20 };

    beforeAll(async () => {
      const auth = createAuthService(db, { secret: "fresh-install-secret".padEnd(40, "x"), appUrl: "http://localhost:3000" });
      const created = await createAdministrator(db, { email: "Owner@Example.org", name: "First Admin" }, "http://localhost:3000");
      const token = new URL(created.link).searchParams.get("token")!;
      await auth.resetPassword({ token, password: "Fresh-install-pass-1", confirmPassword: "Fresh-install-pass-1" }, META);
      const { token: session } = await auth.login({ email: "owner@example.org", password: "Fresh-install-pass-1" }, META);
      principal = (await auth.resolve(session))!.principal;
    });

    it("signs in as admin; a second admin with the same email is refused; nothing is flagged as demo", async () => {
      expect(principal.roleKey).toBe("admin");
      expect(principal.orgType).toBe("platform");
      await expect(createAdministrator(db, { email: "owner@example.org", name: "Again" }, "http://x")).rejects.toBeInstanceOf(ConflictError);
      expect(Object.values(await counts(DEMO_FLAGGED, "is_demo")).every((n) => n === 0)).toBe(true);
      const c = await counts(["organizations", "users"]);
      expect(c).toEqual({ organizations: 1, users: 1 });
    });

    it("every section starts empty and the dashboard and reports show zeros, not invented values", async () => {
      expect((await PatientService.list(ctx(), q)).total).toBe(0);
      expect((await HospitalService.list(ctx(), q, {})).total).toBe(0);
      expect((await InsurerService.list(ctx(), q)).total).toBe(0);
      expect((await PolicyService.list(ctx(), q, {})).total).toBe(0);
      expect((await PreauthService.list(ctx(), q, {})).total).toBe(0);
      expect((await ClaimService.list(ctx(), q, {})).total).toBe(0);
      expect((await InboxService.list(ctx(), q, false)).total).toBe(0);
      expect(await SchemeService.list(ctx())).toEqual([]);
      expect(await ClinicalService.lists(ctx())).toEqual({ diagnoses: [], procedures: [] });

      const dash = await DashboardService.forCaller(ctx());
      if (dash.variant !== "admin") throw new Error(`expected admin dashboard, got ${dash.variant}`);
      expect(dash.preauthStatus).toEqual({});
      expect(dash.claimStatus).toEqual({});
      expect(dash.financials).toEqual([]);
      expect(dash.actionPreauths).toEqual([]);
      expect(dash.actionClaims).toEqual([]);
      expect(dash.admin).toMatchObject({ activeUsers: 1, patients: 0, pendingAccessRequests: 0, failedJobs: 0 });

      const report = await ReportService.overview(ctx(), {});
      expect(report).toMatchObject({ preauthStatus: {}, claimStatus: {}, financials: [], monthly: [], reasons: [] });
      expect(report.preauthTat).toMatchObject({ decided: 0, awaiting: 0, medianHours: null });

      expect(await PublicNetworkService.payers(db)).toEqual({ insurers: [], schemes: [] });
    });

    it("real records can be created from the empty state", async () => {
      const h = await HospitalService.create(ctx(), { name: "First Real Hospital", city: "Hyderabad", state: "Telangana", departments: "General Medicine" });
      const s = await SchemeService.create(ctx(), { name: "State Health Scheme", code: "STATE-HS", authority: "State Health Department" });
      await ClinicalService.addDiagnosis(ctx(), { code: "k35", name: "Acute appendicitis" });
      await ClinicalService.addProcedure(ctx(), { code: "appendectomy", name: "Appendectomy" });
      await expect(ClinicalService.addDiagnosis(ctx(), { code: "K35", name: "Duplicate" })).rejects.toBeInstanceOf(ConflictError);

      expect((await HospitalService.list(ctx(), q, {})).rows.map((r) => r.id)).toEqual([h.id]);
      expect((await SchemeService.list(ctx())).map((r) => r.id)).toEqual([s.id]);
      const codes = await ClinicalService.lists(ctx());
      expect(codes.diagnoses.map((d) => d.code)).toEqual(["K35"]);
      expect(codes.procedures.map((p) => p.code)).toEqual(["APPENDECTOMY"]);
      // Still nothing flagged as demo.
      expect(Object.values(await counts(DEMO_FLAGGED, "is_demo")).every((n) => n === 0)).toBe(true);
    });
  });
});
