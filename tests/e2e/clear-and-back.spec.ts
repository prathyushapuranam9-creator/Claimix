import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMO } from "../fixtures/seed/ids";
import { openMenuIfCollapsed, signIn } from "./helpers";

const back = (page: Page) => page.getByRole("button", { name: "Back" });
const TPA_URL = new RegExp(`/tpas/${DEMO.org.tpaA}$`);

/** Opens MediAssist's TPA page the way a reviewer would: sidebar → TPAs → the TPA. */
async function openTpa(page: Page) {
  await openMenuIfCollapsed(page);
  await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "TPAs", exact: true }).click();
  await page.waitForURL(/\/tpas$/);
  await page.getByRole("table", { name: "TPAs" }).getByRole("link", { name: /MediAssist/ }).click();
  await page.waitForURL(TPA_URL);
}

/** A case block's title once loaded, e.g. "Claims handled by this TPA (8)". */
const loaded = (title: RegExp) => new RegExp(`${title.source} \\(\\d+\\)$`);
const block = (page: Page, title: RegExp) => page.locator("main section").filter({ has: page.getByRole("heading", { name: title }) });

/** Clicks through the list's view tabs (each adds a history entry for the same page). */
async function clickViews(page: Page) {
  const views = page.locator("main [role=group] a");
  const n = await views.count();
  for (let i = 0; i < Math.min(n, 3); i++) await views.nth(n - 1 - i).click();
}

test.describe("Hospitals & network: Clear", () => {
  test("Clear resets every dropdown, the search and the switch, and shows the full list again", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await page.goto("/hospitals");
    const search = page.getByRole("search");
    const total = (await page.getByRole("navigation", { name: "Pagination" }).innerText()).match(/of (\d+)/)![1];

    const pick = async (label: string) => {
      const sel = search.getByLabel(label);
      const values = await sel.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
      await sel.selectOption(values[0]!);
    };
    await search.getByLabel("Hospital or city").fill("a");
    await pick("Insurer network");
    await pick("Government scheme");
    await pick("State / UT");
    await search.getByRole("switch", { name: "Cashless only" }).check();
    await search.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/\/hospitals\?/);

    await page.getByRole("search").getByRole("link", { name: "Clear" }).click();
    await page.waitForURL(/\/hospitals$/);
    const s2 = page.getByRole("search");
    for (const l of ["Insurer network", "Government scheme", "State / UT"]) await expect(s2.getByLabel(l), l).toHaveValue("");
    await expect(s2.getByLabel("Hospital or city")).toHaveValue("");
    await expect(s2.getByRole("switch", { name: "Cashless only" })).not.toBeChecked();
    await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText(`of ${total}`);
  });
});

test.describe("TPA details: Back from pages opened in its case blocks", () => {
  for (const [title, listPath] of [
    [/^Pre-authorizations handled by this TPA/, "/pre-authorizations"],
    [/^Claims handled by this TPA/, "/claims"],
  ] as const) {
    test(`${listPath}: "View all" and each case open from the TPA; Back always returns to the TPA`, async ({ page }) => {
      await signIn(page, "insurer.a@demo.claimix.invalid");
      await openTpa(page);
      // The case blocks load on their own: wait for the section (its title carries the count) before counting links.
      await expect(page.getByRole("heading", { name: loaded(title) })).toBeVisible();
      const links: Locator = block(page, title).getByRole("link");
      const count = await links.count();
      test.skip(count === 0, "No cases for this TPA in the test data.");

      for (let i = 0; i < count; i++) {
        const link = block(page, title).getByRole("link").nth(i);
        const name = (await link.innerText()).trim();
        await link.click();
        await page.waitForURL((u) => !TPA_URL.test(u.pathname));
        await expect(back(page)).toBeVisible();
        if (new URL(page.url()).pathname === listPath) {
          // The list: switch views and search (same page, new history entries) before going back.
          await clickViews(page);
          await page.getByRole("search").getByRole("button", { name: "Apply" }).click();
          await page.waitForLoadState("load");
        }
        await back(page).click();
        await expect(page, name).toHaveURL(TPA_URL);
        await expect(page.getByRole("heading", { name: loaded(title) })).toBeVisible();
      }
      // The browser's own Back after all that still behaves (no loop to the TPA page).
      await page.goBack();
      await expect(page).toHaveURL(/\/tpas$/);
    });
  }
});

test.describe("Insurance company → View network hospitals → Back", () => {
  test("Back on Hospitals & network returns to that insurance company; sidebar and direct visits have no Back", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await openMenuIfCollapsed(page);
    await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Insurance companies", exact: true }).click();
    await page.waitForURL(/\/insurers$/);
    // Top-level page reached from the sidebar: no Back.
    await expect(back(page)).toHaveCount(0);

    await page.getByRole("table").getByRole("link", { name: "Aarogya Shield General Insurance (DEMO DATA)", exact: true }).click();
    await page.waitForURL(/\/insurers\/[0-9a-f-]{36}$/);
    const insurerUrl = page.url();
    await page.getByRole("link", { name: "View network hospitals" }).click();
    await page.waitForURL(/\/hospitals\?.*insurer=/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hospitals & network");

    // Exactly one Back, and it returns to the same insurance company (not to Hospitals again).
    await expect(back(page)).toHaveCount(1);
    await back(page).click();
    await expect(page).toHaveURL(insurerUrl);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Aarogya Shield");

    // A hospital opened from there, then Back twice: hospital → network list → insurer.
    await page.getByRole("link", { name: "View network hospitals" }).click();
    await page.waitForURL(/\/hospitals\?/);
    await page.getByRole("table", { name: "Hospitals" }).getByRole("link", { name: "View details" }).first().click();
    await page.waitForURL(/\/hospitals\/[0-9a-f-]{36}$/);
    await back(page).click();
    await expect(page).toHaveURL(/\/hospitals\?.*insurer=/);
    await back(page).click();
    await expect(page).toHaveURL(insurerUrl);

    // Opened directly: the top-level list has no Back.
    await page.goto("/hospitals");
    await expect(back(page)).toHaveCount(0);
  });
});
