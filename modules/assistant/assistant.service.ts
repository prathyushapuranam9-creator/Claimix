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
import { answer, type Answer, type AssistantContext } from "./answer";
import { classify, INTENTS, type Intent } from "./intents";
import { getAssistantLlm } from "./llm";

const askSchema = z.object({
  subjectType: z.enum(["preauth", "claim"]),
  subjectId: z.string(),
  question: z.string().trim().min(3, "Type a question.").max(500, "Keep the question under 500 characters."),
  intent: z.enum(Object.keys(INTENTS) as [Intent, ...Intent[]]).optional(),
});

const reviewSchema = z.object({
  interactionId: z.string(),
  note: z.string().trim().max(1000).optional(),
});

const respondSchema = z.object({ response: z.string().trim().min(10, "Write a response (at least 10 characters).").max(4000) });

/**
 * Loads what the assistant may use, through the same scoped workspace services
 * the pages use — the assistant can never see more than the user can.
 */
async function loadContext(ctx: ServiceContext, type: "preauth" | "claim", id: string): Promise<AssistantContext> {
  if (type === "preauth") {
    const w = await PreauthService.workspace(ctx, id);
    const last = w.history[w.history.length - 1];
    return {
      kind: "preauth",
      reference: w.preauth.reference,
      status: w.preauth.status,
      statusLabel: STATUS_LABEL[w.preauth.status as PreauthStatus],
      claimType: w.preauth.claimType,
      policyName: w.policy.name,
      category: w.policy.category,
      payerName: w.insurerName ?? w.schemeName,
      evaluation: w.evaluation?.evaluation ?? null,
      ruleVersion: w.evaluation?.ruleVersion ?? null,
      documents: w.documents.map((d) => ({ docType: d.docType, status: d.status })),
      openQueries: w.queries.filter((q) => q.query.status === "open").map((q) => ({ reasonTitle: q.reasonTitle, reasonAction: q.reasonAction, message: q.query.message, requiredDocuments: q.query.requiredDocuments })),
      decisions: await payerDecisions(ctx, "preauth", id),
      nextAction: last?.requiredAction ?? null,
      nextTeam: last?.responsibleTeam ?? null,
    };
  }
  const w = await ClaimService.workspace(ctx, id);
  const last = w.history[w.history.length - 1];
  return {
    kind: "claim",
    reference: w.claim.reference,
    status: w.claim.status,
    statusLabel: CLAIM_STATUS_LABEL[w.claim.status as ClaimStatus],
    claimType: w.claim.claimType,
    policyName: w.policy.name,
    category: w.policy.category,
    payerName: w.insurerName ?? w.schemeName,
    evaluation: w.evaluation?.evaluation ?? null,
    ruleVersion: w.evaluation?.ruleVersion ?? null,
    documents: [...w.documents, ...w.preauthDocuments].map((d) => ({ docType: d.docType, status: d.status })),
    openQueries: w.queries.filter((q) => q.query.status === "open").map((q) => ({ reasonTitle: q.reasonTitle, reasonAction: q.reasonAction, message: q.query.message, requiredDocuments: q.query.requiredDocuments })),
    decisions: w.payerResponses.map((r) => ({ decision: r.decision, reasonTitle: r.reasonTitle, reasonMeaning: r.reasonMeaning, reasonCheck: r.reasonCheck, reasonAction: r.reasonAction, remarks: r.remarks, amount: r.approvedAmount, at: r.createdAt.toISOString() })),
    nextAction: last?.requiredAction ?? null,
    nextTeam: last?.responsibleTeam ?? null,
  };
}

async function payerDecisions(ctx: ServiceContext, type: "preauth" | "claim", id: string) {
  const rows = await HistoryRepository.payerResponses(ctx.db, type, id);
  return rows.map((r) => ({ decision: r.decision, reasonTitle: r.reasonTitle, reasonMeaning: r.reasonMeaning, reasonCheck: r.reasonCheck, reasonAction: r.reasonAction, remarks: r.remarks, amount: r.approvedAmount, at: r.createdAt.toISOString() }));
}

export const AssistantService = {
  /** Answers from records only; every question and answer is stored and audited. */
  async ask(ctx: ServiceContext, input: unknown): Promise<Answer & { interactionId: string; explanation: string | null }> {
    requirePermission(ctx.principal, "assistant:use");
    const d = parseOrThrow(askSchema, input);
    const context = await loadContext(ctx, d.subjectType, requireId(d.subjectId, "Request"));
    const intent = d.intent ?? classify(d.question);
    const result = answer(intent, d.question, context);
    const explanation = await getAssistantLlm().explain(result);

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
      return { ...result, interactionId: row!.id, explanation };
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
