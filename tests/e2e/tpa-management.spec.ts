import { expect, test, type Page } from "@playwright/test";
import { DEMO } from "../fixtures/seed/ids";
import { openMenuIfCollapsed, signIn } from "./helpers";

const MEDIASSIST = "MediAssist Claims Services (DEMO DATA)";
const table = (page: Page) => page.getByRole("table", { name: "TPAs" });

async function openTpas(page: Page) {
  await openMenuIfCollapsed(page);
  await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "TPAs", exact: true }).click();
  await page.waitForURL(/\/tpas$/);
}

test.describe("Insurer Reviewer: TPA management", () => {
  test("list → search (Apply / Clear) → details with policies and cases → Back to the list", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await openTpas(page);
    for (const h of ["TPA", "Code", "Phone", "Policies serviced", "Status"]) await expect(table(page).getByRole("columnheader", { name: h })).toBeVisible();
    await expect(table(page).getByRole("row").filter({ hasText: MEDIASSIST })).toContainText("DEMO-MACS");
    await expect(table(page).getByRole("row").filter({ hasText: MEDIASSIST })).toContainText("Active");

    // Search by code, then by name; Clear resets.
    await page.getByRole("searchbox").fill("DEMO-MACS");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/\/tpas\?.*q=DEMO-MACS/);
    await expect(table(page).locator("tbody tr")).toHaveCount(1);
    await page.getByRole("searchbox").fill("no-such-tpa-xyz");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("No TPAs match your search")).toBeVisible();
    await page.getByRole("link", { name: "Clear" }).click();
    await page.waitForURL(/\/tpas$/);
    await expect(table(page).getByRole("row").filter({ hasText: "CareLink" })).toHaveCount(1);

    // Details.
    await page.getByRole("searchbox").fill("MediAssist");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/q=MediAssist/);
    await table(page).getByRole("link", { name: MEDIASSIST }).click();
    await page.waitForURL(new RegExp(`/tpas/${DEMO.org.tpaA}$`));
    const details = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Details", exact: true }) });
    for (const [label, value] of [["Name", MEDIASSIST], ["Code", "DEMO-MACS"], ["Status", "Active"], ["Phone", "1800-000-0101"]] as const) {
      await expect(details.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]")).toHaveText(value);
    }
    await expect(details.getByText("Email", { exact: true })).toBeVisible();

    // Linked policies: Aarogya's own products run by MediAssist; nothing from other insurers.
    const policiesTable = page.getByRole("table", { name: "Policies serviced by this TPA" });
    await expect(policiesTable).toContainText("Aarogya Family Floater Plus (DEMO DATA)");
    await expect(policiesTable).not.toContainText("Navjeevan");
    await expect(policiesTable).not.toContainText("Suraksha");
    // Cases sections exist with their own empty state or rows, and link to the filtered lists.
    await expect(page.getByRole("heading", { name: /^Pre-authorizations handled by this TPA \(\d+\)$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Claims handled by this TPA \(\d+\)$/ })).toBeVisible();

    // Back returns to the list with the search kept.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/tpas\?.*q=MediAssist/);
  });

  test("another insurer sees the same TPA without Aarogya's products; unknown TPA is a 404", async ({ page }) => {
    await signIn(page, "insurer.b@demo.claimix.invalid");
    await openTpas(page);
    await expect(table(page).getByRole("row").filter({ hasText: MEDIASSIST }).locator("td").nth(3)).toHaveText("0");
    await page.goto(`/tpas/${DEMO.org.tpaA}`);
    await expect(page.getByText("No policies are linked to this TPA")).toBeVisible();
    const card = page.locator("main section").filter({ has: page.getByRole("heading", { name: /^Policies serviced/ }) });
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("Policies serviced (0)");
    await expect(card).not.toContainText("Aarogya");
    const res = await page.goto("/tpas/00000000-0000-4000-8000-00000000dead");
    expect(res?.status()).toBe(404);
  });
});
