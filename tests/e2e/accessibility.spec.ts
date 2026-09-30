import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { IDS, signIn } from "./helpers";

/** Serious/critical WCAG 2.x A/AA violations on a page, as readable lines. */
async function violationsOn(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${path} — ${v.id}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} ${n.any[0]?.message ?? ""}`).join(" | ")}`);
}

/** Audits every path, then fails once with the full list, so one run shows every problem. */
async function auditAll(page: Page, paths: string[]) {
  const found: string[] = [];
  for (const path of paths) found.push(...(await violationsOn(page, path)));
  expect(found, found.join("\n")).toEqual([]);
}

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  test("public pages", async ({ page }) => {
    await auditAll(page, ["/", "/about", "/insurance/private", "/insurance/government", "/cashless-vs-reimbursement", "/knowledge", "/knowledge/how-cashless-works", "/glossary", "/network", "/login", "/register", "/forgot-password"]);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`hospital staff workspace (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page, "staff.a@demo.claimix.invalid");
      await auditAll(page, ["/dashboard", "/patients", `/patients/${IDS.patientA1}`, "/eligibility", "/pre-authorizations", "/claims", "/documents", "/assistant", "/notifications", "/reports", "/hospitals"]);
    });
  }

  test("payer and admin workspaces", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await auditAll(page, ["/dashboard", "/pre-authorizations", "/claims", "/reports"]);
    await page.context().clearCookies();
    await signIn(page, "admin@demo.claimix.invalid");
    await auditAll(page, ["/dashboard", "/admin/users", "/admin/access-requests", "/audit", "/policies", "/rejection-reasons"]);
  });
});
