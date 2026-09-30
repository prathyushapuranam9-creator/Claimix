import { expect, test, type Browser, type Page } from "@playwright/test";
import { IDS, signIn } from "./helpers";

const A1_FLOATER = "00000000-0000-4000-8000-0000000003a1";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const REQUIRED = ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"];

async function fillCase(page: Page) {
  await page.getByLabel("Expected admission date").fill("2026-10-15");
  await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
  await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
  await page.getByLabel("Due to an accident?").selectOption("no");
  await page.getByLabel("Pre-existing disease declared?").selectOption("no");
  await page.getByLabel("Estimated cost (₹)").fill("95000");
  await page.getByLabel("Room rent per day (₹)").fill("4000");
}

async function uploadDoc(page: Page, label: string, name = "doc.pdf", body = PDF) {
  await page.getByLabel("Document type").selectOption({ label });
  await page.getByLabel(/^File/).setInputFiles({ name, mimeType: "application/pdf", buffer: body });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
}

async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}

test("eligibility from recorded coverage → Eligible, with a path to pre-auth", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto(`/patients/${IDS.patientA1}`);
  await page.getByRole("link", { name: "Check eligibility" }).first().click();
  await expect(page.getByRole("heading", { name: "Checking Demo Patient Anil" })).toBeVisible();
  await fillCase(page);
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(page.getByRole("heading", { name: "Eligible" })).toBeVisible();
  await expect(page.getByText("Pre-authorization: required before admission")).toBeVisible();
  await expect(page.getByText(/does not guarantee claim approval/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Start pre-authorization with these details" })).toBeVisible();
});

test("insufficient information → Needs verification, never Eligible", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto(`/eligibility?beneficiary=${A1_FLOATER}`);
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(page.getByRole("heading", { name: "Needs verification" })).toBeVisible();
  await expect(page.getByText("Additional verification required").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Eligible", exact: true })).toHaveCount(0);
});

test("full pre-authorization journey: draft → checklist → submit → query → respond → approve", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto(`/eligibility?beneficiary=${A1_FLOATER}`);
  await fillCase(page);
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await page.getByRole("link", { name: "Start pre-authorization with these details" }).click();
  await expect(page.getByLabel("Estimated cost (₹)")).toHaveValue("95000");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
  const url = page.url();

  // Submit is disabled until the checklist is complete.
  await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toBeDisabled();

  // A spoofed file is rejected with a clear message.
  await uploadDoc(page, "Photo ID proof", "id.pdf", Buffer.from("MZ not a pdf"));
  await expect(page.getByText(/isn't a valid PDF, PNG or JPG/)).toBeVisible();

  for (const label of REQUIRED) {
    await uploadDoc(page, label, `${label.replace(/\W+/g, "-")}.pdf`);
    await expect(page.getByText(`${label} uploaded.`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(3 - i);
  }
  await expect(page.getByText("20 of 20")).toBeVisible();
  await page.getByRole("button", { name: "Submit Pre-Authorization" }).click();
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();

  // Insurer B can't see it at all.
  const other = await as(browser, "insurer.b@demo.claimix.invalid");
  expect((await other.page.goto(url))?.status()).toBe(404);
  await other.close();

  // TPA raises a query.
  const tpa = await as(browser, "tpa.a@demo.claimix.invalid");
  await tpa.page.goto(url);
  await tpa.page.getByLabel("Decision").selectOption({ label: "Raise a query" });
  await tpa.page.getByLabel("Reason").selectOption({ label: "Insufficient medical information" });
  await tpa.page.getByLabel("Message to the hospital").fill("Please share the ultrasound report and surgeon's notes.");
  await tpa.page.getByRole("button", { name: "Raise a query" }).click();
  await expect(tpa.page.getByText("Recorded: Query raised.")).toBeVisible();
  const docHref = await tpa.page.getByRole("link", { name: "Download" }).first().getAttribute("href");
  expect((await tpa.page.request.get(docHref!)).status()).toBe(200);
  await tpa.close();

  // Hospital sees the query and responds.
  await page.reload();
  await expect(page.getByText("Query from the payer")).toBeVisible();
  await uploadDoc(page, "Ultrasound", "usg.pdf");
  await page.getByLabel("Response to the payer").fill("Ultrasound report and surgeon notes uploaded.");
  await page.getByRole("button", { name: "Send response" }).click();
  await expect(page.getByText("Query from the payer")).toHaveCount(0);

  // Insurer approves.
  const ins = await as(browser, "insurer.a@demo.claimix.invalid");
  await ins.page.goto(url);
  await ins.page.getByLabel("Decision").selectOption({ label: "Approve" });
  await ins.page.getByLabel("Approved amount (₹)").fill("95000");
  await ins.page.getByRole("button", { name: "Approve" }).click();
  await expect(ins.page.getByText("Recorded: Approved.")).toBeVisible();
  await ins.close();

  await page.reload();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  for (const s of ["Query raised", "Submitted", "Draft"]) await expect(page.getByText(s, { exact: true }).first()).toBeVisible();
  // The evaluation the request was submitted with is kept after later uploads.
  const step = page.getByRole("navigation", { name: "Hospital workflow progress" }).getByRole("listitem").filter({ hasText: "Eligibility & policy active" });
  await expect(step).toContainText("Complete");
});

test("patients see their own pre-auth read-only", async ({ page }) => {
  await signIn(page, "patient.a1@demo.claimix.invalid");
  await page.goto("/pre-authorizations?view=all");
  const first = page.getByRole("link", { name: /^PA-/ }).first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByRole("heading", { name: /Pre-auth PA-/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
  await expect(page.getByLabel("Decision")).toHaveCount(0);
  await expect(page.getByLabel("Document type")).toHaveCount(0);
});

test("unauthenticated document downloads are refused", async ({ request }) => {
  const res = await request.get("/api/documents/00000000-0000-4000-8000-000000000000");
  expect(res.status()).toBe(401);
});
