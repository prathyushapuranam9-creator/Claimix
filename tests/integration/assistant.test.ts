import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { assistantInteractions, auditLogs, notifications, reviewRequests } from "@/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { AssistantService } from "@/modules/assistant/assistant.service";
import { setStorageForTests } from "@/modules/documents/storage";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { approvedPreauth, codes, freshFloaterPatient, useTempStorage } from "./fixtures";
import { createThrowawayUser, demoPrincipals, principalFor, svc, testContext, insuranceDesk } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let c: Awaited<ReturnType<typeof codes>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);

beforeAll(async () => {
  // These tests are about the records-based answers: never call a real AI service, whatever .env.local holds.
  vi.stubEnv("LLM_ASSISTANT_ENABLED", "false");
  useTempStorage();
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  c = await codes(ctx.db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  setStorageForTests(undefined);
  await ctx.close();
});

describe("asking the assistant", () => {
  it("answers from the request's records, and stores + audits every question", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const a = await AssistantService.ask(as("deskA"), { subjectType: "preauth", subjectId: preauth.id, question: "Is the policy active?" });
    expect(a.intent).toBe("policy_active");
    expect(a.status).toBe("answered");
    expect(a.facts.some((f) => f.source === "rules")).toBe(true);
    const [row] = await ctx.db.select().from(assistantInteractions).where(eq(assistantInteractions.id, a.interactionId));
    expect(row).toMatchObject({ userId: who.deskA.userId, subjectId: preauth.id, source: "rules" });
    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "assistant.asked"), eq(auditLogs.resourceId, preauth.id)));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("never reports an approved request as rejected, and reports the payer's approval as the payer's", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const r = await AssistantService.ask(as("deskA"), { subjectType: "preauth", subjectId: preauth.id, question: "Why was it rejected?" });
    expect(r.headline).toBe("This request has not been rejected.");
    const n = await AssistantService.ask(as("insurerA"), { subjectType: "preauth", subjectId: preauth.id, question: "What should happen next?" });
    expect(n.facts.find((f) => f.text.startsWith("Latest payer response"))?.source).toBe("payer");
  });

  it("can only see what the user can see", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    for (const k of ["deskB", "insurerB"] as const) {
      await expect(AssistantService.ask(as(k), { subjectType: "preauth", subjectId: preauth.id, question: "Is the policy active?" })).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(AssistantService.ask(as("patientA1"), { subjectType: "preauth", subjectId: preauth.id, question: "Is the policy active?" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(AssistantService.ask(as("deskA"), { subjectType: "preauth", subjectId: "not-a-uuid", question: "Is the policy active?" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("asks for information instead of guessing when checks haven't been run", async () => {
    const { coverage } = await freshFloaterPatient(ctx.db, who.deskA);
    const p = await PreauthService.create(as("deskA"), { beneficiaryId: coverage.id, claimType: "cashless" });
    const a = await AssistantService.ask(as("deskA"), { subjectType: "preauth", subjectId: p.id, question: "Is the hospital eligible?" });
    expect(a.status).toBe("needs_information");
    expect(a.askFor.length).toBeGreaterThan(0);
  });
});

describe("human review", () => {
  it("a colleague answers; the asker can't answer their own; other organizations can't see it; the asker is notified", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const q = await AssistantService.ask(as("deskA"), { subjectType: "preauth", subjectId: preauth.id, question: "Can the patient pay the difference in instalments?" });
    expect(q.status).toBe("needs_human_review");
    const review = await AssistantService.requestReview(as("deskA"), { interactionId: q.interactionId, note: "Patient asked at the desk" });

    // Other orgs: invisible.
    expect((await AssistantService.reviews(as("deskB"), "open")).some((r) => r.review.id === review.id)).toBe(false);
    await expect(AssistantService.respond(as("deskB"), review.id, { response: "Not our patient, but anyway..." })).rejects.toBeInstanceOf(NotFoundError);
    await expect(AssistantService.respond(as("insurerA"), review.id, { response: "Payer answering a hospital's internal review." })).rejects.toBeInstanceOf(NotFoundError);
    // Asker can't self-answer.
    await expect(AssistantService.respond(as("deskA"), review.id, { response: "Answering my own question here." })).rejects.toBeInstanceOf(ForbiddenError);

    // A colleague at the same hospital answers.
    const colleague = await createThrowawayUser(ctx.db, "Colleague-pass-123");
    const colleagueCtx = svc(ctx.db, insuranceDesk(await principalFor(ctx.auth, colleague.email, "Colleague-pass-123")));
    expect((await AssistantService.reviews(colleagueCtx, "open")).some((r) => r.review.id === review.id)).toBe(true);
    await AssistantService.respond(colleagueCtx, review.id, { response: "Instalments are a hospital billing matter; the insurer pays only the approved amount." });
    await expect(AssistantService.respond(colleagueCtx, review.id, { response: "Answering a second time." })).rejects.toBeInstanceOf(ValidationError);

    const [row] = await ctx.db.select().from(reviewRequests).where(eq(reviewRequests.id, review.id));
    expect(row).toMatchObject({ status: "answered", respondedBy: colleagueCtx.principal.userId });
    const n = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, who.deskA.userId), eq(notifications.kind, "assistant.review_answered"), eq(notifications.resourceId, preauth.id)));
    expect(n).toHaveLength(1);
  });

  it("only the person who asked can send their question for review", async () => {
    const { preauth } = await approvedPreauth(ctx.db, who, c);
    const q = await AssistantService.ask(as("deskA"), { subjectType: "preauth", subjectId: preauth.id, question: "Something unusual about this case" });
    await expect(AssistantService.requestReview(as("insurerA"), { interactionId: q.interactionId })).rejects.toBeInstanceOf(NotFoundError);
  });
});
