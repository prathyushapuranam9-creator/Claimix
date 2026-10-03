import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const profileBtn = (page: Page) => page.getByRole("button", { name: /^Profile menu/ });

/** The sidebar footer already shows the session user (name, "role · organization"): the reference values. */
async function sessionUser(page: Page) {
  const name = (await page.locator("aside [class*=userName]").textContent())!.trim();
  const meta = (await page.locator("aside [class*=userMeta]").textContent())!.trim();
  const [role, org] = meta.split(" · ");
  return { name, role: role!, org: org! };
}

const ACCOUNTS = ["staff.a@demo.claimix.invalid", "insurer.a@demo.claimix.invalid", "admin@demo.claimix.invalid"];

test.describe("Taskbar: signed-in user profile", () => {
  for (const email of ACCOUNTS) {
    test(`name below the icon, name + role on hover, menu of name, role and actions on click (${email})`, async ({ page }) => {
      await signIn(page, email);
      const startUrl = page.url();
      const me = await sessionUser(page);
      expect(me.name.length).toBeGreaterThan(0);

      // Name directly below the icon.
      await expect(profileBtn(page)).toBeVisible();
      await expect(profileBtn(page)).toContainText(me.name);
      const icon = await profileBtn(page).locator("svg").boundingBox();
      const label = await profileBtn(page).getByText(me.name).boundingBox();
      expect(label!.y).toBeGreaterThanOrEqual(icon!.y + icon!.height - 1);

      // Hover: name + role.
      await profileBtn(page).hover();
      const tip = page.getByRole("tooltip");
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(me.name);
      await expect(tip).toContainText(me.role);

      // Click: the menu on the same page.
      await profileBtn(page).click();
      const panel = page.getByRole("dialog", { name: "Your profile" });
      await expect(panel).toBeVisible();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      // Only: name, role, Profile Settings, Sign Out.
      await expect(panel.locator("p")).toHaveText([me.name, me.role]);
      await expect(panel.getByRole("menuitem")).toHaveText(["Profile Settings", "Sign Out"]);
      await expect(panel).not.toContainText(email);
      await expect(panel).not.toContainText(me.org);
      await expect(panel).not.toContainText("Status");
      await expect(panel.locator("dl")).toHaveCount(0);
      expect(page.url()).toBe(startUrl);

      // Inside the viewport, no horizontal overflow.
      const box = (await panel.boundingBox())!;
      const vw = page.viewportSize()!.width;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Escape closes it.
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    });
  }

  test("the name never overlaps the other taskbar controls", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    const btn = (await profileBtn(page).boundingBox())!;
    for (const other of [page.getByRole("link", { name: /^Notifications/ }), page.getByRole("button", { name: /dark mode|light mode/i })]) {
      if (!(await other.count())) continue;
      const o = (await other.boundingBox())!;
      expect(o.x + o.width <= btn.x || btn.x + btn.width <= o.x).toBe(true);
    }
    const bar = (await page.locator("header").first().boundingBox())!;
    expect(btn.y).toBeGreaterThanOrEqual(bar.y);
    expect(btn.y + btn.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
  });

  test("signing out clears the user's details; the next user sees only their own", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    const first = await sessionUser(page);
    await profileBtn(page).click();
    await page.getByRole("menuitem", { name: "Sign Out" }).click();
    await page.waitForURL(/\/login/);
    await expect(profileBtn(page)).toHaveCount(0);
    await expect(page.getByText(first.name, { exact: true })).toHaveCount(0);
    // Back does not bring the signed-in page (and its details) back.
    await page.goBack();
    await page.waitForURL(/\/login/);
    await expect(profileBtn(page)).toHaveCount(0);

    await signIn(page, "insurer.a@demo.claimix.invalid");
    const second = await sessionUser(page);
    expect(second.name).not.toBe(first.name);
    await profileBtn(page).click();
    const panel = page.getByRole("dialog", { name: "Your profile" });
    await expect(panel).toContainText(second.name);
    await expect(panel).not.toContainText(first.name);
  });
});

test.describe("Taskbar: notification bell tooltip", () => {
  test("shows \"Notifications\" only while hovering, in light and dark mode; click still opens notifications", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    const bell = page.getByRole("link", { name: /^Notifications/ });
    const tip = page.locator("header [class*=bellTip]");
    const before = (await bell.boundingBox())!;

    for (const mode of ["light", "dark"] as const) {
      const toggle = page.getByRole("button", { name: `Switch to ${mode} mode` });
      if (await toggle.count()) await toggle.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);

      await expect(tip).toBeHidden();
      await bell.hover();
      await expect(tip).toBeVisible();
      await expect(tip).toHaveText("Notifications");
      // Readable on the current theme's surface.
      const [fg, bg] = await tip.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
      expect(fg).not.toBe(bg);
      // Moving away hides it.
      await page.mouse.move(5, 300);
      await expect(tip).toBeHidden();
    }

    // Layout and behaviour unchanged.
    const after = (await bell.boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    await expect(bell).toHaveAttribute("href", "/notifications");
    await bell.click();
    await page.waitForURL(/\/notifications$/);
  });
});
