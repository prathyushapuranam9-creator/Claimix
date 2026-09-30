import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { InsurerRepository } from "@/modules/insurers/insurers.repository";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { SchemeRepository } from "@/modules/schemes/schemes.repository";
import { TpaRepository } from "@/modules/tpas/tpas.repository";
import { HospitalRepository, type HospitalFilters } from "./hospitals.repository";
import { hospitalInputSchema, networkInputSchema, splitDepartments } from "./hospitals.validation";

export const HospitalService = {
  async list(ctx: ServiceContext, q: ListQuery, filters: HospitalFilters) {
    requirePermission(ctx.principal, "hospital:read");
    return HospitalRepository.list(ctx.db, q, filters);
  },

  async get(ctx: ServiceContext, id: string) {
    requirePermission(ctx.principal, "hospital:read");
    requireId(id, "Hospital");
    const [row, networks] = await Promise.all([HospitalRepository.get(ctx.db, id), HospitalRepository.networks(ctx.db, id)]);
    if (!row) throw new NotFoundError("Hospital not found.");
    return { ...row, networks };
  },

  async states(ctx: ServiceContext) {
    requirePermission(ctx.principal, "hospital:read");
    return HospitalRepository.distinctStates(ctx.db);
  },

  async create(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "hospital:manage");
    const d = parseOrThrow(hospitalInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const org = await OrganizationRepository.insert(tx, "hospital", d.name);
      const row = await HospitalRepository.insert(tx, {
        id: org.id,
        registrationNo: d.registrationNo ?? null,
        city: d.city,
        state: d.state,
        address: d.address ?? null,
        departments: splitDepartments(d.departments),
        phone: d.phone ?? null,
        email: d.email ?? null,
      });
      await AuditService.record(tx, { ...actorOf(ctx), action: "hospital.created", resourceType: "hospital", resourceId: org.id, newState: { name: d.name, city: d.city, state: d.state } });
      return row;
    });
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    requirePermission(ctx.principal, "hospital:manage");
    const d = parseOrThrow(hospitalInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const before = await HospitalRepository.get(tx, requireId(id, "Hospital"));
      if (!before) throw new NotFoundError("Hospital not found.");
      await OrganizationRepository.rename(tx, id, d.name);
      const row = await HospitalRepository.update(tx, id, {
        registrationNo: d.registrationNo ?? null,
        city: d.city,
        state: d.state,
        address: d.address ?? null,
        departments: splitDepartments(d.departments),
        phone: d.phone ?? null,
        email: d.email ?? null,
      });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "hospital.updated",
        resourceType: "hospital",
        resourceId: id,
        previousState: { name: before.name, city: before.hospital.city, state: before.hospital.state, departments: before.hospital.departments },
        newState: { name: d.name, city: row.city, state: row.state, departments: row.departments },
      });
      return row;
    });
  },

  /** Records a network / empanelment status for one payer, stamping the verification time. */
  async setNetwork(ctx: ServiceContext, hospitalId: string, input: unknown) {
    requirePermission(ctx.principal, "hospital:manage");
    const d = parseOrThrow(networkInputSchema, input);

    // Status must fit the payer kind: schemes empanel, private payers network.
    if (d.payerType === "scheme" && d.status === "network") {
      throw new ValidationError("Government schemes use 'Empanelled', not 'Network'.", { status: ["Choose Empanelled for a scheme."] });
    }
    if (d.payerType !== "scheme" && d.status === "empanelled") {
      throw new ValidationError("'Empanelled' applies to government schemes only.", { status: ["Choose Network for an insurer or TPA."] });
    }
    const payerOk =
      d.payerType === "insurer" ? await InsurerRepository.exists(ctx.db, d.payerId)
      : d.payerType === "tpa" ? await TpaRepository.exists(ctx.db, d.payerId)
      : await SchemeRepository.exists(ctx.db, d.payerId);
    if (!payerOk) throw new ValidationError("Select a valid payer.", { payerId: ["Select a valid payer."] });

    const payer = { [`${d.payerType === "scheme" ? "scheme" : d.payerType}Id`]: d.payerId } as { insurerId?: string; tpaId?: string; schemeId?: string };
    return ctx.db.transaction(async (tx) => {
      if (!(await HospitalRepository.exists(tx, requireId(hospitalId, "Hospital")))) throw new NotFoundError("Hospital not found.");
      const existing = await HospitalRepository.findNetwork(tx, hospitalId, payer);
      const row = await HospitalRepository.upsertNetwork(
        tx,
        { hospitalId, ...payer, status: d.status, cashlessAvailable: d.status === "network" || d.status === "empanelled" ? d.cashlessAvailable : false, lastVerifiedAt: new Date() },
        existing?.id,
      );
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "hospital.network_updated",
        resourceType: "hospital",
        resourceId: hospitalId,
        previousState: existing ? { ...payer, status: existing.status, cashlessAvailable: existing.cashlessAvailable } : null,
        newState: { ...payer, status: row.status, cashlessAvailable: row.cashlessAvailable },
      });
      return row;
    });
  },
};
