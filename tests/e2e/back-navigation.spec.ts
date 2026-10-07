import { expect, test, type Page } from "@playwright/test";
import { DEMO } from "../fixtures/seed/ids";
import { IDS, openMenuIfCollapsed, signIn } from "./helpers";

/** A sidebar link, opening the drawer first on phones. */
async function sidebar(page: Page, name: string) {
  await openMenuIfCollapsed(page);
  await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name, exact: true }).click();
}
const back = (page: Page) => page.getByRole("button", { name: "Back" });
const POLICY_TABS = ["Overview", "Eligibility", "Coverage", "Waiting period", "PED", "Exclusions", "Limits", "Hospitals", "Documents", "Pre-auth", "Claims", "Renewal", "Contact"];

test.describe("Back navigation", () => {
  test("Patients search → profile → Back keeps the search; only one Back control", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await sidebar(page, "Patients");
    await page.waitForURL(/\/patients$/);
    await page.getByRole("searchbox").fill("Anil");
    await page.getByRole("searchbox").press("Enter");
    await page.waitForURL(/\/patients\?.*q=Anil/);
    await page.getByRole("table", { name: "Patients" }).getByRole("link").first().click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    await expect(back(page)).toHaveCount(1);
    await expect(back(page)).toHaveAttribute("aria-label", "Back");
    await back(page).click();
    await expect(page).toHaveURL(/\/patients\?.*q=Anil/);
    await expect(page.getByRole("searchbox")).toHaveValue("Anil");
  });

  test("Policies → policy → any number of tabs → Back returns to the list (and so does the browser's Back)", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await sidebar(page, "Policies");
    await page.waitForURL(/\/policies$/);
    for (const useBrowser of [false, true]) {
      await page.getByRole("link", { name: /Aarogya Family Floater Plus/ }).first().click();
      await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
      const tabs = page.getByRole("navigation", { name: "Policy sections" });
      for (const t of POLICY_TABS) {
        await tabs.getByRole("link", { name: t, exact: true }).click();
        await expect(tabs.getByRole("link", { name: t, exact: true })).toHaveAttribute("aria-current", "page");
      }
      if (useBrowser) await page.goBack();
      else await back(page).click();
      await expect(page).toHaveURL(/\/policies$/);
    }
  });

  test("each policy tab: Back leaves the policy, never reopens it", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await sidebar(page, "Policies");
    await page.waitForURL(/\/policies$/);
    for (const t of POLICY_TABS) {
      await page.getByRole("link", { name: /Aarogya Family Floater Plus/ }).first().click();
      await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
      await page.getByRole("navigation", { name: "Policy sections" }).getByRole("link", { name: t, exact: true }).click();
      await back(page).click();
      await expect(page, t).toHaveURL(/\/policies$/);
    }
  });

  test("opened directly: Back goes to the parent page, with no loop back", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    // Policy page by URL, on a tab → the Policies list.
    await page.goto(`/policies/${DEMO.policy.aarogyaFloater}?tab=claims`);
    await back(page).click();
    await expect(page).toHaveURL(/\/policies$/);

    // Edit page by URL → its profile → the Patients list (never back to the edit page).
    await page.goto(`/patients/${IDS.patientA1}/edit`);
    await back(page).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${IDS.patientA1}$`));
    await back(page).click();
    await expect(page).toHaveURL(/\/patients$/);

    // A refresh keeps the real previous page.
    await page.getByRole("table", { name: "Patients" }).getByRole("link").first().click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    await page.reload();
    await back(page).click();
    await expect(page).toHaveURL(/\/patients$/);
  });

  test("Profile Settings and nested pages return to where they were opened from", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await sidebar(page, "Patients");
    await page.waitForURL(/\/patients$/);
    await page.getByRole("button", { name: /^Profile menu/ }).click();
    await page.getByRole("menuitem", { name: "Profile Settings" }).click();
    await page.waitForURL(/\/profile$/);
    await back(page).click();
    await expect(page).toHaveURL(/\/patients$/);

    // Patient → edit → Back → patient → Back → list.
    await page.getByRole("table", { name: "Patients" }).getByRole("link").first().click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    const profile = page.url();
    await page.getByRole("link", { name: "Edit details" }).click();
    await page.waitForURL(/\/edit$/);
    await back(page).click();
    await expect(page).toHaveURL(profile);
    await back(page).click();
    await expect(page).toHaveURL(/\/patients$/);
  });
});

test("profile icon: no hover effect; click still opens the menu", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  const btn = page.getByRole("button", { name: /^Profile menu/ });
  const style = () => btn.evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.boxShadow, s.opacity, s.transform].join("|"); });
  await page.mouse.move(5, 500);
  const before = await style();
  await btn.hover();
  await page.waitForTimeout(250);
  expect(await style()).toBe(before);
  await btn.click();
  await expect(page.getByRole("dialog", { name: "Your profile" })).toBeVisible();
});

test("Eligibility Result shows the patient's name, department and reason for join, and closes with ×", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto(`/patients/${IDS.patientA1}`);
  const details = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Details", exact: true }) });
  const value = (scope: ReturnType<Page["locator"]>, label: string) => scope.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
  const name = (await value(details, "Name").innerText()).trim();
  const dept = (await value(details, "Department").innerText()).trim();
  const reason = (await value(details, "Reason for Visit").innerText()).trim();

  const toggle = page.getByRole("button", { name: /^Eligibility Check/ });
  await toggle.click();
  const block = page.getByTestId("eligibility-patient");
  await expect(value(block, "Name")).toHaveText(name);
  await expect(value(block, "Department")).toHaveText(dept);
  await expect(value(block, "Reason for Join")).toHaveText(reason);

  await page.getByRole("button", { name: "Close eligibility result" }).click();
  await expect(page.locator("#eligibility-result")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
