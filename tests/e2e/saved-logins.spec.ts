import { expect, test, type Page } from "@playwright/test";
import { PASSWORD } from "./helpers";

const STAFF_B = "staff.b@demo.claimix.invalid";

/** Stands in for the browser's password manager (Credential Management API). */
async function fakePasswordManager(page: Page, saved: { id: string; password: string } | null) {
  await page.addInitScript((cred) => {
    (window as unknown as { PasswordCredential: unknown }).PasswordCredential = class {
      id: string; password: string; type = "password";
      constructor(d: { id: string; password: string }) { this.id = d.id; this.password = d.password; }
    };
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { store: async (c: unknown) => c, get: async () => (cred ? { ...cred, type: "password" } : null) },
    });
  }, saved);
}

async function signInOnce(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  await page.context().clearCookies(); // signed out, but this device remembers the account
}

test("focusing the email field lists saved accounts; choosing one fills email and masked password", async ({ page }) => {
  await fakePasswordManager(page, { id: STAFF_B, password: PASSWORD });
  await signInOnce(page, STAFF_B);

  await page.goto("/login");
  await page.locator("#email").click();
  const list = page.getByRole("listbox", { name: "Saved accounts" });
  await expect(list).toBeVisible();
  await expect(page.locator("#email")).toHaveAttribute("aria-expanded", "true");
  const option = list.getByRole("option", { name: new RegExp(STAFF_B.replace(/\./g, "\.")) });
  await expect(option).toBeVisible();
  await expect(option).toContainText("••••");
  await expect(page.getByText(PASSWORD)).toHaveCount(0); // never shown in plain text

  await option.click();
  await expect(list).toBeHidden();
  await expect(page.locator("#email")).toHaveValue(STAFF_B);
  await expect(page.locator("#password")).toHaveValue(PASSWORD);
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Only the email is kept on the device.
  const stored = await page.evaluate(() => localStorage.getItem("claimix.rememberedAccounts") ?? "");
  expect(stored).toContain(STAFF_B);
  expect(stored).not.toContain(PASSWORD);
});

test("keyboard: arrow keys and Enter choose an account; Escape closes; typing filters", async ({ page }) => {
  await fakePasswordManager(page, { id: STAFF_B, password: PASSWORD });
  await signInOnce(page, STAFF_B);
  await page.goto("/login");
  const email = page.locator("#email");
  await email.focus();
  await expect(page.getByRole("listbox", { name: "Saved accounts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Saved accounts" })).toBeHidden();
  await email.fill("zzz");
  await expect(page.getByRole("listbox", { name: "Saved accounts" })).toBeHidden();
  await email.fill("staff");
  await page.keyboard.press("ArrowDown");
  await expect(email).toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("Enter");
  await expect(email).toHaveValue(STAFF_B);
  await expect(page.locator("#password")).toHaveValue(PASSWORD);
});

test("without browser password support, choosing an account fills the email and moves to the password", async ({ page }) => {
  await signInOnce(page, STAFF_B);
  await page.addInitScript(() => { delete (window as unknown as { PasswordCredential?: unknown }).PasswordCredential; });
  await page.goto("/login");
  await page.locator("#email").click();
  await page.getByRole("option", { name: /staff\.b@demo\.claimix\.invalid/ }).click();
  await expect(page.locator("#email")).toHaveValue(STAFF_B);
  await expect(page.locator("#password")).toBeFocused();
  await expect(page.locator("#password")).toHaveValue("");
});

test("saved accounts can be forgotten on this device; nothing is listed before any sign-in", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").click();
  await expect(page.getByRole("listbox", { name: "Saved accounts" })).toBeHidden();

  await signInOnce(page, STAFF_B);
  await page.goto("/login");
  await page.locator("#email").click();
  await page.getByRole("button", { name: "Forget saved accounts on this device" }).click();
  await expect(page.getByRole("listbox", { name: "Saved accounts" })).toBeHidden();
  await page.locator("#email").blur();
  await page.locator("#email").click();
  await expect(page.getByRole("listbox", { name: "Saved accounts" })).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("claimix.rememberedAccounts"))).toBeNull();
});
