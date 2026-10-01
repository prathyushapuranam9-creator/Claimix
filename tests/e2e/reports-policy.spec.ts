import { expect, test, type Page } from "@playwright/test";
import { IDS, signIn } from "./helpers";

/** Marks the current document; if a click caused a page load the marker is gone. */
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
const samePage = (page: Page) => page.evaluate(() => (window as unknown as { __same?: boolean }).__same === true);

test.describe("Reports: Cases and TAT distribution views", () => {
  test("buttons switch the view in place; the cases count is real and sorting works", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/reports?range=all");
    const tabs = page.getByRole("tablist", { name: "Report views" });
    await expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

    await mark(page);
    await tabs.getByRole("tab", { name: "Cases" }).click();
    await expect(tabs.getByRole("tab", { name: "Cases" })).toHaveAttribute("aria-selected", "true");
    expect(await samePage(page)).toBe(true); // no navigation
    await expect(page).toHaveURL(/\/reports\?.*tab=cases/);

    const heading = page.getByRole("heading", { name: /\d+ cases?/i });
    await expect(heading).toBeVisible();
    const total = Number((await heading.textContent())!.replace(/[^\d]/g, ""));
    expect(total).toBeGreaterThan(0);
    const table = page.getByRole("region", { name: "Cases" }).getByRole("table");
    for (const h of ["Case no", "Patient", "Insurer", "Dept", "Billed", "Approved", "Received", "Shortfall", "TAT (d)", "Risk", "Status"]) {
      await expect(table.getByRole("columnheader", { name: new RegExp(`^${h.replace(/[()]/g, "\\$&")}`) })).toBeVisible();
    }
    await expect(table.locator("tbody tr").first()).toContainText("₹");

    // Sort by billed ascending: values read in ascending numeric order; still on the Cases view.
    await table.getByRole("link", { name: /^Billed/ }).click();
    await expect(page).toHaveURL(/sort=billed/);
    if (!/dir=asc/.test(page.url())) await page.getByRole("region", { name: "Cases" }).getByRole("link", { name: /^Billed/ }).click();
    await expect(page).toHaveURL(/sort=billed.*dir=asc|dir=asc.*sort=billed/);
    await expect(page.getByRole("tab", { name: "Cases" })).toHaveAttribute("aria-selected", "true");
    const billed = await page.getByRole("region", { name: "Cases" }).locator("tbody tr td:nth-child(5)").allTextContents();
    const values = billed.map((t) => Number(t.replace(/[^\d]/g, "") || 0));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    await expect(page.getByRole("columnheader", { name: /^Billed/ })).toHaveAttribute("aria-sort", "ascending");
  });

  test("TAT distribution shows the six buckets with real counts and bars", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/reports?range=all");
    await mark(page);
    await page.getByRole("tab", { name: "TAT distribution" }).click();
    expect(await samePage(page)).toBe(true);
    const region = page.getByRole("region", { name: "Turnaround time distribution" });
    for (const b of ["0–15 days", "16–30 days", "31–45 days", "46–60 days", "61–90 days", "90+ days"]) await expect(region.getByRole("rowheader", { name: b })).toBeVisible();
    const counts = (await region.locator("tbody tr td:nth-child(2)").allTextContents()).map((t) => Number(t.replace(/[^\d]/g, "")));
    const sum = counts.reduce((a, b) => a + b, 0);
    await expect(page.getByText(new RegExp(`${sum} submitted cases?`))).toBeVisible();
    // The bar chart above the table shows the same real count for each bucket.
    const chart = page.locator("figure", { hasText: "Number of submitted cases in each turnaround-time bucket" });
    const bars = chart.getByRole("listitem");
    await expect(bars).toHaveCount(6);
    for (let i = 0; i < 6; i++) await expect(bars.nth(i)).toContainText(String(counts[i]));
    // Buckets with 0 cases draw no bar; non-empty ones do.
    for (let i = 0; i < 6; i++) await expect(bars.nth(i).locator("[class*=bar3d]")).toHaveCount(counts[i]! > 0 ? 1 : 0);
  });

  test("an empty period shows empty states, not sample values", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/reports?range=custom&from=1990-01-01&to=1990-12-31&tab=cases");
    await expect(page.getByRole("heading", { name: /^0 cases$/i })).toBeVisible();
    await expect(page.getByText("No cases available")).toBeVisible();
    await page.getByRole("tab", { name: "TAT distribution" }).click();
    await expect(page.getByText("No submitted cases yet")).toBeVisible();
  });
});

test.describe("Patient profile: Policy Check", () => {
  test("three buttons show this patient's information inside the block without navigating", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    const block = page.locator("details", { has: page.getByText("Policy Check", { exact: true }) });
    await expect(block).toHaveAttribute("open", "");
    const tabs = block.getByRole("tablist", { name: "Policy check" });
    for (const t of ["Patient & Policy", "Medical & Financial", "Documents"]) await expect(tabs.getByRole("tab", { name: t })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Patient & Policy" })).toHaveAttribute("aria-selected", "true");
    await expect(block.getByRole("tabpanel")).toContainText("Demo Patient Anil");

    await mark(page);
    await tabs.getByRole("tab", { name: "Medical & Financial" }).click();
    await expect(block.getByRole("tabpanel")).toContainText("Cover available");
    await expect(block.getByRole("tabpanel")).toContainText("Pre-authorizations");
    await tabs.getByRole("tab", { name: "Documents" }).click();
    await expect(block.getByRole("tabpanel")).toBeVisible();
    expect(await samePage(page)).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/patients/${IDS.patientA1}$`));

    // The existing coverage section is still there, and the block collapses.
    await expect(page.getByText("Insurance & scheme coverage")).toBeVisible();
    await block.locator("summary").click();
    await expect(block).not.toHaveAttribute("open", "");
  });
});
