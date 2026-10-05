import "server-only";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { organizations, policies, ruleEvaluations, rules, ruleSets, ruleVersions, users } from "@/db/schema";

/** Each policy has one rule set ("Standard") whose versions move draft → active → retired. */
export const STANDARD_RULE_SET = "Standard";

export const RuleRepository = {
  async ruleSetFor(db: DbOrTx, policyId: string) {
    const [row] = await db.select().from(ruleSets).where(and(eq(ruleSets.policyId, policyId), eq(ruleSets.name, STANDARD_RULE_SET))).limit(1);
    return row;
  },

  async ensureRuleSet(db: DbOrTx, policyId: string) {
    const existing = await RuleRepository.ruleSetFor(db, policyId);
    if (existing) return existing;
    const [row] = await db.insert(ruleSets).values({ policyId, name: STANDARD_RULE_SET }).onConflictDoNothing().returning();
    return row ?? (await RuleRepository.ruleSetFor(db, policyId))!;
  },

  /** The active version and its rules for a policy, or undefined when none is published. */
  async active(db: DbOrTx, policyId: string) {
    const [v] = await db
      .select({ ruleSet: ruleSets, version: ruleVersions })
      .from(ruleVersions)
      .innerJoin(ruleSets, eq(ruleSets.id, ruleVersions.ruleSetId))
      .where(and(eq(ruleSets.policyId, policyId), eq(ruleSets.name, STANDARD_RULE_SET), eq(ruleVersions.status, "active")))
      .limit(1);
    if (!v) return undefined;
    return { ...v, rules: await RuleRepository.rulesOf(db, v.version.id) };
  },

  async rulesOf(db: DbOrTx, versionId: string) {
    return db.select().from(rules).where(eq(rules.ruleVersionId, versionId)).orderBy(asc(rules.sortOrder), asc(rules.code));
  },

  async versions(db: DbOrTx, ruleSetId: string) {
    return db
      .select({
        id: ruleVersions.id,
        version: ruleVersions.version,
        status: ruleVersions.status,
        effectiveFrom: ruleVersions.effectiveFrom,
        createdAt: ruleVersions.createdAt,
        updatedAt: ruleVersions.updatedAt,
        ruleCount: count(rules.id),
      })
      .from(ruleVersions)
      .leftJoin(rules, eq(rules.ruleVersionId, ruleVersions.id))
      .where(eq(ruleVersions.ruleSetId, ruleSetId))
      .groupBy(ruleVersions.id)
      .orderBy(desc(ruleVersions.version));
  },

  async version(db: DbOrTx, versionId: string) {
    const [row] = await db
      .select({ version: ruleVersions, policyId: ruleSets.policyId })
      .from(ruleVersions)
      .innerJoin(ruleSets, eq(ruleSets.id, ruleVersions.ruleSetId))
      .where(eq(ruleVersions.id, versionId))
      .limit(1);
    return row;
  },

  async draftOf(db: DbOrTx, ruleSetId: string) {
    const [row] = await db.select().from(ruleVersions).where(and(eq(ruleVersions.ruleSetId, ruleSetId), eq(ruleVersions.status, "draft"))).limit(1);
    return row;
  },

  async nextVersionNo(db: DbOrTx, ruleSetId: string) {
    const [row] = await db.select({ v: max(ruleVersions.version) }).from(ruleVersions).where(eq(ruleVersions.ruleSetId, ruleSetId));
    return (row?.v ?? 0) + 1;
  },

  async insertVersion(db: DbOrTx, values: typeof ruleVersions.$inferInsert) {
    const [row] = await db.insert(ruleVersions).values(values).returning();
    return row!;
  },

  async copyRules(db: DbOrTx, fromVersionId: string, toVersionId: string) {
    const src = await RuleRepository.rulesOf(db, fromVersionId);
    if (src.length) {
      await db.insert(rules).values(src.map((r) => ({ ruleVersionId: toVersionId, category: r.category, code: r.code, title: r.title, config: r.config, sortOrder: r.sortOrder })));
    }
  },

  async rule(db: DbOrTx, ruleId: string) {
    const [row] = await db.select().from(rules).where(eq(rules.id, ruleId)).limit(1);
    return row;
  },

  async insertRule(db: DbOrTx, values: typeof rules.$inferInsert) {
    const [row] = await db.insert(rules).values(values).returning();
    return row!;
  },

  async updateRule(db: DbOrTx, ruleId: string, values: Partial<typeof rules.$inferInsert>) {
    const [row] = await db.update(rules).set(values).where(eq(rules.id, ruleId)).returning();
    return row!;
  },

  async deleteRule(db: DbOrTx, ruleId: string) {
    await db.delete(rules).where(eq(rules.id, ruleId));
  },

  async setVersionStatus(db: DbOrTx, versionId: string, status: "active" | "retired", effectiveFrom?: string) {
    await db.update(ruleVersions).set({ status, ...(effectiveFrom ? { effectiveFrom } : {}) }).where(eq(ruleVersions.id, versionId));
  },

  async deleteVersion(db: DbOrTx, versionId: string) {
    await db.delete(rules).where(eq(rules.ruleVersionId, versionId));
    await db.delete(ruleVersions).where(eq(ruleVersions.id, versionId));
  },

  async evaluation(db: DbOrTx, id: string) {
    const [row] = await db
      .select({ evaluation: ruleEvaluations, version: ruleVersions.version })
      .from(ruleEvaluations)
      .innerJoin(ruleVersions, eq(ruleVersions.id, ruleEvaluations.ruleVersionId))
      .where(eq(ruleEvaluations.id, id))
      .limit(1);
    return row;
  },

  /**
   * Recorded evaluations for one subject (e.g. an eligibility check on a coverage), newest first.
   * `organizationId` limits them to the tenant that ran them.
   */
  async evaluationsForSubject(db: DbOrTx, subjectType: string, subjectId: string, organizationId: string | undefined, limit: number) {
    return db
      .select({
        id: ruleEvaluations.id,
        evaluatedAt: ruleEvaluations.evaluatedAt,
        overall: ruleEvaluations.overallResult,
        inputSnapshot: ruleEvaluations.inputSnapshot,
        ruleVersion: ruleVersions.version,
        policyName: policies.name,
        hospitalName: organizations.name,
        checkedBy: users.fullName,
      })
      .from(ruleEvaluations)
      .innerJoin(ruleVersions, eq(ruleVersions.id, ruleEvaluations.ruleVersionId))
      .innerJoin(policies, eq(policies.id, ruleEvaluations.policyId))
      .innerJoin(organizations, eq(organizations.id, ruleEvaluations.organizationId))
      .leftJoin(users, eq(users.id, ruleEvaluations.actorUserId))
      .where(and(
        eq(ruleEvaluations.subjectType, subjectType),
        eq(ruleEvaluations.subjectId, subjectId),
        organizationId ? eq(ruleEvaluations.organizationId, organizationId) : undefined,
      ))
      .orderBy(desc(ruleEvaluations.evaluatedAt), desc(ruleEvaluations.id))
      .limit(limit);
  },

  /** The most recent evaluation of each subject, for lists (one query, no per-row lookups). */
  async latestForSubjects(db: DbOrTx, subjectType: string, subjectIds: string[], organizationId: string | undefined) {
    if (subjectIds.length === 0) return [];
    const rows = await db
      .select({ subjectId: ruleEvaluations.subjectId, id: ruleEvaluations.id, evaluatedAt: ruleEvaluations.evaluatedAt, overall: ruleEvaluations.overallResult })
      .from(ruleEvaluations)
      .where(and(
        eq(ruleEvaluations.subjectType, subjectType),
        inArray(ruleEvaluations.subjectId, subjectIds),
        organizationId ? eq(ruleEvaluations.organizationId, organizationId) : undefined,
      ))
      .orderBy(desc(ruleEvaluations.evaluatedAt), desc(ruleEvaluations.id));
    // Newest first, so the first row seen for each subject is its latest.
    const seen = new Set<string>();
    return rows.filter((r) => r.subjectId && !seen.has(r.subjectId) && seen.add(r.subjectId));
  },

  async insertEvaluation(db: DbOrTx, values: typeof ruleEvaluations.$inferInsert) {
    const [row] = await db.insert(ruleEvaluations).values(values).returning({ id: ruleEvaluations.id, evaluatedAt: ruleEvaluations.evaluatedAt });
    return row!;
  },
};
