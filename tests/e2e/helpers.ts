import type { Page } from "@playwright/test";

export const PASSWORD = process.env.SEED_DEMO_PASSWORD!;

export const IDS = {
  hospitalA: "00000000-0000-4000-8000-0000000000a1",
  patientA1: "00000000-0000-4000-8000-0000000001a1",
  patientA2: "00000000-0000-4000-8000-0000000001a2",
  patientB1: "00000000-0000-4000-8000-0000000001b1",
};

/** Signs in with email and password only; the account decides its own portal. */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Patient and read-only users have no dashboard and land on their first page instead.
  await page.waitForURL(/\/(dashboard|patients|hospitals)/);
}

export async function openMenuIfCollapsed(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
}

/** Letters-only unique suffix (patient names allow letters only). */
export function alphaId() {
  return Date.now().toString(36).replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)]!);
}

export interface RegisterOptions {
  name: string;
  dob?: string;
  /** Option label, e.g. "Female". Left alone when omitted. */
  gender?: string;
  phone?: string;
  email?: string;
  patientNo?: string;
  /** Department recorded on the patient (step 1), by label. */
  department?: string;
  reason?: string;
  /** Visit type label, e.g. "IP admission". */
  visitType?: string;
  /** Department to book in (step 2), by label. Defaults to General Medicine. */
  bookIn?: string;
  /** "Cash" | "UPI" | "Card", or "later" to leave the payment to be collected. */
  payment?: "Cash" | "UPI" | "Card" | "later";
  /** Confirms the "may already be registered" warning and registers a namesake anyway. */
  confirmDuplicate?: boolean;
  /** Registers through "Register New ABHA" and fills these; the default path uses no ABHA. */
  abha?: { number: string; address?: string };
}

/**
 * Picks the first free slot for the chosen doctor, moving to the next day when a day is full (a long
 * run books many slots). Returns false when nothing is bookable within the opened days.
 */
async function pickFreeSlot(page: Page): Promise<boolean> {
  const date = page.getByLabel("Booking date");
  for (let i = 0; i < 14; i++) {
    const free = page.locator('button[data-state="free"]');
    if (await free.count()) {
      await free.first().click();
      return true;
    }
    const current = await date.inputValue();
    const next = new Date(`${current}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    await date.fill(next.toISOString().slice(0, 10));
    await page.waitForTimeout(400);
  }
  return false;
}

/**
 * Registers a patient through the three-step front-desk wizard and returns the new patient's path.
 * The patient only exists once the final step completes, so this walks all three steps.
 */
export async function registerPatient(page: Page, o: RegisterOptions): Promise<string> {
  await page.goto("/patients/new");

  // Step 1 — identify & details. The entry screen offers the two registration methods.
  await page.getByRole("button", { name: o.abha ? "Register New ABHA" : "Register Without ABHA ID" }).click();
  await page.getByLabel("Full name").fill(o.name);
  await page.getByLabel("Date of birth").fill(o.dob ?? "1984-05-05");
  if (o.gender) await page.getByLabel("Gender").selectOption({ label: o.gender });
  if (o.patientNo) await page.getByLabel("Hospital patient number").fill(o.patientNo);
  if (o.department) await page.getByLabel("Department").selectOption({ label: o.department });
  if (o.reason) await page.getByLabel("Reason for visit").fill(o.reason);
  if (o.phone) await page.getByLabel("Mobile number").fill(o.phone);
  if (o.email) await page.getByLabel("Email").fill(o.email);
  if (o.abha) {
    await page.getByLabel("ABHA number").fill(o.abha.number);
    if (o.abha.address) await page.getByLabel("ABHA address").fill(o.abha.address);
  }
  if (o.visitType) await page.getByLabel("Visit type").selectOption({ label: o.visitType });
  await page.getByRole("button", { name: "Continue to doctor & slot" }).click();

  // Step 2 — doctor & slot.
  await page.getByLabel("Department").selectOption({ label: o.bookIn ?? "General Medicine" });
  await page.getByLabel("Doctor").selectOption({ index: 1 });
  if (!(await pickFreeSlot(page))) throw new Error("no free appointment slot in the fixtures");
  await page.getByRole("button", { name: "Continue to payment" }).click();

  // Step 3 — payment, consent, register.
  // A doctor with no configured fee has nothing to collect, and then no method is offered.
  const hasMethods = await page.getByRole("radio", { name: "Cash" }).count();
  if (hasMethods) {
    if (o.payment === "later") await page.getByLabel("Collect the payment later").check();
    else await page.getByRole("radio", { name: o.payment ?? "Cash" }).check();
  }
  await page.getByLabel(/^I confirm the above was explained/).check();
  await page.getByRole("button", { name: "Register patient" }).click();
  if (o.confirmDuplicate) await page.getByRole("button", { name: "Register as a new patient anyway" }).click();

  await page.getByText("Patient registered successfully.").waitFor();
  await page.getByRole("link", { name: "Open patient" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}
