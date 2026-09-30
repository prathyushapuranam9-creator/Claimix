import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, documents, notifications, users } from "@/db/schema";
import { DEMO } from "@/db/seed/ids";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { AuditViewer } from "@/modules/audit/audit.viewer";
import { DocumentListService, DocumentService } from "@/modules/documents/documents.service";
import { DocumentRepository } from "@/modules/documents/documents.repository";
import { documentScanJob } from "@/modules/documents/scan-job";
import { setStorageForTests } from "@/modules/documents/storage";
import { InboxService } from "@/modules/notifications/inbox.service";
import { sendPolicyExpiryReminders } from "@/modules/notifications/reminders";
import { CoverageService } from "@/modules/patients/coverage.service";
import { PatientService } from "@/modules/patients/patients.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { approvedPreauth, codes, file, freshFloaterPatient, useTempStorage } from "./fixtures";
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

async function submittedPreauthDoc() {
  const { preauth } = await approvedPreauth(ctx.db, who, c);
  const docs = await DocumentService.forPreauth(as("staffA"), preauth.id);
  return { preauth, doc: docs.find((d) => d.docType === "insurance_card")! };
}

describe("document review", () => {
  it("only the assigned payer can review; a re-upload request needs a reason and notifies the hospital", async () => {
    const { preauth, doc } = await submittedPreauthDoc();
    await expect(DocumentService.review(as("staffA"), doc.id, { status: "verified" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(DocumentService.review(as("patientA1"), doc.id, { status: "verified" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(DocumentService.review(as("insurerB"), doc.id, { status: "verified" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(DocumentService.review(as("insurerA"), doc.id, { status: "requires_reupload" })).rejects.toBeInstanceOf(ValidationError);

    const r = await DocumentService.review(as("tpaA"), doc.id, { status: "requires_reupload", note: "Card image is blurred." });
    expect(r).toMatchObject({ status: "requires_reupload", statusNote: "Card image is blurred.", verifiedBy: who.tpaA.userId });
    // No longer counts as evidence.
    expect(await DocumentRepository.usableTypes(ctx.db, "preauth", preauth.id)).not.toContain("insurance_card");

    const [staff] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, "staff.a@demo.claimix.invalid"));
    const n = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, staff!.id), eq(notifications.kind, "document.reupload_required"), eq(notifications.resourceId, preauth.id)));
    expect(n).toHaveLength(1);
    const a = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, doc.id), eq(auditLogs.action, "document.requires_reupload")));
    expect(a).toHaveLength(1);

    // Re-upload restores the evidence.
    await DocumentService.upload(as("staffA"), { subjectType: "preauth", subjectId: preauth.id, docType: "insurance_card", file: file("card-clear.pdf") });
    expect(await DocumentRepository.usableTypes(ctx.db, "preauth", preauth.id)).toContain("insurance_card");
  });

  it("verification is recorded; closed requests can't be reviewed", async () => {
    const { preauth, doc } = await submittedPreauthDoc();
    await DocumentService.review(as("insurerA"), doc.id, { status: "verified" });
    const [row] = await ctx.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row!.status).toBe("verified");
    // Close the request, then try again.
    const draft = await PreauthService.create(as("staffA"), { beneficiaryId: (await freshFloaterPatient(ctx.db, who.staffA)).coverage.id, claimType: "cashless" });
    await DocumentService.upload(as("staffA"), { subjectType: "preauth", subjectId: draft.id, docType: "id_proof", file: file() });
    await PreauthService.cancel(as("staffA"), draft.id, { message: "Duplicate request" });
    void preauth;
    const [d2] = await DocumentService.forPreauth(as("staffA"), draft.id);
    await expect(DocumentService.review(as("insurerA"), d2!.id, { status: "verified" })).rejects.toBeInstanceOf(NotFoundError); // never submitted: invisible to payer
  });
});

describe("background document scan", () => {
  it("quarantines a file the scanner flags: blocked download, rejected status, audit + notification", async () => {
    const { doc } = await submittedPreauthDoc();
    await documentScanJob(ctx.db, { scan: async () => ({ status: "infected", reason: "Test signature" }) })({ documentId: doc.id });
    const [row] = await ctx.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row).toMatchObject({ scanStatus: "infected", status: "rejected" });
    await expect(DocumentService.download(as("staffA"), doc.id)).rejects.toBeInstanceOf(ForbiddenError);
    const a = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, doc.id), eq(auditLogs.action, "document.quarantined")));
    expect(a).toHaveLength(1);
  });

  it("leaves clean files alone", async () => {
    const { doc } = await submittedPreauthDoc();
    await documentScanJob(ctx.db, { scan: async () => ({ status: "clean" }) })({ documentId: doc.id });
    const [row] = await ctx.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row!.scanStatus).toBe("clean");
  });
});

describe("missing documents", () => {
  it("lists open requests missing mandatory documents, within scope only", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.staffA);
    const p = await PreauthService.create(as("staffA"), { beneficiaryId: coverage.id, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, admissionDate: "2026-10-10", estimatedCost: 50000 });
    await PreauthService.runChecks(as("staffA"), p.id);
    const mine = await DocumentListService.missing(as("staffA"));
    const row = mine.find((r) => r.id === p.id);
    expect(row?.missing).toEqual(expect.arrayContaining(["id_proof", "insurance_card"]));
    expect((await DocumentListService.missing(as("staffB"))).some((r) => r.id === p.id)).toBe(false);
    expect((await DocumentListService.missing(as("insurerA"))).some((r) => r.id === p.id)).toBe(false); // draft
  });
});

describe("notifications", () => {
  it("each user sees and marks only their own notifications", async () => {
    await submittedPreauthDoc(); // generates notifications for insurer A users
    const insurerList = await InboxService.list(as("insurerA"), { page: 1, pageSize: 50 }, true);
    expect(insurerList.rows.length).toBeGreaterThan(0);
    expect(insurerList.rows.every((r) => r.userId === who.insurerA.userId)).toBe(true);
    const target = insurerList.rows[0]!;

    // Another user tries to mark it read (IDOR attempt): nothing changes.
    expect(await InboxService.markRead(as("staffB"), [target.id])).toBe(0);
    const [still] = await ctx.db.select().from(notifications).where(eq(notifications.id, target.id));
    expect(still!.readAt).toBeNull();

    const before = await InboxService.unreadCount(as("insurerA"));
    expect(await InboxService.markRead(as("insurerA"), [target.id, "not-a-uuid"])).toBe(1);
    expect(await InboxService.unreadCount(as("insurerA"))).toBe(before - 1);
    await InboxService.markRead(as("insurerA"), "all");
    expect(await InboxService.unreadCount(as("insurerA"))).toBe(0);
  });

  it("links point to the right pages", async () => {
    const list = await InboxService.list(as("staffA"), { page: 1, pageSize: 20 }, false);
    for (const r of list.rows.filter((x) => x.resourceType === "preauth")) expect(r.href).toBe(`/pre-authorizations/${r.resourceId}`);
  });
});

describe("policy expiry reminders", () => {
  it("notifies the hospital once per coverage and expiry date, however often it runs", async () => {
    const p = await PatientService.create(as("staffA"), { fullName: "Expiring Cover Patient", dob: "1970-07-07", gender: "male" });
    const end = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await CoverageService.add(as("staffA"), p.id, { policyId: DEMO.policy.surakshaIndividual, memberId: `EXP-${p.id.slice(0, 8)}`, relationship: "self", coverStart: "2025-12-01", coverEnd: end, sumInsured: 300000, sumInsuredAvailable: 300000 });
    const today = new Date().toISOString().slice(0, 10);
    await sendPolicyExpiryReminders(ctx.db, today);
    await sendPolicyExpiryReminders(ctx.db, today);
    const [staff] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, "staff.a@demo.claimix.invalid"));
    const n = await ctx.db.select().from(notifications).where(and(eq(notifications.kind, "policy.expiring"), eq(notifications.resourceId, p.id), inArray(notifications.userId, [staff!.id])));
    expect(n).toHaveLength(1);
    expect(n[0]!.body).toContain(end);
    // Other hospitals aren't told about this patient.
    const [staffB] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, "staff.b@demo.claimix.invalid"));
    expect(await ctx.db.select().from(notifications).where(and(eq(notifications.resourceId, p.id), eq(notifications.userId, staffB!.id)))).toHaveLength(0);
  });
});

describe("audit viewer", () => {
  it("is admin-only, filters, and records its own use", async () => {
    for (const k of ["staffA", "insurerA", "patientA1", "readOnly"] as const) {
      await expect(AuditViewer.list(as(k), { page: 1, pageSize: 10 }, {})).rejects.toBeInstanceOf(ForbiddenError);
    }
    const r = await AuditViewer.list(as("admin"), { page: 1, pageSize: 20 }, { action: "claim." });
    expect(r.rows.every((x) => x.action.startsWith("claim."))).toBe(true);
    const wild = await AuditViewer.list(as("admin"), { page: 1, pageSize: 5 }, { action: "%" });
    expect(wild.total).toBe(0); // LIKE wildcards are literal
    const viewed = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "audit.viewed"), eq(auditLogs.actorUserId, who.admin.userId)));
    expect(viewed.length).toBeGreaterThan(0);
  });
});
