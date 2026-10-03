import { expect, test, type Page } from "@playwright/test";
import { alphaId, IDS, signIn } from "./helpers";

const panel = (page: Page) => page.locator("#eligibility-result");
const toggle = (page: Page) => page.getByRole("button", { name: /^Eligibility Check/ });
const isAction = (method: string, headers: Record<string, string>) => method === "POST" && "next-action" in headers;

/** Counts eligibility server-action requests, optionally slowing them so the loading state is visible. */
async function trackChecks(page: Page, delayMs = 0) {
  const counter = { calls: 0 };
  await page.route("**/patients/*", async (route) => {
    const r = route.request();
    if (isAction(r.method(), r.headers())) {
      counter.calls++;
      if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    }
    await route.continue();
  });
  return counter;
}

test.describe("Patient profile: Eligibility Check (expand / collapse)", () => {
  test("closed by default; opening checks this patient in place; closing hides it; reopening reuses the result", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    // Existing header action is kept.
    await expect(page.getByRole("link", { name: "Edit details" })).toBeVisible();

    // Initial: ▾, collapsed, result hidden, nothing requested.
    await expect(toggle(page)).toHaveText(/Eligibility Check\s*▾/);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();

    const t = await trackChecks(page, 1500);
    await toggle(page).click();
    await expect(toggle(page)).toHaveText(/Eligibility Check\s*▴/);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText("Checking eligibility...");
    // "Check again" is disabled while a check runs, so it can't send a second request.
    await expect(panel(page).getByRole("button", { name: "Check again" })).toBeDisabled();

    const details = panel(page).getByTestId("eligibility-details");
    await expect(details).toBeVisible();
    await expect(details).toContainText("Demo Patient Anil");
    for (const label of ["Patient", "Insurance", "Policy", "Member ID", "Coverage Status", "Eligibility Status", "Effective Date", "Expiry Date", "Checked At"]) {
      await expect(details.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(details).toContainText(/Eligible|Not Eligible|Expired|Unable to Verify/);
    expect(t.calls).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/patients/${IDS.patientA1}$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Second click: ▾ and hidden.
    await toggle(page).click();
    await expect(toggle(page)).toHaveText(/Eligibility Check\s*▾/);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();

    // Reopen: the existing result is shown again without a new request.
    await toggle(page).click();
    await expect(details).toBeVisible();
    const first = await details.locator("time").getAttribute("datetime");
    expect(t.calls).toBe(1);

    // Check again: a fresh check with a new Checked At.
    await panel(page).getByRole("button", { name: "Check again" }).click();
    await expect(details.locator("time")).not.toHaveAttribute("datetime", first!);
    expect(t.calls).toBe(2);
  });

  test("toggling quickly while a check is running sends only one request", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    const t = await trackChecks(page, 1500);
    await toggle(page).click();
    await toggle(page).click();
    await toggle(page).click();
    await expect(panel(page).getByTestId("eligibility-details")).toBeVisible();
    expect(t.calls).toBe(1);
  });

  test("a failed check shows the error inside the panel", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    await page.route("**/patients/*", (route) => (isAction(route.request().method(), route.request().headers()) ? route.abort() : route.continue()));
    await toggle(page).click();
    await expect(panel(page)).toContainText("Unable to verify eligibility. Please try again.");
    await expect(panel(page).getByTestId("eligibility-details")).toHaveCount(0);
  });

  test("no insurance: a message and the add-coverage link, with no request sent; another patient starts clean", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    await toggle(page).click();
    await expect(panel(page).getByTestId("eligibility-details")).toContainText("Demo Patient Anil");

    const name = `Eligibility Empty ${alphaId()}`;
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page.getByRole("button", { name: "Register patient" }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);

    // The new patient's profile starts collapsed, with nothing from the previous patient.
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
    await expect(panel(page)).not.toContainText("Demo Patient Anil");

    const t = await trackChecks(page);
    await toggle(page).click();
    await expect(panel(page)).toContainText("No insurance information available for this patient.");
    await expect(panel(page).getByRole("link", { name: "Add coverage" })).toHaveAttribute("href", "#add-coverage");
    expect(t.calls).toBe(0);
  });

  test("insurer reviewer: checks its own policy on the profile, in place", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    await toggle(page).click();
    const details = panel(page).getByTestId("eligibility-details");
    await expect(details).toContainText("Demo Patient Anil");
    await expect(details).toContainText(/Eligible|Not Eligible|Expired|Unable to Verify/);
    await expect(page).toHaveURL(new RegExp(`/patients/${IDS.patientA1}$`));
  });

  test("patient portal users don't get the button", async ({ page }) => {
    await signIn(page, "patient.a1@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });
});
