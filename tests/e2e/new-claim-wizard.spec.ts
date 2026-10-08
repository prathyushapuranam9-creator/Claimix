import { expect, test, type Page } from "@playwright/test";
import { freshPatientWithCover, signIn } from "./helpers";

const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF") });
const footer = (page: Page) => page.getByRole("group", { name: "Wizard actions" });
const stepper = (page: Page) => page.getByRole("navigation", { name: "New claim steps" });
const currentStep = (page: Page) => stepper(page).locator('[aria-current="step"]');
const stepButton = (page: Page, name: string) => stepper(page).getByRole("button", { name: new RegExp(`^${name.replace(/[&]/g, "\\&")}`) });

/** A fresh member at hospital A (registered by hospital staff), then signed in as the insurer reviewer. */
async function memberAsInsurer(page: Page) {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await freshPatientWithCover(page);
  const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  await page.context().clearCookies();
  await signIn(page, "insurer.a@demo.claimix.invalid");
  return name;
}

/** New Claim → search → Find → Select: the claim form opens with the patient's details filled in. */
async function findAndSelect(page: Page, name: string) {
  const search = page.getByRole("search");
  await search.getByLabel("UHID / IP Number / Patient Name").fill(name);
  await search.getByRole("button", { name: "Find" }).click();
  const row = page.getByRole("table", { name: "Matching patients" }).getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: "Select" }).click();
  await page.waitForURL(/\/pre-authorizations\/raise\?member=[0-9a-f-]{36}$/);
}

test.describe("New Claim (insurer reviewer)", () => {
  test("New Claim → Find → Select → auto-filled KYC → every step → Submit", async ({ page }) => {
    test.setTimeout(240_000);
    const name = await memberAsInsurer(page);

    // Entry: New Claim opens the patient search first (centered page, no form yet).
    await page.goto("/pre-authorizations");
    await page.getByRole("link", { name: "New Claim" }).click();
    await page.waitForURL(/\/pre-authorizations\/raise$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New Claim");
    await expect(stepper(page)).toHaveCount(0);
    await findAndSelect(page, name);

    // KYC & Policy: filled from the record (no re-typing); the steps are the new names.
    await expect(stepper(page).getByRole("button")).toHaveText([
      /KYC & Policy/, /Clinical Details & Package/, /Supporting Documents/, /AI Pre-Scrutiny & Rules Engine/, /Review & Final Submission/,
    ]);
    await expect(currentStep(page)).toContainText("KYC & Policy");
    await expect(page.getByTestId("matched-member")).toContainText(name);
    await expect(page.getByLabel("Patient Name")).toHaveValue(name);
    await expect(page.getByLabel("UHID / IP Number")).toHaveValue(/^PT-/);
    await expect(page.getByLabel("Date of Birth")).toHaveValue("1984-05-05");
    await expect(page.getByLabel("Insurer")).not.toHaveValue("");
    await expect(page.getByLabel("TPA", { exact: true })).not.toHaveValue("");
    await expect(page.getByLabel("TPA Card / Member ID")).toHaveValue(/^E2E-/);
    await expect(page.getByLabel("Policy From")).toHaveValue("2026-04-01");
    await expect(page.getByLabel("Policy To")).toHaveValue("2027-03-31");

    // Collapsed and expanded states: collapsing hides the form and keeps what was typed.
    await page.getByLabel("Policy Number").fill("POL-E2E-001");
    await page.getByRole("button", { name: "Collapse form" }).click();
    await expect(stepper(page)).toBeHidden();
    await page.getByRole("button", { name: "Expand form" }).click();
    await expect(page.getByLabel("Policy Number")).toHaveValue("POL-E2E-001");

    await page.locator('input[type="file"][aria-label="Photo ID"]').setInputFiles(pdf("aadhaar.pdf"));
    await page.locator('input[type="file"][aria-label="Policy Card / E-Card"]').setInputFiles(pdf("ecard.pdf"));
    await page.getByLabel("Gender").selectOption("female");
    await page.getByLabel("Mobile").fill("9876500000");
    await footer(page).getByRole("button", { name: "Next" }).click();
    await page.waitForURL(/\/pre-authorizations\/raise\?id=[0-9a-f-]{36}&step=2$/);
    const id = new URL(page.url()).searchParams.get("id")!;
    await expect(page.getByTestId("case-banner")).toContainText(new RegExp(`${name} · 9876500000 · case PA-`));

    // Clinical Details & Package: start typing, then move away by clicking step names — nothing typed is lost.
    await expect(currentStep(page)).toContainText("Clinical Details & Package");
    await page.getByLabel("Presenting Complaint").fill("Pain in the right lower abdomen for 2 days with fever.");
    await stepButton(page, "KYC & Policy").click();
    await expect(currentStep(page)).toContainText("KYC & Policy");
    await expect(page.getByLabel("Policy Number")).toHaveValue("POL-E2E-001");
    await stepButton(page, "Supporting Documents").click();
    await expect(currentStep(page)).toContainText("Supporting Documents");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toContainText("Clinical Details & Package");
    await stepButton(page, "Clinical Details & Package").click();
    await expect(page.getByLabel("Presenting Complaint")).toHaveValue("Pain in the right lower abdomen for 2 days with fever.");

    await page.getByRole("combobox", { name: "Treatment / Packages" }).fill("Append");
    await page.getByRole("option", { name: "Appendectomy" }).click();
    await page.getByText("Surgical", { exact: true }).click();
    await page.getByRole("combobox", { name: "Diagnoses" }).fill("K35");
    await page.getByRole("listbox", { name: "Diagnoses" }).getByRole("option").first().click();
    await expect(page.getByLabel("ICD-10 Codes")).toHaveValue(/K35/);
    await page.getByRole("textbox", { name: "Stay starts", exact: true }).fill("2026-12-20");
    await page.getByLabel("Stay starts hour").selectOption("09");
    await page.getByLabel("Stay starts minutes").selectOption("00");
    await page.getByRole("textbox", { name: "Stay ends", exact: true }).fill("2026-12-23");
    await page.getByLabel("Stay ends hour").selectOption("11");
    await expect(page.getByTestId("stay-total")).toHaveText("Total stay: 4 days");
    await page.getByRole("textbox", { name: "Treating Doctor", exact: true }).fill("Dr Test Surgeon");
    await page.getByLabel("Doctor's Contact Number").fill("9876543210");
    await page.getByRole("button", { name: "None", exact: true }).click();
    await page.getByLabel("Head 1 per day").fill("4000");
    await page.getByLabel("Head 1 days").fill("3");
    await page.getByRole("button", { name: "+ Add a Head" }).click();
    await page.getByLabel("Head 2", { exact: true }).selectOption("Surgeon / OT charges");
    await page.getByLabel("Head 2 per day").fill("60000");
    await page.getByLabel("Head 2 days").fill("1");
    await expect(page.getByTestId("cost-total")).toContainText("72,000");
    await footer(page).getByRole("button", { name: "Register the Case" }).click();

    // Supporting Documents: the held ID and card were filed with the case.
    await expect(currentStep(page)).toContainText("Supporting Documents");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toHaveCount(0);
    const checklist = page.getByRole("list", { name: "Document checklist" });
    await expect(checklist.locator('li[data-doc="id_proof"]')).toContainText("Uploaded (1)");
    await expect(checklist.locator('li[data-doc="insurance_card"]')).toContainText("Uploaded (1)");
    await expect(checklist.locator('li[data-doc="preauth_form"] [data-tier]')).toHaveText("MUST");
    await expect(checklist.locator('li[data-doc="preauth_form"]').getByRole("link", { name: "Print" })).toHaveAttribute("href", `/pre-authorizations/raise/print?id=${id}`);
    const missing = await checklist.locator("li[data-doc]").filter({ hasText: "Not uploaded" }).evaluateAll((els) => els.map((e) => e.getAttribute("data-doc")!));
    for (const doc of missing) {
      const row = checklist.locator(`li[data-doc="${doc}"]`);
      await row.locator('input[type="file"]').setInputFiles(pdf(`${doc}.pdf`));
      await expect(row).toContainText("Uploaded (1)");
    }
    await footer(page).getByRole("button", { name: "Next" }).click();

    // AI Pre-Scrutiny & Rules Engine.
    await expect(currentStep(page)).toContainText("AI Pre-Scrutiny & Rules Engine");
    await expect(page.getByText("The scrutiny engine has not run on this case yet.")).toBeVisible();
    await page.getByRole("button", { name: "Run Checks", exact: true }).click();
    await expect(page.getByTestId("checks-headline")).toHaveText(/^\d+ the payer is likely to refuse over, and \d+ it may query$/);
    const findings = page.getByRole("list", { name: "Findings" });
    for (let i = 0; i < 20; i++) {
      if (!(await findings.count())) break;
      const item = findings.locator("li[data-finding]").filter({ has: page.getByRole("button", { name: /^(Record verification|Confirm)$/ }) }).first();
      if (!(await item.count())) break;
      const key = (await item.getAttribute("data-finding"))!;
      const one = findings.locator(`li[data-finding="${key}"]`);
      if (await one.getByLabel("Verification note").count()) {
        await one.getByLabel("Verification note").fill("Verified with the payer desk by phone today.");
        await one.getByRole("button", { name: "Record verification" }).click();
      } else await one.getByRole("button", { name: "Confirm" }).click();
      await expect(one).toHaveCount(0);
    }

    // Steps are directly clickable: jump to Review & Final Submission.
    await stepButton(page, "Review & Final Submission").click();
    await expect(currentStep(page)).toContainText("Review & Final Submission");
    await expect(page.getByText(/No NHCX \(National Health Claims Exchange\) connection is configured/)).toBeVisible();
    const submit = footer(page).getByRole("button", { name: "Submit to payer" });
    const ack = page.getByRole("checkbox", { name: /^I have seen (these \d+ gaps|this 1 gap) and am sending anyway\. This is written to the case audit trail with the submission\.$/ });
    if (await ack.count()) {
      await expect(submit).toBeDisabled();
      await ack.check();
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await page.waitForURL(new RegExp(`/pre-authorizations/${id}$`));
    await expect(page.locator("main")).toContainText("Submitted");
  });

  test("Back and resume: KYC saves again and a reload reopens the same step", async ({ page }) => {
    test.setTimeout(120_000);
    const name = await memberAsInsurer(page);
    await page.goto("/pre-authorizations/raise");
    await findAndSelect(page, name);
    await page.getByLabel("Gender").selectOption("female");
    await page.getByLabel("Mobile").fill("9876500001");
    await page.getByLabel("Policy Number").fill("POL-E2E-002");
    await footer(page).getByRole("button", { name: "Next" }).click();
    await page.waitForURL(/step=2$/);
    await footer(page).getByRole("button", { name: "Back" }).click();
    await expect(currentStep(page)).toContainText("KYC & Policy");
    await expect(page.getByLabel("Policy Number")).toHaveValue("POL-E2E-002");
    await page.getByLabel("Mobile").fill("9876500002");
    await footer(page).getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("case-banner")).toContainText("9876500002");
    await page.reload();
    await expect(currentStep(page)).toContainText("Clinical Details & Package");
    await expect(page.getByTestId("case-banner")).toContainText(name);
  });

  test("another insurer can't find the patient, and hospital staff can't open New Claim", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await freshPatientWithCover(page);
    const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
    await page.goto("/pre-authorizations/raise");
    await expect(page).toHaveURL(/\/forbidden/);

    await page.context().clearCookies();
    await signIn(page, "insurer.b@demo.claimix.invalid");
    await page.goto("/pre-authorizations/raise");
    await page.getByRole("search").getByLabel("UHID / IP Number / Patient Name").fill(name);
    await page.getByRole("search").getByRole("button", { name: "Find" }).click();
    await expect(page.getByText("No matching patient")).toBeVisible();
  });
});
