import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { NotFoundError } from "@/lib/errors";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { PolicyService } from "@/modules/policies/policies.service";
import { RuleService } from "@/modules/rules/rules.service";
import { demoPrincipals, svc, testContext } from "./helpers";

/** Policy visibility at the service layer: what a direct call (or a crafted URL) can reach, whatever the role grant says. */
const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const Q = { page: 1, pageSize: 200 };
const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

/** The same principal, but with a role grant of "all" on policy:read (a stale or merged role matrix). */
const withPolicyAll = (p: Principal): Principal => ({ ...p, permissions: new Map(p.permissions).set("policy:read", "all" as Scope) });

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

describe("payer policy isolation", () => {
  it("the default payer role no longer holds policy:read at 'all'", () => {
    for (const k of ["insurerA", "insurerB", "tpaA"] as const) expect(who[k].permissions.get("policy:read")).toBe("organization");
  });

  it("each insurer lists, opens and reads rules of only its own policies", async () => {
    const a = idsOf((await PolicyService.list(as("insurerA"), Q, {})).rows);
    const b = idsOf((await PolicyService.list(as("insurerB"), Q, {})).rows);
    expect(a).toContain(DEMO.policy.aarogyaFloater);
    expect(a).not.toContain(DEMO.policy.surakshaIndividual);
    expect(b).toContain(DEMO.policy.surakshaIndividual);
    expect(b).not.toContain(DEMO.policy.aarogyaFloater);

    await expect(PolicyService.get(as("insurerA"), DEMO.policy.surakshaIndividual)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PolicyService.get(as("insurerB"), DEMO.policy.aarogyaFloater)).rejects.toBeInstanceOf(NotFoundError);
    await expect(RuleService.overview(as("insurerA"), DEMO.policy.surakshaIndividual)).rejects.toBeInstanceOf(NotFoundError);
    await expect(PolicyService.get(as("insurerA"), DEMO.policy.aarogyaFloater)).resolves.toBeTruthy();
    await expect(PolicyService.get(as("insurerB"), DEMO.policy.surakshaIndividual)).resolves.toBeTruthy();
  });

  it("policy pickers don't expose another insurer's products either", async () => {
    const opts = idsOf(await PolicyService.options(as("insurerA")));
    expect(opts).not.toContain(DEMO.policy.surakshaIndividual);
    expect(idsOf(await PolicyService.options(as("insurerB")))).not.toContain(DEMO.policy.aarogyaFloater);
  });

  it("a TPA sees only the products it administers", async () => {
    const t = idsOf((await PolicyService.list(as("tpaA"), Q, {})).rows);
    expect(t).toContain(DEMO.policy.aarogyaFloater);
    expect(t).not.toContain(DEMO.policy.surakshaIndividual);
    await expect(PolicyService.get(as("tpaA"), DEMO.policy.surakshaIndividual)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the restriction holds even if a payer's role grant says 'all' (enforced in the service layer, not only the catalog)", async () => {
    for (const k of ["insurerA", "tpaA"] as const) {
      const c = svc(ctx.db, withPolicyAll(who[k]));
      expect(idsOf((await PolicyService.list(c, Q, {})).rows)).not.toContain(DEMO.policy.surakshaIndividual);
      await expect(PolicyService.get(c, DEMO.policy.surakshaIndividual)).rejects.toBeInstanceOf(NotFoundError);
      expect(idsOf(await PolicyService.options(c))).not.toContain(DEMO.policy.surakshaIndividual);
    }
  });
});

describe("policy browsing that must keep working", () => {
  it("hospital staff, read-only users and administrators still see all products", async () => {
    for (const k of ["staffA", "readOnly", "admin"] as const) {
      const r = await PolicyService.list(as(k), { ...Q, q: "DEMO DATA" }, {});
      expect(idsOf(r.rows)).toEqual(expect.arrayContaining([DEMO.policy.aarogyaFloater, DEMO.policy.surakshaIndividual, DEMO.policy.pmjayScheme]));
      await expect(PolicyService.get(as(k), DEMO.policy.surakshaIndividual)).resolves.toBeTruthy();
    }
  });
});
