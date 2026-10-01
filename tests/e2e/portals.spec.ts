import { expect, test, type Page } from "@playwright/test";
import { IDS, PASSWORD, portalRoleFor, signIn } from "./helpers";

const taskbar = (page: Page) => page.locator("header").first();
const section = (page: Page) => page.getByRole("navigation", { name: "Current section" });

const CASES = [
  { email: "staff.a@demo.claimix.invalid", portal: "Hospital Staff", pages: [["/patients", "Patients"], ["/claims", "Claims"]] },
  { email: "insurer.a@demo.claimix.invalid", portal: "Insurer Reviewer", pages: [["/pre-authorizations", "Pre-Authorization"], ["/claims", "Claims"]] },
  { email: "tpa.a@demo.claimix.invalid", portal: "Insurer Reviewer", pages: [["/claims", "Claims"]] },
  { email: "admin@demo.claimix.invalid", portal: "Administrator", pages: [["/admin/users", "Users"], ["/audit", "Audit log"]] },
] as const;

for (const c of CASES) {
  test(`${c.email.split("@")[0]}: taskbar shows only "${c.portal}"; the section name sits below it`, async ({ page }) => {
    await signIn(page, c.email);
    await expect(taskbar(page)).toContainText(c.portal);
    await expect(section(page)).toHaveText("Dashboard");
    await expect(taskbar(page)).not.toContainText("Dashboard");
    // A top-level page has nothing to go back to.
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
    for (const [path, name] of c.pages) {
      await page.goto(path);
      await expect(section(page)).toContainText(name);
      await expect(taskbar(page)).toContainText(c.portal); // stays the same while navigating
      await expect(taskbar(page)).not.toContainText(name);
    }
  });
}

test("Back sits below the taskbar next to the section name and returns to the exact previous page", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  // A filtered list, then into a record.
  await page.goto("/patients?q=Demo");
  await page.getByRole("link", { name: "Demo Patient Anil" }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${IDS.patientA1}$`));

  const back = page.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();
  await expect(taskbar(page).getByRole("button", { name: "Back" })).toHaveCount(0); // not in the taskbar
  await expect(section(page)).toContainText("Patients");
  // Back and the section name share one row, directly below the taskbar.
  const [barBox, backBox, nameBox] = await Promise.all([taskbar(page).boundingBox(), back.boundingBox(), section(page).boundingBox()]);
  expect(backBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
  expect(Math.abs(backBox!.y + backBox!.height / 2 - (nameBox!.y + nameBox!.height / 2))).toBeLessThan(8);
  expect(nameBox!.x).toBeGreaterThan(backBox!.x);

  await back.click();
  await expect(page).toHaveURL(/\/patients\?q=Demo$/); // the exact page, filters included
  await expect(page.getByLabel(/Name or patient number|Search/i).first()).toHaveValue("Demo");
});

test("opened directly, Back falls back to the parent section", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto(`/patients/${IDS.patientA1}`);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/patients$/);
});

test("sign-in offers the three roles and refuses a portal the account doesn't belong to", async ({ page }) => {
  await page.goto("/login");
  const group = page.getByRole("group", { name: "Sign in as" });
  for (const r of ["Hospital Staff", "Insurance Reviewer", "Admin"]) await expect(group.getByRole("radio", { name: r })).toBeVisible();
  await expect(group.getByRole("radio", { name: "Hospital Staff" })).toBeChecked();

  // An insurer account trying the Hospital Staff portal: refused, with no session.
  await page.locator("#email").fill("insurer.b@demo.claimix.invalid");
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This account signs in as" })).toContainText('Choose "Insurance Reviewer"');
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  // Choosing the right role signs in, and the choice is remembered on this device.
  await page.getByRole("radio", { name: portalRoleFor("insurer.b@demo.claimix.invalid") }).check();
  await page.locator("#email").fill("insurer.b@demo.claimix.invalid");
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(taskbar(page)).toContainText("Insurer Reviewer");
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("radio", { name: "Insurance Reviewer" })).toBeChecked();
});

test("keyboard users can choose the role with the arrow keys", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("radio", { name: "Hospital Staff" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Insurance Reviewer" })).toBeChecked();
});

test.describe("collapsing the sidebar", () => {
  test.skip(({ isMobile }) => isMobile, "the collapsible rail is a desktop feature; phones use the drawer");
  test.use({ viewport: { width: 1920, height: 1000 } });

  const contentBox = async (page: Page) => (await page.locator("#main").boundingBox())!;
  const settle = (page: Page) => page.waitForTimeout(400); // let the 180 ms transition finish

  test("Insurer Reviewer: the content fills the space beside the sidebar in both states", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    const rail = () => page.getByRole("complementary", { name: "Main navigation" }).boundingBox();

    // Expanded: content spans the whole area beside the sidebar (not a fixed, centred block).
    const open = (await rail())!;
    const before = await contentBox(page);
    expect(before.x).toBeLessThan(open.x + open.width + 2);
    expect(Math.abs(before.x + before.width - 1920)).toBeLessThan(2);

    // Collapsed: it grows into exactly the space the sidebar gave up.
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await settle(page);
    const slim = (await rail())!;
    const collapsed = await contentBox(page);
    expect(collapsed.x).toBeLessThan(slim.x + slim.width + 2);
    expect(Math.abs(collapsed.width - before.width - (open.width - slim.width))).toBeLessThan(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Expanded again: back to the original size and position.
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await settle(page);
    const expanded = await contentBox(page);
    expect(Math.abs(expanded.width - before.width)).toBeLessThan(2);
    expect(Math.abs(expanded.x - before.x)).toBeLessThan(2);
  });

  test("the collapse control shows only its icon (named for assistive tech)", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    const btn = page.getByRole("button", { name: "Collapse sidebar" });
    await expect(btn).toHaveText("");
    await expect(btn.locator("svg")).toBeVisible();
    await expect(btn).toHaveAttribute("title", "Collapse sidebar");
  });

  test("Hospital Staff: unchanged (content keeps its usual width when collapsed)", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    const before = await contentBox(page);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await settle(page);
    const after = await contentBox(page);
    expect(Math.abs(after.width - before.width)).toBeLessThan(2);
  });
});
