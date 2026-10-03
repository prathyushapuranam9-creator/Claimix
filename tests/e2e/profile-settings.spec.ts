import { expect, test, type Page } from "@playwright/test";
import { alphaId, PASSWORD, signIn } from "./helpers";

const EMAIL = "tpa.a@demo.claimix.invalid";
const card = (page: Page) => page.locator("main section").filter({ has: page.getByRole("heading", { name: "Your details" }) });
/** The Change Password button in the Profile Settings page header (top right). */
const changePasswordBtn = (page: Page) => page.getByRole("button", { name: "Change Password" });
/** The Change Password form card: only on the page while the form is open. */
const passwordCard = (page: Page) => page.getByRole("dialog", { name: "Change Password" });
const isAction = (method: string, headers: Record<string, string>) => method === "POST" && "next-action" in headers;

async function saveName(page: Page, name: string) {
  await card(page).getByRole("button", { name: "Edit" }).click();
  await card(page).getByLabel("Name").fill(name);
  await card(page).getByRole("button", { name: "Save" }).click();
  await expect(card(page)).toContainText("Profile updated successfully.");
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Profile menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign Out" }).click();
  await page.waitForURL(/\/login/);
}

test.describe("Profile Settings: edit and save", () => {
  test.describe.configure({ mode: "serial" });
  // These change real fixture accounts, so only one project runs them (no desktop/mobile race).
  test.beforeEach(({ page: _page }, info) => test.skip(info.project.name !== "desktop", "Mutates shared accounts; runs once."));

  test("read-only by default; edit, cancel, validation, failed save, then a real save that persists", async ({ page }) => {
    await signIn(page, EMAIL);
    await page.goto("/profile");
    const original = (await page.locator("aside [class*=userName]").textContent())!.trim();

    // Default: the session user's details, read-only, with Edit.
    await expect(card(page)).toContainText(original);
    await expect(card(page)).toContainText(EMAIL);
    await expect(card(page).getByRole("textbox")).toHaveCount(0);
    for (const label of ["Name", "Email", "Role", "Organization", "Status"]) await expect(card(page).getByText(label, { exact: true })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Edit" })).toBeVisible();

    let calls = 0;
    let fail = false;
    await page.route("**/profile", async (route) => {
      const r = route.request();
      if (isAction(r.method(), r.headers())) {
        calls++;
        if (fail) return route.abort();
        await new Promise((res) => setTimeout(res, 800));
      }
      await route.continue();
    });

    try {
      // Edit: Name and Email are editable; role / organization / status stay read-only.
      await card(page).getByRole("button", { name: "Edit" }).click();
      await expect(card(page).getByRole("textbox")).toHaveCount(2);
      await expect(card(page).getByLabel("Name")).toHaveValue(original);
      await expect(card(page).getByLabel("Email")).toHaveValue(EMAIL);
      await expect(card(page).getByLabel("Current password")).toHaveCount(0);
      await expect(card(page)).toContainText("Role, organization and account status are managed by an administrator.");
      await expect(card(page).getByRole("button", { name: "Save" })).toBeVisible();
      await expect(card(page).getByRole("button", { name: "Cancel" })).toBeVisible();

      // Cancel discards changes and sends nothing.
      await card(page).getByLabel("Name").fill("Should Not Persist");
      await card(page).getByRole("button", { name: "Cancel" }).click();
      await expect(card(page).getByRole("textbox")).toHaveCount(0);
      await expect(card(page)).toContainText(original);
      await expect(card(page)).not.toContainText("Should Not Persist");
      expect(calls).toBe(0);

      // Invalid input: error next to the field, still editing, nothing sent.
      await card(page).getByRole("button", { name: "Edit" }).click();
      await card(page).getByLabel("Name").fill("A");
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page)).toContainText("Enter at least 2 characters.");
      await expect(card(page).getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
      expect(calls).toBe(0);

      // A failed save: error shown, still editing, entered value kept, no success message.
      fail = true;
      await card(page).getByLabel("Name").fill("Network Failure Name");
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page)).toContainText("Unable to update profile. Please try again.");
      await expect(card(page).getByLabel("Name")).toHaveValue("Network Failure Name");
      await expect(card(page)).not.toContainText("Profile updated successfully.");
      fail = false;

      // A real save: Saving... (disabled), success, updated everywhere, persists after reload.
      const updated = `${original} ${alphaId()}`;
      await card(page).getByLabel("Name").fill(updated);
      const before = calls;
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page).getByRole("button", { name: "Saving..." })).toBeDisabled();
      await expect(card(page)).toContainText("Profile updated successfully.");
      expect(calls).toBe(before + 1);
      await expect(card(page).getByRole("textbox")).toHaveCount(0);
      await expect(card(page)).toContainText(updated);
      await expect(page.getByRole("button", { name: /^Profile menu/ })).toContainText(updated);
      await expect(page).toHaveURL(/\/profile$/);

      await page.reload();
      await expect(card(page)).toContainText(updated);
    } finally {
      // Put the fixture account back.
      await page.unroute("**/profile");
      await page.goto("/profile");
      await saveName(page, original);
    }
  });

  test("changing the email needs the current password; the new email signs in", async ({ page }) => {
    await signIn(page, EMAIL);
    await page.goto("/profile");
    const next = `tpa.a.${alphaId().toLowerCase()}@demo.claimix.invalid`;
    let current = EMAIL;
    try {
      await card(page).getByRole("button", { name: "Edit" }).click();
      await card(page).getByLabel("Email").fill("not-an-email");
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page)).toContainText("Enter a valid email address.");

      await card(page).getByLabel("Email").fill(next);
      const pw = card(page).getByLabel("Current password");
      await expect(pw).toBeVisible();
      await expect(pw).toHaveAttribute("type", "password");
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page)).toContainText("Enter your current password to change your email.");

      await pw.fill("definitely-wrong-1");
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page)).toContainText("Your current password is incorrect.");
      await expect(card(page).getByLabel("Email")).toHaveValue(next);

      await pw.fill(PASSWORD);
      await card(page).getByRole("button", { name: "Save" }).click();
      await expect(card(page)).toContainText("Profile updated successfully.");
      current = next;
      await expect(card(page)).toContainText(next);

      // Persisted: sign out, sign in with the new email.
      await signOut(page);
      await signIn(page, next);
      await page.goto("/profile");
      await expect(card(page)).toContainText(next);
    } finally {
      if (current !== EMAIL) {
        await page.goto("/profile");
        await card(page).getByRole("button", { name: "Edit" }).click();
        await card(page).getByLabel("Email").fill(EMAIL);
        await card(page).getByLabel("Current password").fill(PASSWORD);
        await card(page).getByRole("button", { name: "Save" }).click();
        await expect(card(page)).toContainText("Profile updated successfully.");
      }
    }
  });

  test("Change Password: validation, wrong current password, success, then sign in with the new password", async ({ page }) => {
    const ACCOUNT = "patient.b1@demo.claimix.invalid";
    const NEXT = `Changed-${alphaId()}-9876`;
    await signIn(page, ACCOUNT);
    await page.goto("/profile");
    let changed = false;
    // Labels carry a required marker, so match from the start of the label.
    const field = (label: string) => passwordCard(page).getByLabel(new RegExp(`^${label}`));
    const open = () => changePasswordBtn(page).click();
    try {
      // The button sits in the page header beside the title, and is the only one.
      await expect(changePasswordBtn(page)).toHaveCount(1);
      const title = (await page.getByRole("heading", { level: 1, name: "Profile Settings" }).boundingBox())!;
      const btn = (await changePasswordBtn(page).boundingBox())!;
      expect(btn.y).toBeLessThan(title.y + title.height + 40);
      await expect(changePasswordBtn(page)).toHaveAttribute("aria-haspopup", "dialog");
      // No standing Password section: nothing about passwords until the button is clicked.
      await expect(passwordCard(page)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Password", exact: true })).toHaveCount(0);
      await open();
      // A modal popup over the page: the page behind it can't be used meanwhile.
      await expect(passwordCard(page)).toBeVisible();
      expect(await passwordCard(page).evaluate((d) => (d as HTMLDialogElement).open && d.matches(":modal"))).toBe(true);
      await expect(page).toHaveURL(/\/profile$/);
      // The cursor goes straight to the first field.
      await expect(passwordCard(page).getByLabel(/^Current password/)).toBeFocused();
      for (const label of ["Current password", "New password", "Confirm new password"]) await expect(field(label)).toHaveAttribute("type", "password");
      const save = passwordCard(page).getByRole("button", { name: "Save password" });

      // Password rules, then a mismatch (checked before anything is sent).
      await field("Current password").fill(PASSWORD);
      await field("New password").fill("short");
      await field("Confirm new password").fill("short");
      await save.click();
      await expect(passwordCard(page)).toContainText("Use at least 12 characters.");
      await field("New password").fill(NEXT);
      await field("Confirm new password").fill(`${NEXT}x`);
      await save.click();
      await expect(passwordCard(page)).toContainText("Passwords do not match.");

      // Server: wrong current password.
      await field("Current password").fill("definitely-wrong-1");
      await field("Confirm new password").fill(NEXT);
      await save.click();
      await expect(passwordCard(page)).toContainText("Your current password is incorrect.");

      // Success: message, form closed, the password never shown on the page.
      await field("Current password").fill(PASSWORD);
      await save.click();
      await expect(page.getByRole("main")).toContainText("Password changed successfully.");
      changed = true;
      await expect(passwordCard(page)).toHaveCount(0);
      expect(await page.content()).not.toContain(NEXT);

      // Still signed in here; after signing out, the new password works.
      await page.reload();
      await expect(page).toHaveURL(/\/profile$/);
      await signOut(page);
      await signIn(page, ACCOUNT, NEXT);
    } finally {
      if (changed) {
        // Put the fixture password back.
        await page.goto("/profile");
        await open();
        await field("Current password").fill(NEXT);
        await field("New password").fill(PASSWORD);
        await field("Confirm new password").fill(PASSWORD);
        await passwordCard(page).getByRole("button", { name: "Save password" }).click();
        await expect(page.getByRole("main")).toContainText("Password changed successfully.");
      }
    }
  });
});

test("Profile Settings edit form and Change Password popup fit small screens", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "Layout check for the mobile project.");
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto("/profile");
  const vw = page.viewportSize()!.width;

  await card(page).getByRole("button", { name: "Edit" }).click();
  await card(page).getByLabel("Email").fill("someone.else@demo.claimix.invalid");
  await expect(card(page).getByLabel("Current password")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const save = (await card(page).getByRole("button", { name: "Save" }).boundingBox())!;
  expect(save.x + save.width).toBeLessThanOrEqual(vw + 1);
  await card(page).getByRole("button", { name: "Cancel" }).click(); // nothing saved
  await expect(card(page)).toContainText("staff.a@demo.claimix.invalid");

  // The popup fits the screen; Escape closes it without saving.
  await changePasswordBtn(page).click();
  const box = (await passwordCard(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
  const btn = (await passwordCard(page).getByRole("button", { name: "Save password" }).boundingBox())!;
  expect(btn.x + btn.width).toBeLessThanOrEqual(vw + 1);
  await page.keyboard.press("Escape");
  await expect(passwordCard(page)).toHaveCount(0);

  // Cancel closes it too.
  await changePasswordBtn(page).click();
  await passwordCard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(passwordCard(page)).toHaveCount(0);
});
