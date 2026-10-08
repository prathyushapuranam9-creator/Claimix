import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, isNotNull, or, sql } from "drizzle-orm";
import { accessRequests, auditLogs, claims, hospitalNetworks, preAuthorizations } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { ConflictError, ForbiddenError, RateLimitedError, ValidationError } from "@/lib/errors";
import { randomToken } from "@/lib/security/crypto";
import { AccessRequestService } from "@/modules/access-requests/access-requests.service";
import { DashboardService } from "@/modules/dashboard/dashboard.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { PublicNetworkService } from "@/modules/public/public-network.service";
import { ReportService } from "@/modules/reports/reports.service";
import { approvedPreauth, codes, freshFloaterPatient, useTempStorage } from "./fixtures";
import { demoPrincipals, META, svc, testContext } from "./helpers";

const ctx = testContext();
// Per-run key: rate-limit buckets (keyed IP hashes) start empty on every run.
const SECRET = `phase9-${randomToken(12)}`.padEnd(40, "x");
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(() => ctx.close());

const uniqueEmail = () => `req-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "")}@example.test`;
let ipSeq = 0;
const freshIp = () => ({ ...META, ipAddress: `192.0.2.${(++ipSeq % 250) + 1}` });
const request = (email = uniqueEmail()) => ({ fullName: "Asha Rao", email, organizationName: "Demo Care Hospital 2", organizationType: "hospital" });

describe("access requests (public registration)", () => {
  it("records a pending request with an audit entry and never stores the raw IP", async () => {
    const email = uniqueEmail();
    await AccessRequestService.submit(ctx.db, request(email), { ...META, ipAddress: "198.18.0.1" }, SECRET);
    const [row] = await ctx.db.select().from(accessRequests).where(eq(accessRequests.email, email));
    expect(row).toMatchObject({ status: "pending", fullName: "Asha Rao", organizationType: "hospital" });
    expect(row!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("198.18.0.1");
    const [audit] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "access_request.created"), eq(auditLogs.resourceId, row!.id)));
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit!.newState)).not.toContain(email);
  });

  it("validates input on the server", async () => {
    await expect(AccessRequestService.submit(ctx.db, { ...request(), email: "not-an-email" }, freshIp(), SECRET)).rejects.toBeInstanceOf(ValidationError);
    await expect(AccessRequestService.submit(ctx.db, { ...request(), organizationType: "platform" }, freshIp(), SECRET)).rejects.toBeInstanceOf(ValidationError);
  });

  it("silently drops honeypot submissions and duplicate pending requests (no enumeration)", async () => {
    const email = uniqueEmail();
    await AccessRequestService.submit(ctx.db, { ...request(email), website: "http://spam.example" }, freshIp(), SECRET);
    expect(await ctx.db.select().from(accessRequests).where(eq(accessRequests.email, email))).toHaveLength(0);

    const dup = uniqueEmail();
    await AccessRequestService.submit(ctx.db, request(dup), freshIp(), SECRET);
    await expect(AccessRequestService.submit(ctx.db, request(dup.toUpperCase()), freshIp(), SECRET)).resolves.toBeUndefined();
    expect(await ctx.db.select().from(accessRequests).where(eq(accessRequests.email, dup))).toHaveLength(1);
  });

  it("rate-limits by IP", async () => {
    const meta = { ...META, ipAddress: "198.18.0.9" };
    for (let i = 0; i < 5; i++) await AccessRequestService.submit(ctx.db, request(), meta, SECRET);
    await expect(AccessRequestService.submit(ctx.db, request(), meta, SECRET)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("only user admins can list or decide; a decision is final and audited", async () => {
    const email = uniqueEmail();
    await AccessRequestService.submit(ctx.db, request(email), freshIp(), SECRET);
    const [row] = await ctx.db.select().from(accessRequests).where(eq(accessRequests.email, email));
    for (const k of ["staffA", "insurerA", "readOnly", "patientA1"] as const) {
      await expect(AccessRequestService.list(as(k), { page: 1, pageSize: 20 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(AccessRequestService.decide(as(k), row!.id, { decision: "approved" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    await AccessRequestService.decide(as("admin"), row!.id, { decision: "declined", note: "Could not verify the organization." });
    await expect(AccessRequestService.decide(as("admin"), row!.id, { decision: "approved" })).rejects.toBeInstanceOf(ConflictError);
    const [after] = await ctx.db.select().from(accessRequests).where(eq(accessRequests.id, row!.id));
    expect(after).toMatchObject({ status: "declined", reviewedBy: who.admin.userId });
    const audits = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, row!.id), eq(auditLogs.action, "access_request.declined")));
    expect(audits).toHaveLength(1);
    const listed = await AccessRequestService.list(as("admin"), { page: 1, pageSize: 20, q: email });
    expect(listed.rows.map((r) => r.id)).toEqual([row!.id]);
  });
});

describe("public hospital network search", () => {
  it("lists only in-network hospitals for an insurer and empanelled ones for a scheme, with reference fields only", async () => {
    const payers = await PublicNetworkService.payers(ctx.db);
    expect(payers.insurers.length).toBeGreaterThan(0);
    expect(payers.schemes.length).toBeGreaterThan(0);

    const insurer = { kind: "insurer" as const, id: DEMO.org.insurerA };
    const res = await PublicNetworkService.search(ctx.db, insurer, { page: 1, pageSize: 100 });
    const [expected] = await ctx.db
      .select({ n: count() })
      .from(hospitalNetworks)
      .where(and(eq(hospitalNetworks.insurerId, DEMO.org.insurerA), eq(hospitalNetworks.status, "network")));
    expect(res.total).toBeLessThanOrEqual(expected!.n);
    expect(res.rows.every((r) => r.status === "network")).toBe(true);
    for (const r of res.rows) expect(Object.keys(r).sort()).toEqual(["cashlessAvailable", "city", "id", "isDemo", "lastVerifiedAt", "name", "state", "status"]);

    const scheme = { kind: "scheme" as const, id: payers.schemes[0]!.id };
    const s = await PublicNetworkService.search(ctx.db, scheme, { page: 1, pageSize: 100 });
    expect(s.rows.every((r) => r.status === "empanelled")).toBe(true);

    const cities = await PublicNetworkService.cities(ctx.db, insurer);
    if (cities[0]) {
      const inCity = await PublicNetworkService.search(ctx.db, insurer, { page: 1, pageSize: 100 }, cities[0].city);
      expect(inCity.rows.every((r) => r.city === cities[0]!.city)).toBe(true);
    }
  });
});

describe("reports and dashboards are tenant-scoped", () => {
  beforeAll(async () => {
    // At least one submitted+decided case, and one draft that payers must never count.
    await approvedPreauth(ctx.db, who, c);
    const { coverage } = await freshFloaterPatient(ctx.db, who.staffA);
    await PreauthService.create(as("staffA"), {
      beneficiaryId: coverage.id, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, admissionDate: "2026-09-20",
      isAccident: "no", pedDeclared: "no", pedRelated: "unknown", estimatedCost: 1000, expectedInsuranceAmount: 1000, roomRentPerDay: 1000,
    });
  });

  const total = (x: Record<string, number> | null) => Object.values(x ?? {}).reduce((a, b) => a + b, 0);

  it("hospital staff see exactly their hospital's cases", async () => {
    const r = await ReportService.overview(as("staffA"), {});
    const [pa] = await ctx.db.select({ n: count() }).from(preAuthorizations).where(eq(preAuthorizations.hospitalId, DEMO.org.hospitalA));
    const [cl] = await ctx.db.select({ n: count() }).from(claims).where(eq(claims.hospitalId, DEMO.org.hospitalA));
    expect(total(r.preauthStatus)).toBe(pa!.n);
    expect(total(r.claimStatus)).toBe(cl!.n);
    expect(r.preauthStatus?.draft ?? 0).toBeGreaterThan(0);
  });

  it("payers see only submitted cases sent to them, never a hospital's drafts (only drafts they raised themselves)", async () => {
    const r = await ReportService.overview(as("insurerA"), {});
    const [pa] = await ctx.db
      .select({ n: count() })
      .from(preAuthorizations)
      .where(or(and(eq(preAuthorizations.insurerId, DEMO.org.insurerA), isNotNull(preAuthorizations.submittedAt)), eq(preAuthorizations.raisedByOrgId, DEMO.org.insurerA)));
    expect(total(r.preauthStatus)).toBe(pa!.n);
    // New Claim wizard drafts are the insurer's own work in progress; no hospital draft is ever counted.
    const [ownDrafts] = await ctx.db
      .select({ n: count() })
      .from(preAuthorizations)
      .where(and(eq(preAuthorizations.status, "draft"), eq(preAuthorizations.raisedByOrgId, DEMO.org.insurerA)));
    expect(r.preauthStatus?.draft ?? 0).toBe(ownDrafts!.n);
    expect(r.preauthTat?.decided ?? 0).toBeGreaterThan(0);

    const b = await ReportService.overview(as("insurerB"), {});
    const [pb] = await ctx.db
      .select({ n: count() })
      .from(preAuthorizations)
      .where(and(eq(preAuthorizations.insurerId, DEMO.org.insurerB), isNotNull(preAuthorizations.submittedAt)));
    expect(total(b.preauthStatus)).toBe(pb!.n);
  });

  it("reports require report:view", async () => {
    await expect(ReportService.overview(as("patientA1"), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ReportService.overview(as("readOnly"), {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a date range narrows the report", async () => {
    const r = await ReportService.overview(as("staffA"), { from: "1990-01-01", to: "1990-12-31" });
    expect(total(r.preauthStatus)).toBe(0);
    expect(r.financials).toEqual([]);
  });

  it("each role gets its own dashboard variant with scoped data", async () => {
    expect((await DashboardService.forCaller(as("admin"))).variant).toBe("admin");
    expect((await DashboardService.forCaller(as("staffA"))).variant).toBe("hospital");
    expect((await DashboardService.forCaller(as("insurerA"))).variant).toBe("payer");
    expect((await DashboardService.forCaller(as("tpaA"))).variant).toBe("payer");

    // Patient and read-only users have no dashboard.
    await expect(DashboardService.forCaller(as("readOnly"))).rejects.toThrow();
    await expect(DashboardService.forCaller(as("patientA1"))).rejects.toThrow();

    const staff = await DashboardService.forCaller(as("staffB"));
    if (staff.variant !== "hospital") throw new Error("expected hospital");
    const ids = [...staff.actionPreauths, ...staff.actionClaims].map((x) => x.id);
    if (ids.length) {
      const rows = await ctx.db.select({ h: preAuthorizations.hospitalId }).from(preAuthorizations).where(sql`${preAuthorizations.id} in ${ids}`);
      expect(rows.every((r) => r.h === DEMO.org.hospitalB)).toBe(true);
    }
    expect(staff.admin).toBeNull();
  });
});
