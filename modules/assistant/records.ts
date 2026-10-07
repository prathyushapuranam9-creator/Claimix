import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ClaimService } from "@/modules/claims/claims.service";
import { CLAIM_STATUS_LABEL, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { STATUS_LABEL, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { HistoryRepository } from "@/modules/workflow/history.repository";
import type { AssistantContext } from "./answer";

/**
 * Loads what the assistant may use, through the same scoped workspace services
 * the pages use — the assistant can never see more than the user can.
 */
export async function loadContext(ctx: ServiceContext, type: "preauth" | "claim", id: string): Promise<AssistantContext> {
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

