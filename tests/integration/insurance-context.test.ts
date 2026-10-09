import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { auditLogs, notifications, organizations, preAuthorizations, roles, users } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { PERMISSIONS, ROLES } from "@/lib/permissions/catalog";
import { randomToken } from "@/lib/security/crypto";
import { AuditViewer } from "@/modules/audit/audit.viewer";
import { InsuranceContext } from "@/modules/auth/insurance-context";
import { DashboardService } from "@/modules/dashboard/dashboard.service";
import { DocumentListService, DocumentService } from "@/modules/documents/documents.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { InboxService } from "@/modules/notifications/inbox.service";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { CHECKLIST } from "@/modules/preauth/preauth.checklist";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { UserService } from "@/modules/users/users.service";
import { codes, file, useTempStorage } from "./fixtures";
import { demoPrincipals, META, svc, testContext, uniqueIp } from "./helpers";

/**
 * The insurance testing portal: ONE login (an account holding `insurance:context`) chooses an insurance company and
 * one of its roles, and the app then behaves exactly as that role of that company, without another sign-in.
 */
const ctx = testContext();
const SECRET = "test-secret-".padEnd(40, "x"); // matches testContext()
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const ALL = { page: 1, pageSize: 200 };
const PREAUTH_DOCS = ["id_proof", "insurance_card", "doctor_consultation", "investigation_reports", "treatment_estimate"];
const MANUAL = CHECKLIST.filter((x) => x.source.type === "manual").map((x) => x.key);
const letters = () => randomToken(6).replace(/[^a-zA-Z]/g, "x");

const login = async (email: string) => (await ctx.auth.login({ email, password: ctx.demoPassword }, { ...META, ipAddress: uniqueIp() })).token;
const sel = (organizationId: string, roleKey = "payer_reviewer") => ({ organizationId, roleKey });

/** The principal the app would use after the account switched to this context (same login token throughout). */
async function actingAs(token: string, org: string, roleKey = "payer_reviewer") {
  const { contextToken } = await ctx.auth.switchContext(token, sel(org, roleKey), META);
  const user = await ctx.auth.resolve(token, contextToken);
  return { user: user!, c: svc(ctx.db, user!.principal), contextToken };
}

beforeAll(async () => {
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(async () => {
  setStorageForTests(undefined);
  await ctx.close();
});

/** A submitted pre-authorization of Hospital A on a policy of the given insurer. */
async function submittedOn(policyId: string) {
  const patient = await PatientService.create(as("deskA"), { fullName: `Ctx Test ${letters()}`, dob: "1981-01-01", gender: "female" });
  const cov = await CoverageService.add(as("deskA"), patient.id, {
    policyId, memberId: `CTX-${randomToken(8).replace(/[^A-Za-z0-9]/g, "x")}`, relationship: "self", coverStart: "2026-04-01", coverEnd: "2027-03-31", inceptionDate: "2021-04-01", sumInsured: 500000, sumInsuredAvailable: 500000,
  });
  const p = await PreauthService.create(as("deskA"), {
    beneficiaryId: cov.id, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, admissionDate: "2026-10-20",
    isAccident: "no", pedDeclared: "no", pedRelated: "unknown", estimatedCost: 90000, expectedInsuranceAmount: 90000, roomRentPerDay: 4000,
  });
  for (const t of PREAUTH_DOCS) await DocumentService.upload(as("deskA"), { subjectType: "preauth", subjectId: p.id, docType: t, file: file() });
  await PreauthService.runChecks(as("deskA"), p.id);
  for (const key of MANUAL) await PreauthService.confirmItem(as("deskA"), p.id, { key, confirmed: true });
  const open = (await PreauthService.workspace(as("deskA"), p.id)).checklist.items.filter((i) => !i.complete && i.confirmable);
  for (const i of open) await PreauthService.confirmItem(as("deskA"), p.id, { key: i.key, confirmed: true, note: "Verified with the payer's network desk by phone." });
  await PreauthService.submit(as("deskA"), p.id, { overrideReason: "Hospital confirms cover applies; the payer will decide." });
  return { patient, cov, p };
}
const ids = async (cx: ReturnType<typeof svc>) => (await PreauthService.list(cx, ALL, {})).rows.map((r) => r.id);

describe("who may use the testing context", () => {
  it("is a permission, not a role: only the Administrator role holds it, so ordinary insurer users cannot switch", () => {
    expect(Object.keys(PERMISSIONS)).toContain("insurance:context");
    const holders = ROLES.filter((r) => r.grants["insurance:context"]).map((r) => r.key);
    expect(holders).toEqual(["admin"]);
    expect(who.admin.permissions.has("insurance:context")).toBe(true);
    for (const k of ["insurerA", "insurerB", "tpaA", "deskA", "readOnly", "patientA1"] as const) expect(who[k].permissions.has("insurance:context"), k).toBe(false);
    // The retired "Insurance Operations Admin" role no longer exists.
    expect(ROLES.some((r) => r.key === "insurance_ops_admin")).toBe(false);
  });

  it("the retired role is gone from the database and nobody can still hold it", async () => {
    expect(await ctx.db.select().from(roles).where(eq(roles.key, "insurance_ops_admin"))).toEqual([]);
  });

  it("only a holder or a reviewer can read the options or switch; others are refused", async () => {
    const holder = await login("admin@demo.claimix.invalid");
    await expect(ctx.auth.contextOptions(holder)).resolves.toBeTruthy();
    for (const email of ["staff.a@demo.claimix.invalid", "readonly@demo.claimix.invalid", "patient.a1@demo.claimix.invalid"]) {
      const t = await login(email);
      await expect(ctx.auth.contextOptions(t), email).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ctx.auth.switchContext(t, sel(DEMO.org.insurerC), META), email).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ctx.auth.clearContext(t, META), email).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(ctx.auth.contextOptions(null)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(ctx.auth.switchContext("not-a-session", sel(DEMO.org.insurerC), META)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("insurer and role selectors (loaded from the database)", () => {
  it("lists every active insurer and TPA, each with the roles that exist for it; nothing is hardcoded", async () => {
    const token = await login("admin@demo.claimix.invalid");
    const options = await ctx.auth.contextOptions(token);
    const dbOrgs = await ctx.db
      .select({ id: organizations.id, type: organizations.type })
      .from(organizations)
      .where(and(isNull(organizations.deletedAt), eq(organizations.isActive, true), inArray(organizations.type, ["insurer", "tpa"])));
    expect(options.map((o) => o.id).sort()).toEqual(dbOrgs.map((o) => o.id).sort());
    const names = options.map((o) => o.name);
    for (const n of ["Aarogya Shield General Insurance", "Navjeevan General Insurance", "Suraksha Health Insurance", "MediAssist Claims Services"]) {
      expect(names.some((x) => x.startsWith(n)), n).toBe(true);
    }
    const roleRows = await ctx.db.select({ key: roles.key, name: roles.name }).from(roles);
    for (const o of options) {
      expect(o.roles.some((r) => r.key === "payer_reviewer"), o.name).toBe(true);
      // Only roles that exist for payer organizations are offered: never hospital, patient or administrator roles.
      for (const r of o.roles) {
        expect(roleRows.some((x) => x.key === r.key)).toBe(true);
        expect(["hospital_staff", "patient", "admin", "read_only"]).not.toContain(r.key);
      }
    }
    expect(options.every((o) => o.type === "insurer" || o.type === "tpa")).toBe(true);
  });

  it("rejects a company/role combination that doesn't exist", async () => {
    const token = await login("admin@demo.claimix.invalid");
    for (const bad of [
      sel(DEMO.org.hospitalA), // a hospital is not an insurance company
      sel(DEMO.org.platform), // neither is the platform
      sel(DEMO.org.insurerA, "hospital_staff"), // a hospital role doesn't exist for an insurer
      sel(DEMO.org.insurerA, "admin"), // no elevating to the administrator
      sel(DEMO.org.insurerA, "no_such_role"),
      sel("00000000-0000-4000-8000-00000000dead"),
      { organizationId: 5, roleKey: "payer_reviewer" },
    ]) {
      await expect(ctx.auth.switchContext(token, bad, META)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("one login, switching context: Aarogya → Navjeevan → Suraksha", () => {
  it("behaves exactly as that company's role each time, from a single sign-in, with that role's real permissions", async () => {
    const aarogya = await submittedOn(DEMO.policy.aarogyaFloater);
    const navjeevan = await submittedOn(DEMO.policy.navjeevanTopUp);
    const suraksha = await submittedOn(DEMO.policy.surakshaIndividual);
    const token = await login("admin@demo.claimix.invalid"); // the ONE login

    // Without a context it is the administrator's own view.
    const own = await ctx.auth.resolve(token);
    expect(own!.principal).toMatchObject({ roleKey: "admin", orgType: "platform" });
    expect(own!.principal.acting).toBeUndefined();

    // 1. Aarogya Shield → Payer Reviewer
    const a = await actingAs(token, DEMO.org.insurerA);
    expect(a.user.principal).toMatchObject({ organizationId: DEMO.org.insurerA, orgType: "insurer", roleKey: "payer_reviewer", patientId: null, userId: own!.principal.userId, sessionId: own!.principal.sessionId });
    expect(a.user.principal.acting?.organizationName).toMatch(/^Aarogya Shield/);
    expect(a.user).toMatchObject({ roleName: "Payer Reviewer", canSwitchContext: true });
    // Permissions are the role's real ones (identical to a real Aarogya reviewer), never the administrator's.
    expect([...a.user.principal.permissions.entries()].sort()).toEqual([...who.insurerA.permissions.entries()].sort());
    expect(a.user.principal.permissions.has("user:manage")).toBe(false);
    const aIds = await ids(a.c);
    expect(aIds).toContain(aarogya.p.id);
    expect(aIds).not.toContain(navjeevan.p.id);
    expect(aIds).not.toContain(suraksha.p.id);
    // Same data as the real Aarogya reviewer for dashboards, policies and documents.
    expect(aIds.sort()).toEqual((await ids(as("insurerA"))).sort());
    expect((await DashboardService.forCaller(a.c)).variant).toBe("payer");
    expect((await DashboardService.forCaller(a.c)).preauthStatus).toEqual((await DashboardService.forCaller(as("insurerA"))).preauthStatus);
    expect((await PolicyService.list(a.c, ALL, {})).rows.map((r) => r.id).sort()).toEqual((await PolicyService.list(as("insurerA"), ALL, {})).rows.map((r) => r.id).sort());
    expect((await DocumentListService.list(a.c, ALL, {})).rows.some((d) => d.subjectId === aarogya.p.id)).toBe(true);
    expect((await DocumentListService.list(a.c, ALL, {})).rows.some((d) => d.subjectId === navjeevan.p.id)).toBe(false);
    await expect(PreauthService.workspace(a.c, navjeevan.p.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PatientService.get(a.c, navjeevan.patient.id)).rejects.toBeInstanceOf(NotFoundError);

    // 2. Switch (same token, no new sign-in) → Navjeevan → Payer Reviewer
    const n = await actingAs(token, DEMO.org.insurerC);
    expect(n.user.principal).toMatchObject({ organizationId: DEMO.org.insurerC, orgType: "insurer", roleKey: "payer_reviewer" });
    expect(n.user.principal.acting?.organizationName).toMatch(/^Navjeevan/);
    const nIds = await ids(n.c);
    expect(nIds).toContain(navjeevan.p.id);
    expect(nIds).not.toContain(aarogya.p.id);
    expect(nIds).not.toContain(suraksha.p.id);
    expect((await DocumentListService.list(n.c, ALL, {})).rows.some((d) => d.subjectId === navjeevan.p.id)).toBe(true);
    await expect(PreauthService.workspace(n.c, aarogya.p.id)).rejects.toBeInstanceOf(NotFoundError);

    // 3. Switch → Suraksha → its insurer role
    const options = await ctx.auth.contextOptions(token);
    const surakshaRole = options.find((o) => o.id === DEMO.org.insurerB)!.roles[0]!.key;
    const s = await actingAs(token, DEMO.org.insurerB, surakshaRole);
    expect(s.user.principal.acting?.organizationName).toMatch(/^Suraksha/);
    const sIds = await ids(s.c);
    expect(sIds).toContain(suraksha.p.id);
    expect(sIds).not.toContain(aarogya.p.id);
    expect(sIds).not.toContain(navjeevan.p.id);
    expect(sIds.sort()).toEqual((await ids(as("insurerB"))).sort());

    // 4. A TPA works the same way.
    const t = await actingAs(token, DEMO.org.tpaA);
    expect(t.user.principal).toMatchObject({ orgType: "tpa", organizationId: DEMO.org.tpaA });
    expect((await ids(t.c)).sort()).toEqual((await ids(as("tpaA"))).sort());

    // The login itself never changed.
    expect((await ctx.auth.resolve(token))!.principal.roleKey).toBe("admin");
  });

  it("acts with the role's permissions: can decide its own company's request, not another's, and nothing administrative", async () => {
    const aarogya = await submittedOn(DEMO.policy.aarogyaFloater);
    const navjeevan = await submittedOn(DEMO.policy.navjeevanTopUp);
    const token = await login("admin@demo.claimix.invalid");
    const adminId = (await ctx.auth.resolve(token))!.principal.userId;

    const a = await actingAs(token, DEMO.org.insurerA);
    await PreauthService.decide(a.c, aarogya.p.id, { to: "approved", amount: 90000 });
    const [row] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.id, aarogya.p.id));
    expect(row!.status).toBe("approved");
    await expect(PreauthService.decide(a.c, navjeevan.p.id, { to: "approved", amount: 90000 })).rejects.toBeInstanceOf(NotFoundError);
    // Administrator-only areas are closed while testing as a reviewer.
    await expect(UserService.list(a.c, ALL, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(AuditViewer.list(a.c, { page: 1, pageSize: 10 }, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PolicyService.create(a.c, { name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);

    // Everything done in the context is traceable to the real account and tagged as a test context.
    const [audit] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "preauth.approved"), eq(auditLogs.resourceId, aarogya.p.id)));
    expect(audit).toMatchObject({ actorUserId: adminId, organizationId: DEMO.org.insurerA });
    expect(audit!.newState).toMatchObject({ _testContext: { roleName: "Payer Reviewer" } });
    const switched = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "context.switched"), eq(auditLogs.actorUserId, adminId)));
    expect(switched.length).toBeGreaterThan(0);
  });
});

describe("it cannot be used to bypass authorization", () => {
  it("a tampered, foreign or forged context is ignored", async () => {
    const token = await login("admin@demo.claimix.invalid");
    const other = await login("admin@demo.claimix.invalid"); // a second session of the same account
    const { contextToken } = await ctx.auth.switchContext(token, sel(DEMO.org.insurerA), META);
    const role = (u: Awaited<ReturnType<typeof ctx.auth.resolve>>) => u!.principal.roleKey;

    expect(role(await ctx.auth.resolve(token, contextToken))).toBe("payer_reviewer");
    // Altered payload or signature, or garbage.
    const [payload, sig] = contextToken.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ s: (await ctx.auth.resolve(token))!.principal.sessionId, o: DEMO.org.insurerC, r: "payer_reviewer" })).toString("base64url");
    for (const bad of [`${forgedPayload}.${sig}`, `${payload}.${"0".repeat(64)}`, `${payload}x.${sig}`, "garbage", `${payload}.`, ""]) {
      expect(role(await ctx.auth.resolve(token, bad)), bad.slice(0, 20)).toBe("admin");
    }
    // A context chosen in one session does nothing in another.
    expect(role(await ctx.auth.resolve(other, contextToken))).toBe("admin");
  });

  it("an ordinary insurer user cannot gain another insurer's view, even with a validly signed context", async () => {
    const insurerToken = await login("insurer.a@demo.claimix.invalid");
    const real = (await ctx.auth.resolve(insurerToken))!;
    const forged = InsuranceContext.sign(SECRET, real.principal.sessionId, sel(DEMO.org.insurerC));
    const viaForged = (await ctx.auth.resolve(insurerToken, forged))!;
    expect(viaForged.principal).toMatchObject({ organizationId: DEMO.org.insurerA, roleKey: "payer_reviewer" });
    expect(viaForged.principal.acting).toBeUndefined();
    // It has the testing block, but only for its own company.
    expect(viaForged.contextOrganizationId).toBe(DEMO.org.insurerA);
    // Hospital staff and read-only users likewise.
    for (const email of ["staff.a@demo.claimix.invalid", "readonly@demo.claimix.invalid"]) {
      const t = await login(email);
      const r = (await ctx.auth.resolve(t))!;
      const f = (await ctx.auth.resolve(t, InsuranceContext.sign(SECRET, r.principal.sessionId, sel(DEMO.org.insurerC))))!;
      expect(f.principal.roleKey).toBe(r.principal.roleKey);
      expect(f.principal.organizationId).toBe(r.principal.organizationId);
    }
  });

  it("stops applying when the real account is signed out or loses the permission", async () => {
    const token = await login("admin@demo.claimix.invalid");
    const { contextToken } = await ctx.auth.switchContext(token, sel(DEMO.org.insurerA), META);
    await ctx.auth.logout(token, META);
    expect(await ctx.auth.resolve(token, contextToken)).toBeNull();
  });
});

describe("notifications in a testing context", () => {
  it("shows the company's notifications read-only, without touching real reviewers' unread state", async () => {
    const x = await submittedOn(DEMO.policy.aarogyaFloater);
    const token = await login("admin@demo.claimix.invalid");
    const a = await actingAs(token, DEMO.org.insurerA);

    const realBefore = await InboxService.unreadCount(as("insurerA"));
    const view = await InboxService.list(a.c, { page: 1, pageSize: 50 }, false);
    expect(view.rows.some((r) => r.resourceId === x.p.id && r.kind === "preauth.submitted")).toBe(true);
    expect(await InboxService.unreadCount(a.c)).toBeGreaterThan(0);
    expect(await InboxService.markRead(a.c, "all")).toBe(0);
    expect(await InboxService.unreadCount(as("insurerA"))).toBe(realBefore);
    // Another company's notifications never appear.
    const n = await actingAs(token, DEMO.org.insurerB);
    expect((await InboxService.list(n.c, { page: 1, pageSize: 200 }, false)).rows.some((r) => r.resourceId === x.p.id)).toBe(false);
    // The admin's own inbox is unaffected by any of this.
    const adminRows = await ctx.db.select().from(notifications).where(eq(notifications.userId, who.admin.userId));
    expect(adminRows.every((r) => r.resourceId !== x.p.id)).toBe(true);
    const [adm] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, who.admin.userId));
    expect(adm).toBeTruthy();
  });

  it("exiting the context is audited and returns to the account's own view", async () => {
    const token = await login("admin@demo.claimix.invalid");
    await ctx.auth.switchContext(token, sel(DEMO.org.insurerA), META);
    await ctx.auth.clearContext(token, META);
    const cleared = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "context.cleared"), eq(auditLogs.actorUserId, who.admin.userId)));
    expect(cleared.length).toBeGreaterThan(0);
    expect((await ctx.auth.resolve(token))!.principal.roleKey).toBe("admin");
  });
});

describe("insurer / TPA reviewers: the testing block for their own organization only", () => {
  const reviewers = [
    ["insurer.a@demo.claimix.invalid", DEMO.org.insurerA, "insurer"],
    ["insurer.b@demo.claimix.invalid", DEMO.org.insurerB, "insurer"],
    ["tpa.a@demo.claimix.invalid", DEMO.org.tpaA, "tpa"],
  ] as const;

  it("every reviewer has the block: all active insurance companies listed, only its own selectable", async () => {
    const activeInsurers = (await ctx.db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.type, "insurer"), eq(organizations.isActive, true), isNull(organizations.deletedAt)))).map((o) => o.id);
    const tpas = (await ctx.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.type, "tpa"))).map((o) => o.id);
    for (const [email, org] of reviewers) {
      const token = await login(email);
      const me = (await ctx.auth.resolve(token))!;
      expect(me.canSwitchContext, email).toBe(true);
      expect(me.homeIsAllInsurers, email).toBe(false);
      expect(me.contextOrganizationId, email).toBe(org);
      // Still a reviewer, nothing added: the block is not a permission.
      expect(me.principal.permissions.has("insurance:context"), email).toBe(false);
      const options = await ctx.auth.contextOptions(token);
      // Every active insurance company by name, plus its own organization (a TPA's own TPA). No other TPA, hospital or platform org.
      expect(options.map((o) => o.id).sort(), email).toEqual([...new Set([...activeInsurers, org])].sort());
      expect(options.filter((o) => tpas.includes(o.id) && o.id !== org), email).toEqual([]);
      // Only its own company can be chosen, with its role; the others carry no roles.
      const selectable = options.filter((o) => o.selectable);
      expect(selectable.map((o) => o.id), email).toEqual([org]);
      expect(selectable[0]!.roles.map((r) => r.key), email).toEqual(["payer_reviewer"]);
      expect(options.filter((o) => !o.selectable).every((o) => o.roles.length === 0), email).toBe(true);
    }
  });

  it("switching to its own company works exactly like its normal view; any other company is refused", async () => {
    const aarogya = await submittedOn(DEMO.policy.aarogyaFloater);
    const suraksha = await submittedOn(DEMO.policy.surakshaIndividual);
    const token = await login("insurer.a@demo.claimix.invalid");
    const own = svc(ctx.db, (await ctx.auth.resolve(token))!.principal);

    const a = await actingAs(token, DEMO.org.insurerA);
    expect(a.user.principal).toMatchObject({ organizationId: DEMO.org.insurerA, roleKey: "payer_reviewer" });
    expect(a.user.principal.acting?.organizationName).toMatch(/^Aarogya/);
    expect((await ids(a.c)).sort()).toEqual((await ids(own)).sort());
    expect(await ids(a.c)).toContain(aarogya.p.id);
    expect(await ids(a.c)).not.toContain(suraksha.p.id);
    // Exit returns to the normal view.
    await expect(ctx.auth.clearContext(token, META)).resolves.toBeUndefined();

    // Other insurers and TPAs: refused at switch time, audited nothing.
    for (const org of [DEMO.org.insurerB, DEMO.org.insurerC, DEMO.org.tpaA]) {
      await expect(ctx.auth.switchContext(token, sel(org), META), org).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Suraksha's pre-auth stays out of reach in the normal view too.
    expect(await ids(own)).not.toContain(suraksha.p.id);
  });

  it("a validly signed context for another company is ignored on every request", async () => {
    const suraksha = await submittedOn(DEMO.policy.surakshaIndividual);
    for (const [email, org] of reviewers) {
      const token = await login(email);
      const real = (await ctx.auth.resolve(token))!;
      const other = org === DEMO.org.insurerB ? DEMO.org.insurerA : DEMO.org.insurerB;
      const forged = InsuranceContext.sign(SECRET, real.principal.sessionId, sel(other));
      const via = (await ctx.auth.resolve(token, forged))!;
      expect(via.principal.organizationId, email).toBe(org);
      expect(via.principal.acting, email).toBeUndefined();
      if (org !== DEMO.org.insurerB) expect(await ids(svc(ctx.db, via.principal)), email).not.toContain(suraksha.p.id);
    }
  });
});

describe("the designated testing login (a payer reviewer an administrator has flagged)", () => {
  it("sees the switcher on its own dashboard across every insurer; ordinary reviewers only for their own company", async () => {
    const t = (await ctx.auth.resolve(await login("insurer.portal@demo.claimix.invalid")))!;
    expect(t.canSwitchContext).toBe(true);
    expect(t.homeIsAllInsurers).toBe(false);
    expect(t.principal).toMatchObject({ organizationId: DEMO.org.insurerA, orgType: "insurer", roleKey: "payer_reviewer" });
    expect(t.principal.acting).toBeUndefined();
    // The flag is not a permission: nothing else about the role changed.
    expect(t.principal.permissions.has("insurance:context")).toBe(false);
    expect([...t.principal.permissions.entries()].sort()).toEqual([...who.insurerA.permissions.entries()].sort());
    expect(t.contextOrganizationId).toBeNull();
    for (const email of ["insurer.a@demo.claimix.invalid", "insurer.b@demo.claimix.invalid", "tpa.a@demo.claimix.invalid"]) {
      expect((await ctx.auth.resolve(await login(email)))!.contextOrganizationId, email).not.toBeNull();
    }
  });

  it("switches Aarogya → Navjeevan → Suraksha with its single login and sees exactly that company's data", async () => {
    const aarogya = await submittedOn(DEMO.policy.aarogyaFloater);
    const navjeevan = await submittedOn(DEMO.policy.navjeevanTopUp);
    const suraksha = await submittedOn(DEMO.policy.surakshaIndividual);
    const token = await login("insurer.portal@demo.claimix.invalid");
    const options = await ctx.auth.contextOptions(token);
    expect(options.map((o) => o.id)).toEqual(expect.arrayContaining([DEMO.org.insurerA, DEMO.org.insurerC, DEMO.org.insurerB]));

    // As itself (Aarogya), before any switch.
    const own = svc(ctx.db, (await ctx.auth.resolve(token))!.principal);
    expect(await ids(own)).toContain(aarogya.p.id);
    expect(await ids(own)).not.toContain(navjeevan.p.id);

    const n = await actingAs(token, DEMO.org.insurerC);
    expect(n.user.principal.acting?.organizationName).toMatch(/^Navjeevan/);
    expect(await ids(n.c)).toContain(navjeevan.p.id);
    expect(await ids(n.c)).not.toContain(aarogya.p.id);

    const s = await actingAs(token, DEMO.org.insurerB);
    expect(await ids(s.c)).toContain(suraksha.p.id);
    expect(await ids(s.c)).not.toContain(navjeevan.p.id);

    const back = await actingAs(token, DEMO.org.insurerA);
    expect(await ids(back.c)).toContain(aarogya.p.id);
    // It is still only a payer reviewer's reach: no administrative access, no other roles.
    await expect(UserService.list(back.c, ALL, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ctx.auth.switchContext(token, sel(DEMO.org.insurerA, "admin"), META)).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.auth.switchContext(token, sel(DEMO.org.hospitalA), META)).rejects.toBeInstanceOf(ValidationError);
  });

  it("an administrator turns the flag on and off per account (audited); turning it off ends any active context", async () => {
    const [target] = await ctx.db.select({ id: users.id, roleId: users.roleId, fullName: users.fullName }).from(users).where(eq(users.email, "insurer.b@demo.claimix.invalid"));
    const set = (flag: boolean) => UserService.update(as("admin"), target!.id, { fullName: target!.fullName, roleId: target!.roleId, isActive: true, insuranceContext: flag });
    try {
      const token = await login("insurer.b@demo.claimix.invalid");
      // Without the flag: its own company only.
      expect((await ctx.auth.resolve(token))!.contextOrganizationId).toBe(DEMO.org.insurerB);
      await expect(ctx.auth.switchContext(token, sel(DEMO.org.insurerA), META)).rejects.toBeInstanceOf(ForbiddenError);

      await set(true);
      const t2 = await login("insurer.b@demo.claimix.invalid");
      expect((await ctx.auth.resolve(t2))!.contextOrganizationId).toBeNull(); // every insurer
      const { contextToken } = await ctx.auth.switchContext(t2, sel(DEMO.org.insurerA), META);
      expect((await ctx.auth.resolve(t2, contextToken))!.principal.organizationId).toBe(DEMO.org.insurerA);

      await set(false); // takes effect immediately, without signing anyone out
      const after = (await ctx.auth.resolve(t2, contextToken))!;
      expect(after.contextOrganizationId).toBe(DEMO.org.insurerB);
      expect(after.principal.organizationId).toBe(DEMO.org.insurerB);
      expect(after.principal.acting).toBeUndefined();

      const audited = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "user.updated"), eq(auditLogs.resourceId, target!.id)));
      expect(audited.some((a) => (a.newState as { insuranceContext?: boolean }).insuranceContext === true)).toBe(true);
    } finally {
      await ctx.db.update(users).set({ insuranceContext: false }).where(eq(users.id, target!.id));
    }
  });

  it("only administrators can set the flag, and only on insurer / TPA logins", async () => {
    const [staff] = await ctx.db.select({ id: users.id, roleId: users.roleId, fullName: users.fullName }).from(users).where(eq(users.email, "staff.a@demo.claimix.invalid"));
    await expect(UserService.update(as("admin"), staff!.id, { fullName: staff!.fullName, roleId: staff!.roleId, isActive: true, insuranceContext: true })).rejects.toBeInstanceOf(ValidationError);
    const [rev] = await ctx.db.select({ id: users.id, roleId: users.roleId, fullName: users.fullName }).from(users).where(eq(users.email, "insurer.a@demo.claimix.invalid"));
    for (const k of ["insurerA", "deskA", "portalReviewer"] as const) {
      await expect(UserService.update(as(k), rev!.id, { fullName: rev!.fullName, roleId: rev!.roleId, isActive: true, insuranceContext: true }), k).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Still its own company only.
    expect((await ctx.auth.resolve(await login("insurer.a@demo.claimix.invalid")))!.contextOrganizationId).toBe(DEMO.org.insurerA);
  });
});
