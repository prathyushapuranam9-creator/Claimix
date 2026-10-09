import "server-only";
import type { DbOrTx } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { PolicyRepository } from "@/modules/policies/policies.repository";
import { evaluate } from "./engine/engine";
import { parseRuleConfig, RULE_KINDS } from "./engine/kinds";
import type { CaseFacts, Evaluation, RuleCategory } from "./engine/types";
import { RuleRepository } from "./rules.repository";
import { publishSchema, ruleInputSchema } from "./rules.validation";

type RuleRow = Awaited<ReturnType<typeof RuleRepository.rulesOf>>[number];

/** Parses the form's config JSON and validates it against the rule kind and category. */
function buildConfig(kind: string, category: RuleCategory, json: string) {
  let body: unknown;
  try {
    body = json.trim() ? JSON.parse(json) : {};
  } catch {
    throw new ValidationError("Configuration must be valid JSON.", { configJson: ["This isn't valid JSON."] });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Configuration must be a JSON object.", { configJson: ["Use a JSON object: { ... }"] });
  }
  const parsed = parseRuleConfig({ ...(body as object), kind });
  if (!parsed.ok) throw new ValidationError("The rule configuration is invalid.", { configJson: [parsed.error] });
  const def = RULE_KINDS[parsed.kind];
  if (!(def.categories as RuleCategory[]).includes(category)) {
    throw new ValidationError(`"${def.label}" rules belong under: ${def.categories.join(", ")}.`, { category: [`Use ${def.categories.join(" or ")}.`] });
  }
  return { kind: parsed.kind, ...(parsed.config as object) };
}

function ruleAudit(r: Pick<RuleRow, "code" | "category" | "title" | "config">) {
  return { code: r.code, category: r.category, title: r.title, config: r.config };
}

export const RuleService = {
  /** Versions + rules for display. Visibility follows the policy's read scope. */
  async overview(ctx: ServiceContext, policyId: string) {
    const scope = requirePermission(ctx.principal, "policy:read");
    const policy = await PolicyRepository.findScoped(ctx.db, ctx.principal, scope, requireId(policyId, "Policy"));
    if (!policy) throw new NotFoundError("Policy not found.");
    const set = await RuleRepository.ruleSetFor(ctx.db, policyId);
    if (!set) return { policy, versions: [], active: undefined, draft: undefined };
    const versions = await RuleRepository.versions(ctx.db, set.id);
    const activeV = versions.find((v) => v.status === "active");
    const draftV = versions.find((v) => v.status === "draft");
    return {
      policy,
      versions,
      active: activeV ? { ...activeV, rules: await RuleRepository.rulesOf(ctx.db, activeV.id) } : undefined,
      draft: draftV ? { ...draftV, rules: await RuleRepository.rulesOf(ctx.db, draftV.id) } : undefined,
    };
  },

  /** Starts a draft (copying the active version's rules), or returns the existing draft. */
  async createDraft(ctx: ServiceContext, policyId: string) {
    requirePermission(ctx.principal, "policy:manage");
    return ctx.db.transaction(async (tx) => {
      if (!(await PolicyRepository.exists(tx, requireId(policyId, "Policy")))) throw new NotFoundError("Policy not found.");
      const set = await RuleRepository.ensureRuleSet(tx, policyId);
      const existing = await RuleRepository.draftOf(tx, set.id);
      if (existing) return existing;
      const draft = await RuleRepository.insertVersion(tx, { ruleSetId: set.id, version: await RuleRepository.nextVersionNo(tx, set.id), status: "draft", createdBy: ctx.principal.userId });
      const active = await RuleRepository.active(tx, policyId);
      if (active) await RuleRepository.copyRules(tx, active.version.id, draft.id);
      await AuditService.record(tx, { ...actorOf(ctx), action: "rules.draft_created", resourceType: "rule_version", resourceId: draft.id, newState: { policyId, version: draft.version, copiedFrom: active?.version.version ?? null } });
      return draft;
    });
  },

  async saveRule(ctx: ServiceContext, versionId: string, input: unknown, ruleId?: string) {
    requirePermission(ctx.principal, "policy:manage");
    const d = parseOrThrow(ruleInputSchema, input);
    const config = buildConfig(d.kind, d.category, d.configJson);
    return ctx.db.transaction(async (tx) => {
      const v = await RuleRepository.version(tx, requireId(versionId, "Rule version"));
      if (!v) throw new NotFoundError("Rule version not found.");
      if (v.version.status !== "draft") throw new ConflictError("Published rule versions can't be edited. Create a new draft.");
      const siblings = await RuleRepository.rulesOf(tx, versionId);
      if (siblings.some((r) => r.code === d.code && r.id !== ruleId)) throw new ValidationError("Another rule in this version uses that code.", { code: ["Codes must be unique within a version."] });

      if (ruleId) {
        const before = siblings.find((r) => r.id === requireId(ruleId, "Rule"));
        if (!before) throw new NotFoundError("Rule not found in this draft.");
        const row = await RuleRepository.updateRule(tx, ruleId, { category: d.category, code: d.code, title: d.title, config, sortOrder: d.sortOrder });
        await AuditService.record(tx, { ...actorOf(ctx), action: "rules.rule_updated", resourceType: "rule", resourceId: ruleId, previousState: ruleAudit(before), newState: ruleAudit(row) });
        return row;
      }
      const row = await RuleRepository.insertRule(tx, { ruleVersionId: versionId, category: d.category, code: d.code, title: d.title, config, sortOrder: d.sortOrder });
      await AuditService.record(tx, { ...actorOf(ctx), action: "rules.rule_added", resourceType: "rule", resourceId: row.id, newState: ruleAudit(row) });
      return row;
    });
  },

  async deleteRule(ctx: ServiceContext, ruleId: string) {
    requirePermission(ctx.principal, "policy:manage");
    return ctx.db.transaction(async (tx) => {
      const r = await RuleRepository.rule(tx, requireId(ruleId, "Rule"));
      if (!r) throw new NotFoundError("Rule not found.");
      const v = await RuleRepository.version(tx, r.ruleVersionId);
      if (v?.version.status !== "draft") throw new ConflictError("Published rules can't be deleted. Create a new draft.");
      await RuleRepository.deleteRule(tx, ruleId);
      await AuditService.record(tx, { ...actorOf(ctx), action: "rules.rule_deleted", resourceType: "rule", resourceId: ruleId, previousState: ruleAudit(r) });
    });
  },

  async discardDraft(ctx: ServiceContext, versionId: string) {
    requirePermission(ctx.principal, "policy:manage");
    return ctx.db.transaction(async (tx) => {
      const v = await RuleRepository.version(tx, requireId(versionId, "Rule version"));
      if (!v) throw new NotFoundError("Rule version not found.");
      if (v.version.status !== "draft") throw new ConflictError("Only drafts can be discarded.");
      await RuleRepository.deleteVersion(tx, versionId);
      await AuditService.record(tx, { ...actorOf(ctx), action: "rules.draft_discarded", resourceType: "rule_version", resourceId: versionId, previousState: { policyId: v.policyId, version: v.version.version } });
      return v.policyId;
    });
  },

  /** Publishes a draft: every rule must be valid; the previous active version is retired atomically. */
  async publish(ctx: ServiceContext, versionId: string, input: unknown) {
    requirePermission(ctx.principal, "policy:manage");
    const { effectiveFrom } = parseOrThrow(publishSchema, input);
    return ctx.db.transaction(async (tx) => {
      const v = await RuleRepository.version(tx, requireId(versionId, "Rule version"));
      if (!v) throw new NotFoundError("Rule version not found.");
      if (v.version.status !== "draft") throw new ConflictError("This version is already published.");
      const list = await RuleRepository.rulesOf(tx, versionId);
      if (list.length === 0) throw new ValidationError("Add at least one rule before publishing.");
      const invalid = list.filter((r) => !parseRuleConfig(r.config).ok);
      if (invalid.length) throw new ValidationError(`Fix these rules before publishing: ${invalid.map((r) => r.code).join(", ")}.`);

      const active = await RuleRepository.active(tx, v.policyId);
      if (active) await RuleRepository.setVersionStatus(tx, active.version.id, "retired");
      await RuleRepository.setVersionStatus(tx, versionId, "active", effectiveFrom);
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "rules.version_published",
        resourceType: "rule_version",
        resourceId: versionId,
        previousState: active ? { activeVersion: active.version.version } : null,
        newState: { policyId: v.policyId, activeVersion: v.version.version, effectiveFrom, ruleCount: list.length },
      });
      return v.policyId;
    });
  },
};

/**
 * Runs the active rules of a policy against case facts and records the evaluation
 * (policy, rule set, version, per-rule results, missing information, input
 * snapshot, actor, time). Called inside the caller's transaction.
 * Returns NEEDS_VERIFICATION when the policy has no published rules.
 */
export async function evaluateAndRecord(
  db: DbOrTx,
  ctx: Pick<ServiceContext, "principal" | "meta">,
  args: { policyId: string; subjectType: "eligibility_check" | "preauth" | "claim"; subjectId?: string; facts: CaseFacts },
): Promise<{ evaluation: Evaluation; evaluationId: string | null; ruleVersion: number | null }> {
  const active = await RuleRepository.active(db, args.policyId);
  if (!active) {
    return {
      evaluation: {
        overall: "NEEDS_VERIFICATION",
        results: [],
        missingInformation: ["Published rules for this policy"],
        requiredDocuments: [],
        preauthRequired: null,
        estimate: null,
      },
      evaluationId: null,
      ruleVersion: null,
    };
  }
  const evaluation = evaluate(
    active.rules.map((r) => ({ id: r.id, code: r.code, title: r.title, category: r.category, config: r.config })),
    args.facts,
  );
  const row = await RuleRepository.insertEvaluation(db, {
    policyId: args.policyId,
    ruleSetId: active.ruleSet.id,
    ruleVersionId: active.version.id,
    organizationId: ctx.principal.organizationId,
    actorUserId: ctx.principal.userId,
    subjectType: args.subjectType,
    subjectId: args.subjectId ?? null,
    overallResult: evaluation.overall,
    results: evaluation.results,
    missingInformation: evaluation.missingInformation,
    inputSnapshot: args.facts as unknown as Record<string, unknown>,
  });
  await AuditService.record(db, {
    ...actorOf(ctx),
    action: "rules.evaluated",
    resourceType: "rule_evaluation",
    resourceId: row.id,
    newState: { policyId: args.policyId, ruleVersion: active.version.version, subjectType: args.subjectType, subjectId: args.subjectId ?? null, overall: evaluation.overall },
  });
  return { evaluation, evaluationId: row.id, ruleVersion: active.version.version };
}

/**
 * The documents a policy's published rules ask for at one stage, read without recording an evaluation
 * (the engine is pure). Null when the policy has no published rules.
 */
export async function requiredDocumentsFor(db: DbOrTx, policyId: string, stage: "preauth" | "claim", asOf: string) {
  const active = await RuleRepository.active(db, policyId);
  if (!active) return null;
  const ev = evaluate(active.rules.map((r) => ({ id: r.id, code: r.code, title: r.title, category: r.category, config: r.config })), { stage, asOf });
  return ev.requiredDocuments.filter((d) => d.stage === stage);
}

/**
 * Reloads a recorded evaluation. The engine is deterministic, so re-running the
 * exact rule version on the stored input snapshot reproduces the original result.
 */
export async function loadEvaluation(db: DbOrTx, evaluationId: string): Promise<{ evaluation: Evaluation; ruleVersion: number; evaluatedAt: Date } | null> {
  const row = await RuleRepository.evaluation(db, evaluationId);
  if (!row) return null;
  const list = await RuleRepository.rulesOf(db, row.evaluation.ruleVersionId);
  const evaluation = evaluate(
    list.map((r) => ({ id: r.id, code: r.code, title: r.title, category: r.category, config: r.config })),
    row.evaluation.inputSnapshot as unknown as CaseFacts,
  );
  return { evaluation, ruleVersion: row.version, evaluatedAt: row.evaluation.evaluatedAt };
}
