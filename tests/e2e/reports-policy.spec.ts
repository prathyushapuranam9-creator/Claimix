import { expect, test, type Page } from "@playwright/test";
import { alphaId, IDS, signIn } from "./helpers";

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

  test("TAT distribution is a bar graph of the six buckets, with each bucket's figures", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/reports?range=all");
    await mark(page);
    await page.getByRole("tab", { name: "TAT distribution" }).click();
    expect(await samePage(page)).toBe(true);

    const graph = page.getByRole("region", { name: "TAT distribution graph" });
    const bars = graph.getByRole("listitem");
    await expect(bars).toHaveCount(6);
    const labels = ["0–15 days", "16–30 days", "31–45 days", "46–60 days", "61–90 days", "90+ days"];
    const counts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const bar = bars.nth(i);
      await expect(bar).toContainText(labels[i]!);
      for (const f of ["Billed", "Approved", "Received", "Avg risk"]) await expect(bar).toContainText(f);
      await expect(bar).toContainText("₹");
      counts.push(Number((await bar.locator("[class*=barValue]").textContent())!.replace(/[^\d]/g, "")));
    }
    // Same total as the card header; no table any more.
    const sum = counts.reduce((x, y) => x + y, 0);
    await expect(page.getByText(new RegExp(`${sum} submitted cases?`))).toBeVisible();
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Turnaround time distribution" }) }).getByRole("table")).toHaveCount(0);

    // Heights follow the counts: empty buckets draw no bar; the largest bucket is the tallest.
    for (let i = 0; i < 6; i++) await expect(bars.nth(i).locator("[class*=bar3d]")).toHaveCount(counts[i]! > 0 ? 1 : 0);
    const heights = await Promise.all(counts.map(async (n, i) => (n > 0 ? (await bars.nth(i).locator("[class*=bar3d]").boundingBox())!.height : 0)));
    const top = counts.indexOf(Math.max(...counts));
    expect(Math.max(...heights)).toBe(heights[top]);

    // Nothing spills out of the page (the graph scrolls inside its card on small screens).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
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
  const block = (page: Page) => page.locator("details[data-patient-id]");

  test("three buttons show this patient's information inside the block without navigating", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    // Collapsed by default: the data stays hidden until the summary is clicked.
    await expect(block(page)).not.toHaveAttribute("open", "");
    await expect(block(page).getByRole("tablist", { name: "Policy check" })).toBeHidden();
    await block(page).locator("summary").click();
    await expect(block(page)).toHaveAttribute("open", "");
    await expect(block(page)).toHaveAttribute("data-patient-id", IDS.patientA1);
    await expect(block(page)).toContainText("Showing records for Demo Patient Anil");
    const tabs = block(page).getByRole("tablist", { name: "Policy check" });
    for (const t of ["Patient & Policy", "Medical & Financial", "Documents"]) await expect(tabs.getByRole("tab", { name: t })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Patient & Policy" })).toHaveAttribute("aria-selected", "true");

    await mark(page);
    // Medical & Financial: its own Pre-authorizations / Claims buttons, switching in place.
    await tabs.getByRole("tab", { name: "Medical & Financial" }).click();
    const mf = block(page).getByRole("tablist", { name: "Medical & financial records" });
    await expect(mf.getByRole("tab", { name: "Pre-authorizations" })).toHaveAttribute("aria-selected", "true");
    await expect(block(page).getByRole("region", { name: "Pre-authorizations for this patient" })).toBeVisible();
    await mf.getByRole("tab", { name: "Claims" }).click();
    await expect(mf.getByRole("tab", { name: "Claims" })).toHaveAttribute("aria-selected", "true");
    await expect(block(page).getByRole("region", { name: "Pre-authorizations for this patient" })).toBeHidden();

    await tabs.getByRole("tab", { name: "Documents" }).click();
    expect(await samePage(page)).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/patients/${IDS.patientA1}$`));

    // The existing coverage section is still there, and the block collapses.
    await expect(page.getByText("Insurance & scheme coverage")).toBeVisible();
    await block(page).locator("summary").click();
    await expect(block(page)).not.toHaveAttribute("open", "");

    // Opened again, then refreshed: closed again.
    await block(page).locator("summary").click();
    await expect(block(page)).toHaveAttribute("open", "");
    await page.reload();
    await expect(block(page)).not.toHaveAttribute("open", "");
  });

  test("a patient with no records gets per-patient empty messages; moving to another patient rebuilds the block", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    await block(page).locator("summary").click();
    await block(page).getByRole("tab", { name: "Medical & Financial" }).click();

    // Register a brand-new patient (no pre-auths, claims or documents) and open their profile.
    const name = `Isolation Check ${alphaId()}`;
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page.getByRole("button", { name: "Register patient" }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
    const newId = new URL(page.url()).pathname.split("/").pop()!;

    await expect(block(page)).toHaveAttribute("data-patient-id", newId);
    // Another patient opens collapsed too.
    await expect(block(page)).not.toHaveAttribute("open", "");
    await block(page).locator("summary").click();
    await expect(block(page)).toContainText(`Showing records for ${name}`);
    await expect(block(page)).not.toContainText("Demo Patient Anil");
    // Fresh per patient: back on the first tab.
    await expect(block(page).getByRole("tab", { name: "Patient & Policy" })).toHaveAttribute("aria-selected", "true");
    await expect(block(page)).toContainText("No information available for this patient.");
    await block(page).getByRole("tab", { name: "Medical & Financial" }).click();
    await expect(block(page)).toContainText("No pre-authorizations available for this patient");
    await block(page).getByRole("tab", { name: "Claims" }).click();
    await expect(block(page)).toContainText("No claims available for this patient");
    await block(page).getByRole("tab", { name: "Documents" }).click();
    await expect(block(page)).toContainText("No documents available for this patient");
  });
});

test.describe("Reports overview: Performance & financial metrics graphs", () => {
  const rupees = (t: string) => Number(t.replace(/[^\d]/g, "") || 0);

  test("two bar graphs (Days and ₹) with real values, tooltips and no overflow", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/reports?range=all");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Performance & financial metrics" }) }).first();
    const tat = section.locator("section", { has: page.getByRole("heading", { name: "Turnaround Performance" }) });
    const money = section.locator("section", { has: page.getByRole("heading", { name: "Financial Performance" }) });
    await expect(tat).toContainText("Days");
    await expect(money).toContainText("Amount (₹)");
    for (const b of ["Pre-auth turnaround", "Claim turnaround"]) await expect(tat.getByRole("img", { name: new RegExp(`^${b}`) })).toBeVisible();
    const startsWith = (s: string) => new RegExp(`^${s.replace(/[()]/g, "\\$&")}`);
    for (const b of ["Claimed", "Approved", "Settled (paid)"]) await expect(money.getByRole("img", { name: startsWith(b) })).toBeVisible();

    // ₹ bars equal the overview's own financial summary table (same real data).
    const summary = page.getByRole("region", { name: "Financial summary by claim type" });
    const col = async (n: number) => (await summary.locator(`tbody tr td:nth-child(${n})`).allTextContents()).reduce((a, t) => a + rupees(t), 0);
    const [claimed, approved, settled] = [await col(3), await col(4), await col(6)];
    const barValue = async (name: string) => rupees((await money.getByRole("img", { name: startsWith(name) }).getAttribute("aria-label"))!);
    expect(await barValue("Claimed")).toBe(claimed);
    expect(await barValue("Approved")).toBe(approved);
    expect(await barValue("Settled (paid)")).toBe(settled);
    await expect(money).toContainText(new RegExp(`₹${claimed.toLocaleString("en-IN")}`));

    // Tooltip on keyboard focus shows the full amount; turnaround shows the average in days.
    const claimedBar = money.getByRole("img", { name: /^Claimed/ });
    await claimedBar.focus();
    await expect(claimedBar.locator("span[aria-hidden=true][class*=tip]")).toBeVisible();
    await expect(claimedBar.locator("span[aria-hidden=true][class*=tip]")).toContainText(`₹${claimed.toLocaleString("en-IN")}`);
    await expect(tat.getByRole("img", { name: /^Pre-auth turnaround/ })).toHaveAttribute("aria-label", /Average: \d+\.\d days|No decided cases yet/);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("an empty period shows the empty state instead of bars", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/reports?range=custom&from=1990-01-01&to=1990-12-31");
    await expect(page.getByText("No performance data available")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Financial Performance" })).toHaveCount(0);
  });
});

test.describe("Insurer dashboard: Performance & financial metrics graphs", () => {
  test("the dashboard section shows the same two bar graphs, matching the Reports values", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await expect(page.getByRole("heading", { name: /Performance & financial metrics/i })).toBeVisible();
    const money = page.locator("section", { has: page.getByRole("heading", { name: "Financial Performance" }) }).first();
    const tat = page.locator("section", { has: page.getByRole("heading", { name: "Turnaround Performance" }) }).first();
    await expect(tat).toContainText("Days");
    await expect(money).toContainText("Amount (₹)");
    const label = async (loc: typeof money, name: RegExp) => (await loc.getByRole("img", { name }).getAttribute("aria-label"))!;
    const dash = { claimed: await label(money, /^Claimed/), approved: await label(money, /^Approved/), settled: await label(money, /^Settled/) };
    // No old KPI cards left in this section.
    await expect(page.getByText("Completed transfers")).toHaveCount(0);

    // Same figures as the Reports overview (all time) for the same user.
    await page.goto("/reports?range=all");
    const rMoney = page.locator("section", { has: page.getByRole("heading", { name: "Financial Performance" }) }).first();
    expect(await label(rMoney, /^Claimed/)).toBe(dash.claimed);
    expect(await label(rMoney, /^Approved/)).toBe(dash.approved);
    expect(await label(rMoney, /^Settled/)).toBe(dash.settled);
  });
});
