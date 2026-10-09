import { expect, test, type Browser, type Page } from "@playwright/test";
import { freshPatientWithCover, signIn } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");

async function upload(page: Page, label: string) {
  await page.getByLabel("Document type").selectOption({ label });
  await page.getByLabel(/^File/).setInputFiles({ name: `${label.replace(/\W+/g, "-")}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(`${label} uploaded.`)).toBeVisible();
}

async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}

async function confirmAll(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(count - 1 - i);
  }
}

/** Approved cashless pre-auth for patient A1 via the UI, returning its URL. */
async function approvedPreauth(page: Page, browser: Browser) {
  // A fresh patient per run: settlements use up the balance of shared demo coverage.
  const beneficiary = await freshPatientWithCover(page);
  await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}&claimType=cashless&admissionDate=2026-09-20&isAccident=no&pedDeclared=no&estimatedCost=80000&roomRentPerDay=4000`);
  await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
  await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
  const url = page.url();
  for (const l of ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"]) await upload(page, l);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  await confirmAll(page, 4);
  await page.getByRole("button", { name: "Submit Pre-Authorization" }).click();
  // The checklist (and its message) disappears once submitted; wait for the durable state instead.
  await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
  await expect(page.locator("#main").getByText("Submitted", { exact: true }).first()).toBeVisible();
  const ins = await as(browser, "insurer.a@demo.claimix.invalid");
  await ins.page.goto(url);
  await ins.page.getByLabel("Decision").selectOption({ label: "Approve" });
  await ins.page.getByLabel("Approved amount (₹)").fill("80000");
  await ins.page.getByRole("button", { name: "Approve" }).click();
  await expect(ins.page.getByText("Recorded: Approved.")).toBeVisible();
  await ins.close();
  return url;
}

test("cashless claim: create from pre-auth → checklist → submit → partial approval → settlement", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, "staff.a@demo.claimix.invalid");
  const preauthUrl = await approvedPreauth(page, browser);

  await page.goto(preauthUrl);
  await page.getByRole("link", { name: "Start final claim" }).click();
  await expect(page.getByRole("heading", { name: "New cashless claim" })).toBeVisible();
  await page.getByLabel("Discharge date").fill("2026-09-23");
  await page.getByLabel("Final bill number").fill("SUN-BILL-7781");
  await page.getByLabel("Final bill amount (₹)").fill("76000");
  await page.getByRole("button", { name: "Create claim draft" }).click();
  await expect(page).toHaveURL(/\/claims\/[0-9a-f-]{36}$/);
  const claimUrl = page.url();

  await expect(page.getByRole("button", { name: "Submit claim" })).toBeDisabled();
  for (const l of ["Final itemised bill", "Discharge summary", "Pharmacy bills"]) await upload(page, l);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  await confirmAll(page, 2);
  await page.getByRole("button", { name: "Submit claim" }).click();
  // The checklist is only shown on drafts, so check the status instead.
  await expect(page.locator("#main").getByText("Submitted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit claim" })).toHaveCount(0);

  // Insurer B can't see it; TPA partially approves.
  const other = await as(browser, "insurer.b@demo.claimix.invalid");
  expect((await other.page.goto(claimUrl))?.status()).toBe(404);
  await other.close();
  const tpa = await as(browser, "tpa.a@demo.claimix.invalid");
  await tpa.page.goto(claimUrl);
  await tpa.page.getByLabel("Decision").selectOption({ label: "Partially approve" });
  await tpa.page.getByLabel("Approved amount (₹)").fill("70000");
  await tpa.page.getByLabel("Remarks").fill("Consumables and registration charges are non-payable.");
  await tpa.page.getByRole("button", { name: "Partially approve" }).click();
  await expect(tpa.page.getByText("Recorded: Partially approved.")).toBeVisible();
  // TPAs assess but don't settle.
  await expect(tpa.page.getByRole("heading", { name: "Record settlement" })).toHaveCount(0);
  await tpa.close();

  // Insurer records the payment.
  const ins = await as(browser, "insurer.a@demo.claimix.invalid");
  await ins.page.goto(claimUrl);
  await ins.page.getByLabel("UTR / payment reference").fill("UTR20260929001");
  await ins.page.getByRole("button", { name: "Record settlement" }).click();
  await expect(ins.page.getByRole("heading", { name: "Record settlement" })).toHaveCount(0);
  await expect(ins.page.getByText("UTR20260929001").first()).toBeVisible();
  await ins.close();

  await page.reload();
  await expect(page.getByText("UTR20260929001").first()).toBeVisible();
  await expect(page.locator("#main").getByRole("paragraph").filter({ hasText: "Cashless" }).getByText("Settled", { exact: true })).toBeVisible();
  await expect(page.getByText("₹6,000").first()).toBeVisible(); // patient pays 76,000 − 70,000
  await page.goto(preauthUrl);
  await expect(page.locator("#main").getByRole("paragraph").first().getByText("Settled", { exact: true })).toBeVisible();
});

test("claims list filters, and CSV export is scoped", async ({ page }) => {
  await signIn(page, "insurer.a@demo.claimix.invalid");
  await page.goto("/claims?view=all");
  await expect(page.getByRole("heading", { name: "Claims" })).toBeVisible();
  await page.getByText("More filters").click();
  await page.getByLabel("Claim type").selectOption("reimbursement");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/type=reimbursement/);
  // Active secondary filters keep the section open and are counted.
  await expect(page.getByText("More filters (1 active)")).toBeVisible();
  const res = await page.request.get("/api/claims/export?view=all");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv).toContain("Claim ID");
  expect(csv).not.toContain("Suraksha Health Insurance");
});

test("rejection & query reasons explain meaning, what to check and the action", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto("/rejection-reasons?kind=rejection");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Waiting period", exact: true }) });
  await expect(card).toBeVisible();
  for (const t of ["What it means", "What to check", "Required action"]) await expect(card.getByText(t)).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
});

test("read-only users can't export claims", async ({ page }) => {
  await signIn(page, "readonly@demo.claimix.invalid");
  expect((await page.request.get("/api/claims/export")).status()).toBe(403);
});
