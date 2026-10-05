import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { InsurerRepository } from "@/modules/insurers/insurers.repository";
import { RuleRepository } from "@/modules/rules/rules.repository";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { TpaRepository } from "@/modules/tpas/tpas.repository";
import { PolicyRepository, type PolicyFilters } from "./policies.repository";
import { pickInfo, policyInputSchema } from "./policies.validation";

const money = (n: number | undefined) => (n === undefined ? null : n.toFixed(2));

export const PolicyService = {
  async list(ctx: ServiceContext, q: ListQuery, f: PolicyFilters) {
    const scope = requirePermission(ctx.principal, "policy:read");
    return PolicyRepository.list(ctx.db, ctx.principal, scope, q, f);
  },

  /** Policy with its active rules and packages; audited as a view. */
  async get(ctx: ServiceContext, id: string) {
    const scope = requirePermission(ctx.principal, "policy:read");
    const row = await PolicyRepository.findScoped(ctx.db, ctx.principal, scope, requireId(id, "Policy"));
    if (!row) throw new NotFoundError("Policy not found.");
    const [active, pkgs] = await Promise.all([RuleRepository.active(ctx.db, id), PolicyRepository.packages(ctx.db, id)]);
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "policy.viewed", resourceType: "policy", resourceId: id });
    return { ...row, active, packages: pkgs };
  },

  async options(ctx: ServiceContext, category?: "private" | "government") {
    const scope = requirePermission(ctx.principal, "policy:read");
    return PolicyRepository.options(ctx.db, category, { principal: ctx.principal, scope });
  },

  async create(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "policy:manage");
    const d = parseOrThrow(policyInputSchema, input);
    await assertPayers(ctx, d);
    return ctx.db.transaction(async (tx) => {
      const row = await PolicyRepository.insert(tx, {
        category: d.category,
        insurerId: d.insurerId ?? null,
        tpaId: d.tpaId ?? null,
        schemeId: d.schemeId ?? null,
        name: d.name,
        productType: d.productType,
        sumInsuredMin: money(d.sumInsuredMin),
        sumInsuredMax: money(d.sumInsuredMax),
        summary: d.summary ?? null,
        info: pickInfo(d),
      });
      await RuleRepository.ensureRuleSet(tx, row.id);
      await AuditService.record(tx, { ...actorOf(ctx), action: "policy.created", resourceType: "policy", resourceId: row.id, newState: { name: row.name, category: row.category, insurerId: row.insurerId, schemeId: row.schemeId } });
      return row;
    });
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    requirePermission(ctx.principal, "policy:manage");
    const d = parseOrThrow(policyInputSchema, input);
    await assertPayers(ctx, d);
    return ctx.db.transaction(async (tx) => {
      const before = await PolicyRepository.get(tx, requireId(id, "Policy"));
      if (!before) throw new NotFoundError("Policy not found.");
      if (before.category !== d.category) {
        throw new ValidationError("A policy can't switch between private insurance and government scheme. Create a new one.", { category: ["Category can't be changed."] });
      }
      const row = await PolicyRepository.update(tx, id, {
        insurerId: d.insurerId ?? null,
        tpaId: d.tpaId ?? null,
        schemeId: d.schemeId ?? null,
        name: d.name,
        productType: d.productType,
        sumInsuredMin: money(d.sumInsuredMin),
        sumInsuredMax: money(d.sumInsuredMax),
        summary: d.summary ?? null,
        info: pickInfo(d),
      });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "policy.updated",
        resourceType: "policy",
        resourceId: id,
        previousState: { name: before.name, productType: before.productType, insurerId: before.insurerId, tpaId: before.tpaId, sumInsuredMin: before.sumInsuredMin, sumInsuredMax: before.sumInsuredMax },
        newState: { name: row.name, productType: row.productType, insurerId: row.insurerId, tpaId: row.tpaId, sumInsuredMin: row.sumInsuredMin, sumInsuredMax: row.sumInsuredMax },
      });
      return row;
    });
  },
};

async function assertPayers(ctx: ServiceContext, d: { insurerId?: string; tpaId?: string; schemeId?: string }) {
  if (d.insurerId && !(await InsurerRepository.exists(ctx.db, d.insurerId))) throw new ValidationError("Select a valid insurer.", { insurerId: ["Select a valid insurer."] });
  if (d.tpaId && !(await TpaRepository.exists(ctx.db, d.tpaId))) throw new ValidationError("Select a valid TPA.", { tpaId: ["Select a valid TPA."] });
  if (d.schemeId && !(await SchemeRepository.exists(ctx.db, d.schemeId))) throw new ValidationError("Select a valid scheme.", { schemeId: ["Select a valid scheme."] });
}
