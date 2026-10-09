import { expect, test, type Page } from "@playwright/test";
import { DEMO } from "../fixtures/seed/ids";
import { openMenuIfCollapsed, signIn } from "./helpers";

const nav = (page: Page) => page.getByRole("complementary", { name: "Main navigation" });
const TABS = ["Overview", "Eligibility", "Coverage", "Waiting period", "PED", "Exclusions", "Limits", "Hospitals", "Documents", "Pre-auth", "Claims", "Renewal", "Contact"];

test("Insurer Reviewer: the Policies menu is called Insurer/Provider; hospital staff keep Policies", async ({ page }) => {
  await signIn(page, "insurer.a@demo.claimix.invalid");
  await openMenuIfCollapsed(page);
  await expect(nav(page).getByRole("link", { name: "Policies", exact: true })).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Insurer/Provider", exact: true }).click();
  await page.waitForURL(/\/policies$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Insurer/Provider");
  await expect(page.getByRole("navigation", { name: "Current section" })).toContainText("Insurer/Provider");

  await page.context().clearCookies();
  await signIn(page, "staff.a@demo.claimix.invalid");
  await openMenuIfCollapsed(page);
  await expect(nav(page).getByRole("link", { name: "Policies", exact: true })).toHaveCount(1);
  await expect(nav(page).getByRole("link", { name: "Insurer/Provider" })).toHaveCount(0);
});

test("Policy overview: header pill, all tabs with one active, at-a-glance grid, callouts", async ({ page }) => {
  await signIn(page, "insurer.a@demo.claimix.invalid");
  await page.goto(`/policies/${DEMO.policy.aarogyaFloater}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aarogya Family Floater Plus (DEMO DATA)");
  await expect(page.locator("main").getByText("Private insurance", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("Aarogya Shield General Insurance (DEMO DATA)").first()).toBeVisible();

  const tabs = page.getByRole("navigation", { name: "Policy sections" });
  for (const t of TABS) await expect(tabs.getByRole("link", { name: t, exact: true })).toHaveCount(1);
  await expect(tabs.locator("[aria-current=page]")).toHaveText("Overview");
  // Active: stronger text and a visible underline; others: no underline.
  const style = (name: string) => tabs.getByRole("link", { name, exact: true }).evaluate((el) => { const s = getComputedStyle(el); return { w: Number(s.fontWeight), b: s.borderBottomColor }; });
  const active = await style("Overview");
  const other = await style("Coverage");
  expect(active.w).toBeGreaterThan(other.w);
  expect(active.b).not.toBe(other.b);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const glance = page.locator("main section").filter({ has: page.getByRole("heading", { name: "At a glance" }) });
  for (const label of ["Type", "Insurer", "TPA", "Sum insured", "Rules in force", "Rule checks"]) await expect(glance.locator("dt", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  await expect(glance).toContainText("MediAssist Claims Services (DEMO DATA)");
  await expect(glance).toContainText(/\d+ configured/);

  const notes = page.getByRole("note");
  await expect(notes.filter({ hasText: "Remember" })).toContainText("Cashless does not mean zero payment");
  await expect(notes.filter({ hasText: "does not guarantee claim approval" })).toBeVisible();

  // Tabs still switch the section in place of the overview.
  await tabs.getByRole("link", { name: "Limits", exact: true }).click();
  await expect(tabs.locator("[aria-current=page]")).toHaveText("Limits");
  await expect(page.getByRole("heading", { name: "Limits, co-pay and deductibles" })).toBeVisible();
});
