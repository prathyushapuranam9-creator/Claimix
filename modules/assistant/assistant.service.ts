import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { assistantInteractions, notifications, reviewRequests, users } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission, scopeFor } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { ClaimService } from "@/modules/claims/claims.service";
import { CLAIM_STATUS_LABEL, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { NotificationService } from "@/modules/notifications/notifications.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { STATUS_LABEL, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { HistoryRepository } from "@/modules/workflow/history.repository";
import { answer, type Answer } from "./answer";
import { loadContext } from "./records";
import { classify, INTENTS, type Intent } from "./intents";
import { guideChat, type Focus, type GuideReply } from "./guide";
import { getAssistantLlm } from "./llm";

const askSchema = z.object({
  subjectType: z.enum(["preauth", "claim"]),
  subjectId: z.string(),
  question: z.string().trim().min(3, "Type a question.").max(500, "Keep the question under 500 characters."),
  intent: z.enum(Object.keys(INTENTS) as [Intent, ...Intent[]]).optional(),
});

const guideSchema = z.object({
  question: z.string().trim().min(2, "Type a question.").max(500, "Keep the question under 500 characters."),
  /** The record the conversation is about (re-checked against the caller's access on every turn). */
  focusId: z.string().max(64).nullish(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(3000) })).max(12).default([]),
});

const reviewSchema = z.object({
  interactionId: z.string(),
  note: z.string().trim().max(1000).optional(),
});

const respondSchema = z.object({ response: z.string().trim().min(10, "Write a response (at least 10 characters).").max(4000) });

export const AssistantService = {
  /** Answers a question about the Claimix application: navigation, workflows, roles, and records the caller may see (looked up through the scoped services). */
  async guide(ctx: ServiceContext, input: unknown): Promise<GuideReply & { focus: Focus | null }> {
    requirePermission(ctx.principal, "assistant:use");
    const d = parseOrThrow(guideSchema, input);
    return guideChat(ctx, d.question, d.history, d.focusId ? { id: d.focusId } : null);
  },

  /** Answers from records only; every question and answer is stored and audited. */
  async ask(ctx: ServiceContext, input: unknown): Promise<Answer & { interactionId: string; explanation: string | null; llmNotice: string | null }> {
    requirePermission(ctx.principal, "assistant:use");
    const d = parseOrThrow(askSchema, input);
    const context = await loadContext(ctx, d.subjectType, requireId(d.subjectId, "Request"));
    const intent = d.intent ?? classify(d.question);
    const result = answer(intent, d.question, context);
    const llm = await getAssistantLlm().explain(result);
    const explanation = llm?.ok ? llm.text : null;
    const llmNotice = llm && !llm.ok ? llm.message : null;

    return ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(assistantInteractions)
        .values({
          userId: ctx.principal.userId,
          organizationId: ctx.principal.organizationId,
          subjectType: d.subjectType,
          subjectId: d.subjectId,
          question: d.question,
          answer: JSON.stringify({ headline: result.headline, status: result.status, facts: result.facts, askFor: result.askFor, nextSteps: result.nextSteps }),
          source: explanation ? "llm" : "rules",
          needsHumanReview: result.status === "needs_human_review",
        })
        .returning({ id: assistantInteractions.id });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "assistant.asked",
        resourceType: d.subjectType,
        resourceId: d.subjectId,
        newState: { interactionId: row!.id, intent, status: result.status },
      });
      return { ...result, interactionId: row!.id, explanation, llmNotice };
    });
  },

  /** Recent requests the user can ask about (their own scope). */
  async subjects(ctx: ServiceContext) {
    requirePermission(ctx.principal, "assistant:use");
    const q = { page: 1, pageSize: 25 };
    const [pre, cl] = await Promise.all([
      scopeFor(ctx.principal, "preauth:read") ? PreauthService.list(ctx, q, {}) : Promise.resolve({ rows: [] as { id: string; reference: string; patientName: string; status: string }[] }),
      scopeFor(ctx.principal, "claim:read") ? ClaimService.list(ctx, q, {}) : Promise.resolve({ rows: [] as { id: string; reference: string; patientName: string; status: string }[] }),
    ]);
    return [
      ...pre.rows.map((r) => ({ type: "preauth" as const, id: r.id, label: `${r.reference} · ${r.patientName} (${STATUS_LABEL[r.status as PreauthStatus]})` })),
      ...cl.rows.map((r) => ({ type: "claim" as const, id: r.id, label: `${r.reference} · ${r.patientName} (${CLAIM_STATUS_LABEL[r.status as ClaimStatus]})` })),
    ];
  },

  /** Sends an answered question to a person in the same organization. */
  async requestReview(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "assistant:use");
    const d = parseOrThrow(reviewSchema, input);
    return ctx.db.transaction(async (tx) => {
      const [it] = await tx
        .select()
        .from(assistantInteractions)
        .where(and(eq(assistantInteractions.id, requireId(d.interactionId, "Question")), eq(assistantInteractions.userId, ctx.principal.userId)))
        .limit(1);
      if (!it) throw new NotFoundError("Question not found.");
      const parsed = JSON.parse(it.answer) as { headline: string; status: string };
      const [row] = await tx
        .insert(reviewRequests)
        .values({
          organizationId: ctx.principal.organizationId,
          requestedBy: ctx.principal.userId,
          interactionId: it.id,
          subjectType: it.subjectType,
          subjectId: it.subjectId,
          question: it.question,
          reason: [parsed.headline, d.note].filter(Boolean).join(" — "),
        })
        .returning();
      await AuditService.record(tx, { ...actorOf(ctx), action: "assistant.review_requested", resourceType: "review_request", resourceId: row!.id, newState: { interactionId: it.id } });
      await NotificationService.toOrganizations(tx, [ctx.principal.organizationId], {
        kind: "assistant.review_requested",
        title: "A question was sent for human review",
        body: it.question.slice(0, 200),
        resourceType: "review",
        resourceId: row!.id,
      }, ctx.principal.userId);
      return row!;
    });
  },

  async reviews(ctx: ServiceContext, status: "open" | "answered") {
    const scope = requirePermission(ctx.principal, "assistant:review");
    return ctx.db
      .select({ review: reviewRequests, requesterName: users.fullName })
      .from(reviewRequests)
      .innerJoin(users, eq(users.id, reviewRequests.requestedBy))
      .where(and(eq(reviewRequests.status, status), scope === "all" ? undefined : eq(reviewRequests.organizationId, ctx.principal.organizationId)))
      .orderBy(desc(reviewRequests.createdAt))
      .limit(100);
  },

  /** A colleague (not the person who asked) answers; the asker is notified. */
  async respond(ctx: ServiceContext, id: string, input: unknown) {
    const scope = requirePermission(ctx.principal, "assistant:review");
    const d = parseOrThrow(respondSchema, input);
    return ctx.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(reviewRequests)
        .where(and(eq(reviewRequests.id, requireId(id, "Review")), scope === "all" ? undefined : eq(reviewRequests.organizationId, ctx.principal.organizationId)))
        .limit(1);
      if (!r) throw new NotFoundError("Review not found.");
      if (r.status !== "open") throw new ValidationError("This review has already been answered.");
      if (r.requestedBy === ctx.principal.userId) throw new ForbiddenError("Someone other than the person who asked should review this.");
      const [row] = await tx
        .update(reviewRequests)
        .set({ status: "answered", response: d.response, respondedBy: ctx.principal.userId, respondedAt: new Date() })
        .where(and(eq(reviewRequests.id, r.id), inArray(reviewRequests.status, ["open"])))
        .returning();
      await AuditService.record(tx, { ...actorOf(ctx), action: "assistant.review_answered", resourceType: "review_request", resourceId: r.id });
      await tx.insert(notifications).values({
        userId: r.requestedBy,
        organizationId: r.organizationId,
        kind: "assistant.review_answered",
        title: "Your question was reviewed",
        body: d.response.slice(0, 300),
        resourceType: r.subjectType,
        resourceId: r.subjectId,
      });
      return row!;
    });
  },
};
