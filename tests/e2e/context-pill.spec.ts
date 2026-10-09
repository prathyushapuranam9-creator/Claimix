import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const AAROGYA = "Aarogya Shield General Insurance (DEMO DATA)";
const NAVJEEVAN = "Navjeevan General Insurance (DEMO DATA)";
const pill = (page: Page) => page.getByRole("status", { name: "Current testing context" });

async function choose(page: Page, company: string) {
  await page.goto("/dashboard");
  await page.getByLabel("Insurance Company").selectOption({ label: company });
  const role = page.getByLabel("Role", { exact: true });
  await role.selectOption({ label: "Payer Reviewer" });
  await page.getByRole("button", { name: "Switch Context" }).click();
  await expect(pill(page)).toContainText(company);
}

test("Testing context lives in the navbar as a compact pill, not in the page body", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@demo.claimix.invalid");
  // No context yet: nothing in the navbar; note where the page title starts.
  await page.goto("/pre-authorizations?view=all");
  await expect(pill(page)).toHaveCount(0);
  const titleTop = (await page.getByRole("heading", { level: 1 }).boundingBox())!.y;

  await choose(page, AAROGYA);
  await page.goto("/pre-authorizations?view=all");

  // In the top navbar, beside the theme toggle / notifications / profile; nothing in the main content.
  await expect(page.locator("header").getByRole("status", { name: "Current testing context" })).toBeVisible();
  await expect(page.locator("main").getByRole("status", { name: "Current testing context" })).toHaveCount(0);
  await expect(pill(page)).toContainText(`${AAROGYA} • Payer Reviewer`);
  await expect(pill(page)).toContainText("Testing context:");

  // Look: the label is bold, uppercase, 11px; the pill matches the spec.
  const label = pill(page).getByText("Testing context:");
  const ls = await label.evaluate((el) => {
    const s = getComputedStyle(el.parentElement!);
    return { size: s.fontSize, weight: s.fontWeight, transform: s.textTransform };
  });
  expect(ls).toEqual({ size: "11px", weight: "700", transform: "uppercase" });
  await page.locator("html").evaluate((el) => (el.dataset.theme = "light"));
  const box = await pill(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius, pad: `${s.paddingTop} ${s.paddingLeft}` };
  });
  expect(box).toEqual({ bg: "rgb(239, 246, 255)", border: "rgb(191, 219, 254)", radius: "20px", pad: "4px 12px" });

  // No space taken from the page: the title starts where it did without a context.
  expect(Math.round((await page.getByRole("heading", { level: 1 }).boundingBox())!.y)).toBe(Math.round(titleTop));

  // Switch Context opens the existing switcher under the pill (no page change); Exit uses the existing exit.
  await pill(page).getByRole("button", { name: "Switch Context" }).click();
  await page.getByLabel("Insurance Company").selectOption({ label: NAVJEEVAN });
  const role = page.getByLabel("Role", { exact: true });
  await role.selectOption({ label: "Payer Reviewer" });
  await page.locator("header").getByRole("button", { name: "Switch Context" }).last().click();
  await expect(pill(page)).toContainText(`${NAVJEEVAN} • Payer Reviewer`);
  await expect(page).toHaveURL(/\/pre-authorizations/);

  await pill(page).getByRole("button", { name: "Exit", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
  await expect(pill(page)).toHaveCount(0);
});

test("the pill never overlaps the other navbar controls on a phone", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, "admin@demo.claimix.invalid");
  await choose(page, AAROGYA);
  await page.goto("/patients");
  const rects = await page.locator("header").evaluate((h) => {
    const boxes = [...h.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    return { boxes: boxes.map((r) => [r.left, r.right]), width: h.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth };
  });
  expect(rects.scroll).toBeLessThanOrEqual(390);
  const sorted = rects.boxes.sort((a, b) => a[0]! - b[0]!);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i]![0]!).toBeGreaterThanOrEqual(sorted[i - 1]![1]! - 1);
  await expect(pill(page).getByRole("link", { name: "Switch Context" }).or(pill(page).getByRole("button", { name: "Switch Context" }))).toBeVisible();
  await expect(pill(page).getByRole("button", { name: "Exit", exact: true })).toBeVisible();
});
