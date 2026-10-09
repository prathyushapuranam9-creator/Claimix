import { expect, test, type Page } from "@playwright/test";
import { alphaId, registerPatient, signIn } from "./helpers";

const details = (page: Page) => page.locator("main section").filter({ has: page.getByRole("heading", { name: "Details", exact: true }) });
const policyBlock = (page: Page) => page.locator("details[data-patient-id]");

/** Value shown for a label in a <dl> (Details component). */
const valueOf = (scope: ReturnType<Page["locator"]>, label: string) => scope.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

async function register(page: Page, name: string, dept?: string, reason?: string) {
  const path = await registerPatient(page, { name, dob: "1985-06-15", department: dept, reason });
  return path.split("/").pop()!;
}

test.describe("Patients: Department and Reason for Visit", () => {
  test("recorded values show identically in the list and Details; edits carry through", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    const name = `Dept Check ${alphaId()}`;
    const id = await register(page, name, "Neurology", "Headache and dizziness");

    // Profile → Details.
    await expect(valueOf(details(page), "Name")).toHaveText(name);
    await expect(valueOf(details(page), "Department")).toHaveText("Neurology");
    await expect(valueOf(details(page), "Reason for Visit")).toHaveText("Headache and dizziness");
    // Policy Check belongs to the insurance side, which the front desk does not have.
    await expect(policyBlock(page)).toHaveCount(0);

    // Patients list: Department column (existing columns kept, search still works).
    await page.goto(`/patients?q=${encodeURIComponent(name)}`);
    const table = page.getByRole("table", { name: "Patients" });
    for (const h of ["Patient", "Age / Gender", "Department", "Registered"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
    const row = table.getByRole("row").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Neurology");

    // Edit: change both; the form is pre-filled and the new values show everywhere.
    await page.goto(`/patients/${id}/edit`);
    await expect(page.getByLabel("Department")).toHaveValue("neurology");
    await expect(page.getByLabel("Reason for visit")).toHaveValue("Headache and dizziness");
    await page.getByLabel("Department").selectOption({ label: "Cardiology" });
    await page.getByLabel("Reason for visit").fill("Chest pain while walking");
    await page.getByRole("button", { name: /Save/ }).click();
    await page.waitForURL(new RegExp(`/patients/${id}$`));
    await expect(valueOf(details(page), "Department")).toHaveText("Cardiology");
    await expect(valueOf(details(page), "Reason for Visit")).toHaveText("Chest pain while walking");
    await page.goto(`/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Cardiology");
  });

  test("a patient without them shows Not Assigned / Not Available, never another patient's values", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    const name = `Dept Empty ${alphaId()}`;
    await register(page, name);
    await expect(valueOf(details(page), "Department")).toHaveText("Not Assigned");
    await expect(valueOf(details(page), "Reason for Visit")).toHaveText("Not Available");
    await expect(policyBlock(page)).toHaveCount(0);
    await page.goto(`/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Not Assigned");
  });
});

test("Back icon: exactly one tooltip, \"Back\", in light and dark mode", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto("/patients");
  await page.getByRole("table", { name: "Patients" }).getByRole("link").first().click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
  const back = page.getByRole("button", { name: "Back" });
  // No native title tooltip — only the styled one.
  await expect(back).not.toHaveAttribute("title");
  for (const mode of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${mode} mode` });
    if (await toggle.count()) await toggle.click();
    await back.hover();
    const tip = await back.evaluate((el) => {
      const s = getComputedStyle(el, "::after");
      return { text: s.content, opacity: s.opacity, color: s.color, bg: s.backgroundColor };
    });
    expect(tip.text).toBe('"Back"');
    expect(tip.color).not.toBe(tip.bg);
    await page.mouse.move(600, 500);
  }
  // Still navigates back to the list.
  await back.click();
  await expect(page).toHaveURL(/\/patients$/);
});
