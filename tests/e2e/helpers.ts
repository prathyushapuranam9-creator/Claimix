import type { Page } from "@playwright/test";

export const PASSWORD = process.env.SEED_DEMO_PASSWORD!;

export const IDS = {
  hospitalA: "00000000-0000-4000-8000-0000000000a1",
  patientA1: "00000000-0000-4000-8000-0000000001a1",
  patientA2: "00000000-0000-4000-8000-0000000001a2",
  patientB1: "00000000-0000-4000-8000-0000000001b1",
};

/** The "Sign in as" option for a fixture account (its portal comes from its organization). */
export function portalRoleFor(email: string): "Hospital Staff" | "Insurance Reviewer" | "Admin" {
  if (/^(insurer|tpa)./.test(email)) return "Insurance Reviewer";
  if (/^(admin|readonly)@/.test(email)) return "Admin";
  return "Hospital Staff";
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByRole("radio", { name: portalRoleFor(email) }).check();
  await page.getByLabel("Email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

export async function openMenuIfCollapsed(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
}

/** Letters-only unique suffix (patient names allow letters only). */
export function alphaId() {
  return Date.now().toString(36).replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)]!);
}

/**
 * Registers a fresh patient at the signed-in hospital and adds family-floater
 * coverage through the UI. Returns the coverage (beneficiary) id.
 */
export async function freshPatientWithCover(page: Page, balance = "400000") {
  const suffix = alphaId();
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(`Journey Patient ${suffix}`);
  await page.getByLabel("Date of birth").fill("1984-05-05");
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Add coverage" }).click();
  await page.getByLabel("Policy / scheme").selectOption({ label: "Aarogya Family Floater Plus (DEMO DATA)" });
  await page.getByLabel("Member / beneficiary ID").fill(`E2E-${suffix}`.toUpperCase());
  await page.getByLabel("First inception date").fill("2021-04-01");
  await page.getByLabel("Cover start").fill("2026-04-01");
  await page.getByLabel("Cover end").fill("2027-03-31");
  await page.getByLabel("Sum insured (₹)").fill("500000");
  await page.getByLabel("Available balance (₹)").fill(balance);
  await page.getByRole("button", { name: "Save coverage" }).click();
  const link = page.getByRole("link", { name: "Check eligibility" }).first();
  await link.waitFor();
  const href = await link.getAttribute("href");
  return new URL(href!, "http://x").searchParams.get("beneficiary")!;
}
