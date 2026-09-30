import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const A1_FLOATER = "00000000-0000-4000-8000-0000000003a1";
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

/** Submits a complete pre-auth for patient A1 and returns its URL. */
async function submittedPreauth(page: Page) {
  await page.goto(`/pre-authorizations/new?beneficiary=${A1_FLOATER}&claimType=cashless&admissionDate=2026-10-20&isAccident=no&pedDeclared=no&estimatedCost=60000&roomRentPerDay=4000`);
  await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
  await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
  for (const l of ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"]) await upload(page, l);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(3 - i);
  }
  await page.getByRole("button", { name: "Submit Pre-Authorization" }).click();
  // The checklist (and its message) disappears once submitted; wait for the durable state instead.
  await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
  await expect(page.locator("#main").getByText("Submitted", { exact: true }).first()).toBeVisible();
  return page.url();
}

test("payer asks for a re-upload → hospital is notified, sees the reason, and re-uploads", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff.a@demo.claimix.invalid");
  const url = await submittedPreauth(page);

  const ins = await as(browser, "insurer.a@demo.claimix.invalid");
  await ins.page.goto(url);
  const row = ins.page.getByRole("row").filter({ hasText: "Insurance / health card" });
  await row.getByRole("button", { name: "Review" }).click();
  await row.getByLabel("Review outcome").selectOption("requires_reupload");
  await row.getByLabel("Reason").fill("Card photo is blurred; please rescan.");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("Re-upload needed")).toBeVisible();
  await ins.close();

  // Hospital: bell shows unread, notification links to the request.
  await page.goto("/notifications?show=unread");
  const note = page.getByRole("link", { name: /Insurance \/ health card: re-upload required/ }).first();
  await expect(note).toBeVisible();
  await note.click();
  await expect(page).toHaveURL(url);
  await expect(page.getByText("Card photo is blurred; please rescan.")).toBeVisible();
  await upload(page, "Insurance / health card");
});

test("notifications: unread badge and mark all as read", async ({ page }) => {
  await signIn(page, "insurer.a@demo.claimix.invalid");
  await page.goto("/notifications");
  const markAll = page.getByRole("button", { name: "Mark all as read" });
  if (await markAll.isEnabled()) {
    await markAll.click();
    await expect(page.getByText("0 unread")).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Notifications", exact: true }).first()).toBeVisible();
});

test("documents page lists requests missing mandatory documents", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: /Missing documents/ })).toBeVisible();
});

test("audit log: admin can filter; others are refused", async ({ page, browser }) => {
  await signIn(page, "admin@demo.claimix.invalid");
  await page.goto("/audit?action=auth.login");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByText("auth.login", { exact: true }).first()).toBeVisible();
  const staff = await as(browser, "staff.a@demo.claimix.invalid");
  await staff.page.goto("/audit");
  await expect(staff.page).toHaveURL(/\/forbidden/);
  await staff.close();
});
