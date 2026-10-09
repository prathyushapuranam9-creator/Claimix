import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const AAROGYA = "Aarogya Shield General Insurance (DEMO DATA)";
const NAVJEEVAN = "Navjeevan General Insurance (DEMO DATA)";
const FLOATER = "Aarogya Family Floater Plus (DEMO DATA)";
const SENIOR = "Aarogya Senior Citizen Care (DEMO DATA)";
const company = (page: Page) => page.getByLabel("Insurance Company");
const policy = (page: Page) => page.getByLabel("Policy", { exact: true });
const banner = (page: Page) => page.getByRole("status", { name: "Current testing context" });
const policyNames = async (page: Page) => (await page.locator("main table a[href^='/policies/']").allInnerTexts()).map((t) => t.split("\n")[0]!.trim());

test.describe("Dashboard: Insurance Company + Policy narrows the whole portal", () => {
  test("a reviewer picks one of its own policies: the portal shows only that policy; 'All policies' restores it", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await page.goto("/dashboard");
    await expect(company(page).locator("option:checked")).toHaveText(AAROGYA);
    const names = (await policy(page).locator("option").allInnerTexts()).filter((t) => !t.startsWith("All policies"));
    expect(names).toEqual(expect.arrayContaining([FLOATER, SENIOR]));
    expect(names.some((n) => /Navjeevan|Suraksha/.test(n))).toBe(false);
    await expect(page.locator("#policy-details")).toHaveCount(0); // the dropdown only selects; no details panel

    await policy(page).selectOption({ label: FLOATER });
    await expect(banner(page)).toContainText(FLOATER);
    await expect(policy(page).locator("option:checked")).toHaveText(FLOATER);

    // Across the portal: policies, pre-authorizations and claims follow the selection.
    await page.goto("/policies");
    await expect.poll(() => policyNames(page)).toEqual([FLOATER]);
    await page.goto("/pre-authorizations?view=all");
    await expect(banner(page)).toContainText(FLOATER);

    // Back on the dashboard, "All policies of this company" removes the narrowing.
    await page.goto("/dashboard");
    await policy(page).selectOption({ label: "All policies of this company" });
    await expect(banner(page)).not.toContainText(FLOATER);
    await page.goto("/policies");
    await expect.poll(async () => (await policyNames(page)).length).toBeGreaterThan(1);
  });

  test("an administrator: changing company applies at once and clears the policy; the policy list is that company's", async ({ page }) => {
    await signIn(page, "admin@demo.claimix.invalid");
    await page.goto("/dashboard");
    await expect(policy(page)).toBeDisabled(); // "All Insurers": pick a company first

    await company(page).selectOption({ label: NAVJEEVAN });
    await expect(banner(page)).toContainText(NAVJEEVAN); // no Switch Context click needed
    const names = (await policy(page).locator("option").allInnerTexts()).filter((t) => !t.startsWith("All policies"));
    expect(names).toContain("Navjeevan Super Top-Up 10L (DEMO DATA)");
    expect(names).not.toContain(FLOATER);
    await policy(page).selectOption({ label: "Navjeevan Super Top-Up 10L (DEMO DATA)" });
    await expect(banner(page)).toContainText("Navjeevan Super Top-Up 10L (DEMO DATA)");

    await company(page).selectOption({ label: AAROGYA });
    await expect(banner(page)).toContainText(AAROGYA);
    await expect(banner(page)).not.toContainText("Navjeevan Super Top-Up");
    await expect(policy(page).locator("option:checked")).toHaveText("All policies of this company");

    // Leaving the context brings back the administrator's own view.
    await page.getByRole("button", { name: "Exit testing context" }).click();
    await expect(banner(page)).toHaveCount(0);
  });
});
