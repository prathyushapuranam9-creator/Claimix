import { expect, test, type Browser, type Page } from "@playwright/test";
import { alphaId, freshPatientWithCover, signIn } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const DOCS = ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"];

async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}

/** The dashboard's "Pre-auths awaiting decision" number, read from the page. */
async function awaiting(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByText("Pre-auths awaiting decision")).toBeVisible();
  const text = (await page.locator("#main").innerText()).replace(/\s+/g, " ");
  const m = text.match(/Pre-auths awaiting decision (\d+)/i) ?? text.match(/(\d+) Pre-auths awaiting decision/i);
  expect(m, text.slice(0, 300)).toBeTruthy();
  return Number(m![1]);
}

async function upload(page: Page, label: string) {
  await page.getByLabel("Document type").selectOption({ label });
  await page.getByLabel(/^File/).setInputFiles({ name: `${label.replace(/\W+/g, "-")}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(`${label} uploaded.`)).toBeVisible();
}

test("hospital staff submit a pre-auth → it is pending for the insurer reviewer (and only for the right payers)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const insurer = await as(browser, "insurer.a@demo.claimix.invalid");
  const before = await awaiting(insurer.page);

  // 1. Hospital staff: a new patient with Aarogya cover, and a draft pre-authorization.
  await signIn(page, "staff.a@demo.claimix.invalid");
  const beneficiary = await freshPatientWithCover(page);
  await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}&claimType=cashless&admissionDate=2026-10-20&isAccident=no&pedDeclared=no&estimatedCost=80000&roomRentPerDay=4000`);
  await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
  await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
  const url = page.url();
  const reference = (await page.getByRole("heading", { name: /Pre-auth PA-/ }).innerText()).match(/PA-[\w-]+/)![0];

  // 2. A draft is not visible to the payer: same count, not listed, not reachable.
  expect(await awaiting(insurer.page)).toBe(before);
  await expect(insurer.page.getByRole("link", { name: reference })).toHaveCount(0);
  expect((await insurer.page.goto(url))?.status()).toBe(404);

  // 3. Hospital staff complete and submit it. (The payer is reachable, so there is no "no reviewer" notice.)
  await page.goto(url);
  await expect(page.getByText("No reviewer can see this request yet")).toHaveCount(0);
  for (const l of DOCS) await upload(page, l);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(3 - i);
  }
  await page.getByRole("button", { name: "Submit Pre-Authorization" }).click();
  await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
  await expect(page.locator("#main").getByText("Submitted", { exact: true }).first()).toBeVisible();

  // 4. Insurer reviewer, after a plain refresh: count +1, listed under "awaiting decision", "All" opens the full list.
  await insurer.page.goto("/dashboard");
  await insurer.page.reload();
  expect(await awaiting(insurer.page)).toBe(before + 1);
  const awaitingCard = insurer.page.locator("section").filter({ has: insurer.page.getByRole("heading", { name: "Pre-authorizations awaiting decision" }) });
  await expect(awaitingCard.getByRole("link", { name: reference })).toBeVisible();
  await expect(awaitingCard.getByText("Nothing awaiting a decision")).toHaveCount(0);
  await awaitingCard.getByRole("link", { name: "All" }).click();
  await expect(insurer.page).toHaveURL(/\/pre-authorizations\?view=all/);
  await expect(insurer.page.getByRole("link", { name: reference })).toBeVisible();

  // 5. It opens for decision, and it is in their own list only.
  await insurer.page.getByRole("link", { name: reference }).click();
  await expect(insurer.page).toHaveURL(url);
  await expect(insurer.page.getByLabel("Decision")).toBeVisible();

  const other = await as(browser, "insurer.b@demo.claimix.invalid");
  expect(await awaiting(other.page)).toBeGreaterThanOrEqual(0);
  await expect(other.page.getByRole("link", { name: reference })).toHaveCount(0);
  expect((await other.page.goto(url))?.status()).toBe(404);
  await other.close();

  // The TPA that administers the policy sees it as well.
  const tpa = await as(browser, "tpa.a@demo.claimix.invalid");
  await tpa.page.goto("/pre-authorizations?view=all");
  await expect(tpa.page.getByRole("link", { name: reference })).toBeVisible();
  await tpa.close();

  // 6. Once the insurer decides, it leaves the pending count (and stays in the full list).
  await insurer.page.goto(url);
  await insurer.page.getByLabel("Decision").selectOption({ label: "Approve" });
  await insurer.page.getByLabel("Approved amount (₹)").fill("80000");
  await insurer.page.getByRole("button", { name: "Approve" }).click();
  await expect(insurer.page.getByText("Recorded: Approved.")).toBeVisible();
  expect(await awaiting(insurer.page)).toBe(before);
  await insurer.page.goto("/pre-authorizations?view=all");
  await expect(insurer.page.getByRole("link", { name: reference })).toBeVisible();
  await insurer.close();
});

test("a pre-auth routed to an insurer with no reviewer account: hospital staff are told, and no other insurer sees it", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, "staff.a@demo.claimix.invalid");
  const suffix = alphaId();
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(`Orphan Payer ${suffix}`);
  await page.getByLabel("Date of birth").fill("1980-02-02");
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
  await page.getByRole("button", { name: "Add coverage" }).click();
  await page.getByLabel("Policy / scheme").selectOption({ label: "Navjeevan Super Top-Up 10L (DEMO DATA)" });
  await page.getByLabel("Member / beneficiary ID").fill(`NJV-${suffix}`.toUpperCase());
  await page.getByLabel("Relationship to policyholder").selectOption("self");
  await page.getByLabel("Cover start").fill("2026-04-01");
  await page.getByLabel("Cover end").fill("2027-03-31");
  await page.getByRole("button", { name: "Save coverage" }).click();
  const link = page.getByRole("link", { name: "Check eligibility" }).first();
  await link.waitFor();
  const beneficiary = new URL((await link.getAttribute("href"))!, "http://x").searchParams.get("beneficiary")!;

  await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}&claimType=cashless`);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
  const alert = page.getByRole("status").filter({ hasText: "No reviewer can see this request yet" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Navjeevan General Insurance");
  await expect(alert).toContainText("Payer Reviewer");

  // Every existing payer reviewer (Aarogya, Suraksha, MediAssist) correctly sees nothing of it.
  const reference = (await page.getByRole("heading", { name: /Pre-auth PA-/ }).innerText()).match(/PA-[\w-]+/)![0];
  for (const email of ["insurer.a@demo.claimix.invalid", "insurer.b@demo.claimix.invalid", "tpa.a@demo.claimix.invalid"]) {
    const r = await as(browser, email);
    await r.page.goto("/pre-authorizations?view=all");
    await expect(r.page.getByRole("link", { name: reference })).toHaveCount(0);
    await r.close();
  }
});
