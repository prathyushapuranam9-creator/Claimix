import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, isNotNull, ne, sql } from "drizzle-orm";
import { claims } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { PolicyCheckService } from "@/modules/patients/policy-check.service";
import { CASES_PAGE_SIZE, CaseReportService, parseCaseOptions } from "@/modules/reports/cases-report.service";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { approvedPreauth, codes, useTempStorage } from "./fixtures";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const ALL = {};

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  await approvedPreauth(ctx.db, who, await codes(ctx.db)); // ensures some activity exists
});
afterAll(() => ctx.close());

const countClaims = async (...conds: ReturnType<typeof eq>[]) => {
  const [r] = await ctx.db.select({ n: count() }).from(claims).where(and(ne(claims.status, "cancelled"), ...conds));
  return r!.n;
};

describe("cases report", () => {
  it("shows a hospital exactly its own cases, with a dynamic count", async () => {
    const r = await CaseReportService.cases(as("deskA"), ALL, parseCaseOptions({}));
    expect(r.total).toBe(await countClaims(eq(claims.hospitalId, DEMO.org.hospitalA)));
    expect(r.rows.length).toBe(Math.min(r.total, CASES_PAGE_SIZE));
  });

  it("shows an insurer only cases submitted to it, never drafts", async () => {
    const r = await CaseReportService.cases(as("insurerA"), ALL, parseCaseOptions({}));
    expect(r.total).toBe(await countClaims(eq(claims.insurerId, DEMO.org.insurerA), isNotNull(claims.submittedAt) as never));
    const b = await CaseReportService.cases(as("insurerB"), ALL, parseCaseOptions({}));
    const ids = new Set(r.rows.map((x) => x.id));
    expect(b.rows.some((x) => ids.has(x.id))).toBe(false);
  });

  it("is refused without report access", async () => {
    await expect(CaseReportService.cases(as("patientA1"), ALL, parseCaseOptions({}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(CaseReportService.tatDistribution(as("readOnly"), ALL)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("computes shortfall from real amounts and sorts on numbers, not text", async () => {
    const r = await CaseReportService.cases(as("admin"), ALL, parseCaseOptions({ sort: "billed", dir: "asc" }));
    for (const x of r.rows) expect(x.shortfall).toBe(Math.max((x.billed ?? 0) - x.received, 0));
    const billed = r.rows.map((x) => x.billed ?? 0);
    expect(billed).toEqual([...billed].sort((a, b) => a - b));
    const tat = (await CaseReportService.cases(as("admin"), ALL, parseCaseOptions({ sort: "tat", dir: "desc" }))).rows.map((x) => x.tatDays).filter((x) => x !== null) as number[];
    expect(tat).toEqual([...tat].sort((a, b) => b - a));
    // Unknown sort/direction values fall back safely.
    expect(parseCaseOptions({ sort: "; drop table", dir: "sideways", page: "-3" })).toEqual({ sort: "case", dir: "desc", page: 1 });
  });

  it("puts every submitted case in exactly one TAT bucket; drafts are counted separately", async () => {
    const d = (await CaseReportService.tatDistribution(as("deskA"), ALL))!;
    expect(d.buckets.map((b) => b.label)).toEqual(["0–15 days", "16–30 days", "31–45 days", "46–60 days", "61–90 days", "90+ days"]);
    const submitted = await countClaims(eq(claims.hospitalId, DEMO.org.hospitalA), isNotNull(claims.submittedAt) as never);
    expect(d.totalCases).toBe(submitted);
    expect(d.buckets.reduce((a, b) => a + b.cases, 0)).toBe(submitted);
    const drafts = await countClaims(eq(claims.hospitalId, DEMO.org.hospitalA), sql`${claims.submittedAt} is null` as never);
    expect(d.notSubmitted).toBe(drafts);
  });

  it("an empty date range gives an empty report, not invented values", async () => {
    const range = { from: "1990-01-01", to: "1990-12-31" };
    expect((await CaseReportService.cases(as("admin"), range, parseCaseOptions({}))).total).toBe(0);
    const d = (await CaseReportService.tatDistribution(as("admin"), range))!;
    expect(d.totalCases).toBe(0);
    expect(d.buckets.every((b) => b.cases === 0 && b.billed === 0 && b.approved === 0 && b.received === 0)).toBe(true);
  });
});

describe("policy check", () => {
  it("loads only the selected patient's data, within the viewer's scope", async () => {
    const own = await PolicyCheckService.forPatient(as("deskA"), DEMO.patient.a1);
    expect(own.preauths).not.toBeNull();
    const [mine] = await ctx.db.select({ n: count() }).from(claims).where(eq(claims.patientId, DEMO.patient.a1));
    expect(own.claims!.length).toBe(Math.min(mine!.n, 50));

    // Another hospital can't open this patient at all.
    await expect(PolicyCheckService.forPatient(as("deskB"), DEMO.patient.a1)).rejects.toBeInstanceOf(NotFoundError);
    // A patient sees their own record, not someone else's.
    await expect(PolicyCheckService.forPatient(as("patientA1"), DEMO.patient.a1)).resolves.toBeTruthy();
    await expect(PolicyCheckService.forPatient(as("patientA1"), DEMO.patient.a2)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("policy check data isolation", () => {
  it("every record shown belongs to the selected patient; two patients' data never mix", async () => {
    const owner = async (table: "pre_authorizations" | "claims" | "documents", ids: string[]) =>
      ids.length ? (await ctx.db.execute<{ patient_id: string }>(sql`select distinct patient_id::text from ${sql.raw(table)} where id in ${ids}`)).map((r) => r.patient_id) : [];
    const seen = new Map<string, Set<string>>();
    for (const patientId of [DEMO.patient.a1, DEMO.patient.a2]) {
      const d = await PolicyCheckService.forPatient(as("deskA"), patientId);
      const ids = [...d.preauths!.map((r) => r.id), ...d.claims!.map((r) => r.id), ...d.documents!.map((r) => r.id)];
      for (const [table, rows] of [["pre_authorizations", d.preauths!], ["claims", d.claims!], ["documents", d.documents!]] as const) {
        const owners = await owner(table, rows.map((r) => r.id));
        expect(owners.every((o) => o === patientId)).toBe(true);
      }
      seen.set(patientId, new Set(ids));
    }
    const a1 = seen.get(DEMO.patient.a1)!;
    expect([...seen.get(DEMO.patient.a2)!].some((id) => a1.has(id))).toBe(false);
  });
});
