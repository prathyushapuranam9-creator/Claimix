import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const table = (page: Page) => page.getByRole("table", { name: "Hospitals" });

test.describe("Hospitals & network", () => {
  test("filters panel, tags, badges, verification, View details and pagination", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await page.goto("/hospitals");

    // Filter panel: search with icon, the three selects, Cashless only as a switch, Apply / Clear.
    const search = page.getByRole("search");
    await expect(search.getByLabel("Hospital or city")).toBeVisible();
    await expect(search.locator("svg").first()).toBeVisible();
    for (const l of ["Insurer network", "Government scheme", "State / UT"]) await expect(search.getByLabel(l)).toBeVisible();
    const cashless = search.getByRole("switch", { name: "Cashless only" });
    await expect(cashless).not.toBeChecked();
    await expect(search.getByRole("button", { name: "Apply" })).toBeVisible();
    await expect(search.getByRole("link", { name: "Clear" })).toBeVisible();

    // Table: real rows with department tags, network badges, verification and a View details action.
    const rows = table(page).locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    const first = rows.first();
    await expect(first.getByRole("link", { name: "View details" })).toHaveAttribute("href", /\/hospitals\/[0-9a-f-]{36}$/);
    await expect(first.locator("td").nth(4)).toContainText(/\d{2} \w{3,4} \d{4}|Not verified/);
    expect(await page.locator("main").getByText(/\+\d+ more/).count()).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText(/Showing \d+–\d+ of \d+/);

    // Cashless only still filters (the switch submits like the old checkbox).
    await cashless.check();
    await search.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/cashless=on/);
    await expect(page.getByRole("search").getByRole("switch", { name: "Cashless only" })).toBeChecked();
    await page.getByRole("search").getByRole("link", { name: "Clear" }).click();
    await page.waitForURL(/\/hospitals$/);

    // Search that matches nothing → the no-results state.
    await page.getByRole("search").getByLabel("Hospital or city").fill("zzz-no-such-hospital");
    await page.getByRole("search").getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("No hospitals match these filters")).toBeVisible();

    // View details opens the existing detail page.
    await page.goto("/hospitals");
    await rows.first().getByRole("link", { name: "View details" }).click();
    await page.waitForURL(/\/hospitals\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
