import { expect, test, type Page } from "@playwright/test";
import { openMenuIfCollapsed, signIn } from "./helpers";

const AAROGYA = "Aarogya Shield General Insurance (DEMO DATA)";
const back = (page: Page) => page.getByRole("button", { name: "Back" });
const table = (page: Page) => page.getByRole("table", { name: "Insurance companies" });
const row = (page: Page) => table(page).getByRole("row").filter({ hasText: AAROGYA });

async function openInsurers(page: Page) {
  await openMenuIfCollapsed(page);
  await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Insurance companies", exact: true }).click();
  await page.waitForURL(/\/insurers$/);
}

test.describe("Insurance companies", () => {
  test("directory: search, pills open the insurer's policies and network hospitals, Back returns", async ({ page }) => {
    await signIn(page, "admin@demo.claimix.invalid");
    await openInsurers(page);
    const search = page.getByRole("search");
    await expect(search.locator("svg").first()).toBeVisible();
    await search.getByLabel("Search by name or code").fill("Aarogya");
    await search.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/q=Aarogya/);
    await expect(table(page).locator("tbody tr")).toHaveCount(1);
    await expect(row(page)).toContainText("Active");

    // Policies pill → that insurer's policies (count matches).
    const pol = row(page).getByRole("link", { name: /polic(y|ies) of Aarogya/ });
    const policyCount = Number(await pol.innerText());
    await pol.click();
    await page.waitForURL(/\/policies\?insurer=/);
    await expect(page.locator("main")).toContainText(`Showing policies of ${AAROGYA}`);
    await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText(`of ${policyCount}`);
    const payers = await page.locator("main table tbody tr td:nth-child(2)").allInnerTexts();
    expect(payers.every((p) => p.includes("Aarogya"))).toBe(true);
    await back(page).click();
    await expect(page).toHaveURL(/\/insurers\?.*q=Aarogya/);

    // Network hospitals pill → hospitals filtered to that insurer.
    const net = row(page).getByRole("link", { name: /network hospitals? of Aarogya/ });
    const netCount = Number(await net.innerText());
    await net.click();
    await page.waitForURL(/\/hospitals\?insurer=/);
    await expect(page.getByRole("search").getByLabel("Insurer network").locator("option:checked")).toHaveText(AAROGYA);
    if (netCount > 0) await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText(`of ${netCount}`);
    await back(page).click();
    await expect(page).toHaveURL(/\/insurers\?.*q=Aarogya/);

    // Clear restores the full directory.
    await page.getByRole("search").getByRole("link", { name: "Clear" }).click();
    await page.waitForURL(/\/insurers$/);
    await expect(page.getByRole("search").getByLabel("Search by name or code")).toHaveValue("");
  });

  test("detail: initials, contact links, real summary, quick navigation and Back", async ({ page }) => {
    await signIn(page, "admin@demo.claimix.invalid");
    await openInsurers(page);
    await table(page).getByRole("link", { name: AAROGYA, exact: true }).click();
    await page.waitForURL(/\/insurers\/[0-9a-f-]{36}$/);
    const detail = page.url();
    await expect(page.locator("main").getByText("AS", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(AAROGYA);

    const contact = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Contact" }) });
    for (const l of ["Claims helpline", "Email", "Website"]) await expect(contact.getByText(l, { exact: true })).toBeVisible();
    await expect(contact.getByRole("link", { name: /@/ })).toHaveAttribute("href", /^mailto:/);

    const summary = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Summary" }) });
    for (const l of ["Policies", "Active policies", "Network hospitals", "Pre-authorizations", "Claims"]) await expect(summary.getByText(l, { exact: true })).toBeVisible();

    const quick = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Quick navigation" }) });
    for (const [name, url] of [
      ["View network hospitals", /\/hospitals\?insurer=/],
      ["Associated policies", /\/policies\?insurer=/],
      ["Claims", /\/claims\?view=all&insurer=/],
    ] as const) {
      await quick.getByRole("link", { name }).click();
      await page.waitForURL(url);
      await back(page).click();
      await expect(page).toHaveURL(detail);
    }
    // Back from the detail returns to the directory.
    await back(page).click();
    await expect(page).toHaveURL(/\/insurers$/);
  });
});
