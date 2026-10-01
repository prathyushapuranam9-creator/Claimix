import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ruleEvaluations, rules } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { PolicyService } from "@/modules/policies/policies.service";
import { RuleRepository } from "@/modules/rules/rules.repository";
import { evaluateAndRecord, RuleService } from "@/modules/rules/rules.service";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const Q = { page: 1, pageSize: 100 };

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

async function newPolicy(name = "Rules Test Policy") {
  return PolicyService.create(as("admin"), { category: "private", insurerId: DEMO.org.insurerA, name, productType: "individual" });
}
const ruleInput = (over: Record<string, unknown> = {}) => ({ category: "eligibility", kind: "age_range", code: "age", title: "Age 18-60", configJson: '{"minAge":18,"maxAge":60}', sortOrder: 0, ...over });

describe("rule versioning", () => {
  it("draft → publish → new draft copies rules → publish retires the old version", async () => {
    const p = await newPolicy();
    const d1 = await RuleService.createDraft(as("admin"), p.id);
    expect(await RuleService.createDraft(as("admin"), p.id)).toMatchObject({ id: d1.id }); // idempotent
    await RuleService.saveRule(as("admin"), d1.id, ruleInput());
    await RuleService.publish(as("admin"), d1.id, { effectiveFrom: "2026-10-01" });

    const d2 = await RuleService.createDraft(as("admin"), p.id);
    expect(d2.version).toBe(2);
    expect((await RuleRepository.rulesOf(ctx.db, d2.id)).map((r) => r.code)).toEqual(["age"]);
    await RuleService.saveRule(as("admin"), d2.id, ruleInput({ code: "active", kind: "cover_active", title: "Active", configJson: "{}" }));
    await RuleService.publish(as("admin"), d2.id, { effectiveFrom: "2026-11-01" });

    const o = await RuleService.overview(as("admin"), p.id);
    expect(o.versions.map((v) => [v.version, v.status])).toEqual([[2, "active"], [1, "retired"]]);
    expect(o.active?.rules).toHaveLength(2);
  });

  it("published versions can't be edited through the service", async () => {
    const p = await newPolicy();
    const d = await RuleService.createDraft(as("admin"), p.id);
    const r = await RuleService.saveRule(as("admin"), d.id, ruleInput());
    await RuleService.publish(as("admin"), d.id, { effectiveFrom: "2026-10-01" });
    await expect(RuleService.saveRule(as("admin"), d.id, ruleInput({ code: "another_rule" }))).rejects.toBeInstanceOf(ConflictError);
    await expect(RuleService.deleteRule(as("admin"), r.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(RuleService.discardDraft(as("admin"), d.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("the database itself refuses to change rules of a published version", async () => {
    const p = await newPolicy();
    const d = await RuleService.createDraft(as("admin"), p.id);
    const r = await RuleService.saveRule(as("admin"), d.id, ruleInput());
    await RuleService.publish(as("admin"), d.id, { effectiveFrom: "2026-10-01" });
    await expect(ctx.db.update(rules).set({ config: { kind: "age_range", maxAge: 99 } }).where(eq(rules.id, r.id))).rejects.toThrow();
    await expect(ctx.db.delete(rules).where(eq(rules.id, r.id))).rejects.toThrow();
    await expect(ctx.db.insert(rules).values({ ruleVersionId: d.id, category: "limit", code: "sneaky", title: "x", config: { kind: "sum_insured" } })).rejects.toThrow();
    // No going back from active to draft.
    await expect(ctx.db.execute(sql`update rule_versions set status = 'draft' where id = ${d.id}`)).rejects.toThrow();
  });

  it("validates rule settings, kind/category fit and code uniqueness", async () => {
    const p = await newPolicy();
    const d = await RuleService.createDraft(as("admin"), p.id);
    const expectField = async (input: Record<string, unknown>, field: string) => {
      const err = await RuleService.saveRule(as("admin"), d.id, ruleInput(input)).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(Object.keys((err as ValidationError).fieldErrors)).toContain(field);
    };
    await expectField({ configJson: "{not json" }, "configJson");
    await expectField({ configJson: '{"minAge":"eighteen"}' }, "configJson");
    await expectField({ configJson: '{"minAge":18,"hack":true}' }, "configJson");
    await expectField({ kind: "no_such_kind" }, "configJson");
    await expectField({ category: "limit" }, "category"); // age_range isn't a limit rule
    await RuleService.saveRule(as("admin"), d.id, ruleInput());
    await expectField({}, "code"); // duplicate code
  });

  it("refuses to publish an empty draft", async () => {
    const p = await newPolicy();
    const d = await RuleService.createDraft(as("admin"), p.id);
    await expect(RuleService.publish(as("admin"), d.id, { effectiveFrom: "2026-10-01" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("only policy managers can change rules", async () => {
    const p = await newPolicy();
    for (const k of ["staffA", "insurerA", "tpaA", "readOnly", "patientA1"] as const) {
      await expect(RuleService.createDraft(as(k), p.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("evaluations are recorded and immutable", () => {
  it("records policy, version, results, missing info and input snapshot; unpublished policy → NEEDS_VERIFICATION", async () => {
    const p = await newPolicy();
    const none = await evaluateAndRecord(ctx.db, as("staffA"), { policyId: p.id, subjectType: "eligibility_check", facts: { stage: "eligibility", asOf: "2026-09-30" } });
    expect(none.evaluation.overall).toBe("NEEDS_VERIFICATION");
    expect(none.evaluationId).toBeNull();

    const d = await RuleService.createDraft(as("admin"), p.id);
    await RuleService.saveRule(as("admin"), d.id, ruleInput());
    await RuleService.publish(as("admin"), d.id, { effectiveFrom: "2026-10-01" });
    const facts = { stage: "eligibility" as const, asOf: "2026-09-30", patient: { dob: "1990-01-01" }, admissionDate: "2026-10-05" };
    const res = await evaluateAndRecord(ctx.db, as("staffA"), { policyId: p.id, subjectType: "eligibility_check", facts });
    // Only an age rule exists, so the other required categories need verification.
    expect(res.evaluation.overall).toBe("NEEDS_VERIFICATION");
    expect(res.ruleVersion).toBe(1);

    const [row] = await ctx.db.select().from(ruleEvaluations).where(eq(ruleEvaluations.id, res.evaluationId!));
    expect(row).toMatchObject({ policyId: p.id, ruleVersionId: d.id, organizationId: DEMO.org.hospitalA, actorUserId: who.staffA.userId, overallResult: "NEEDS_VERIFICATION" });
    expect(row!.inputSnapshot).toEqual(facts);
    expect(row!.missingInformation.length).toBeGreaterThan(0);
    await expect(ctx.db.execute(sql`update rule_evaluations set overall_result = 'PASS' where id = ${res.evaluationId}`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`delete from rule_evaluations where id = ${res.evaluationId}`)).rejects.toThrow();
  });
});

describe("policy visibility and validation", () => {
  it("insurer reviewers see only their own insurer's policies", async () => {
    const a = await PolicyService.list(as("insurerA"), Q, {});
    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.rows.map((r) => r.id)).not.toContain(DEMO.policy.surakshaIndividual);
    await expect(PolicyService.get(as("insurerA"), DEMO.policy.surakshaIndividual)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PolicyService.get(as("insurerB"), DEMO.policy.surakshaIndividual)).resolves.toBeTruthy();
  });

  it("patients see only the policies they're covered by", async () => {
    const r = await PolicyService.list(as("patientA1"), Q, {});
    // (The test DB also has an isolation fixture policy covering this patient.)
    expect(r.rows.map((x) => x.id)).toContain(DEMO.policy.aarogyaFloater);
    expect(r.rows.map((x) => x.id)).not.toContain(DEMO.policy.surakshaIndividual);
    expect(r.rows.map((x) => x.id)).not.toContain(DEMO.policy.pmjayScheme);
    await expect(PolicyService.get(as("patientA1"), DEMO.policy.surakshaIndividual)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hospital staff and read-only users can browse all products", async () => {
    for (const k of ["staffA", "readOnly"] as const) {
      // Search the seeded demo products (test runs add many more policies).
      const r = await PolicyService.list(as(k), { ...Q, q: "DEMO DATA" }, {});
      expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining([DEMO.policy.aarogyaFloater, DEMO.policy.surakshaIndividual, DEMO.policy.pmjayScheme]));
    }
  });

  it("private insurance and government schemes can't be mixed", async () => {
    await expect(PolicyService.create(as("admin"), { category: "private", name: "No Insurer Policy", productType: "individual" })).rejects.toBeInstanceOf(ValidationError);
    await expect(PolicyService.create(as("admin"), { category: "government", schemeId: DEMO.scheme.pmjay, insurerId: DEMO.org.insurerA, name: "Mixed Cover", productType: "central_scheme" })).rejects.toBeInstanceOf(ValidationError);
    await expect(PolicyService.create(as("admin"), { category: "private", insurerId: DEMO.org.insurerA, name: "Wrong Type Policy", productType: "central_scheme" })).rejects.toBeInstanceOf(ValidationError);
    const p = await newPolicy("Category Lock Policy");
    await expect(PolicyService.update(as("admin"), p.id, { category: "government", schemeId: DEMO.scheme.pmjay, name: "Category Lock Policy", productType: "central_scheme" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("each seeded policy has its own active rule version (rules are never shared)", async () => {
    const floater = await RuleRepository.active(ctx.db, DEMO.policy.aarogyaFloater);
    const suraksha = await RuleRepository.active(ctx.db, DEMO.policy.surakshaIndividual);
    expect(floater?.ruleSet.id).not.toBe(suraksha?.ruleSet.id);
    const ids = new Set(floater!.rules.map((r) => r.id));
    expect(suraksha!.rules.some((r) => ids.has(r.id))).toBe(false);
  });
});
