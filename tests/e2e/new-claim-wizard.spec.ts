import { expect, test, type Page } from "@playwright/test";
import { isValidAadhaar } from "@/lib/india";
import { freshPatientWithCover, signIn } from "./helpers";

const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF") });
const footer = (page: Page) => page.getByRole("group", { name: "Wizard actions" });
const stepper = (page: Page) => page.getByRole("navigation", { name: "New claim steps" });
const currentStep = (page: Page) => stepper(page).locator('[aria-current="step"]');
/** The Live Policy Balance & Rules Engine panel is collapsed by default; its heading opens it. */
async function openEngine(page: Page) {
  const toggle = page.getByRole("button", { name: /^Live Policy Balance & Rules Engine/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
const stepButton = (page: Page, name: string) => stepper(page).getByRole("button", { name: new RegExp(`^${name.replace(/[&]/g, "\\&")}`) });
const FINDER = "UHID / IP Number / Patient Name / Aadhaar Number";

/** 11 digits + the Verhoeff check digit: valid in form, never a real person's number. */
function testAadhaar(): string {
  const prefix = `${2 + Math.floor(Math.random() * 8)}${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`;
  for (let d = 0; d <= 9; d++) if (isValidAadhaar(prefix + d)) return prefix + d;
  throw new Error("no check digit");
}

/** A fresh member at hospital A (registered by hospital staff, optionally with an Aadhaar), then the insurer reviewer. */
async function memberAsInsurer(page: Page, aadhaar?: string) {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await freshPatientWithCover(page);
  const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  if (aadhaar) {
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await page.goto(`/patients/${id}/edit`);
    await page.getByLabel("Aadhaar number (optional)").fill(aadhaar);
    await page.getByRole("button", { name: /Save/ }).click();
    await page.waitForURL(new RegExp(`/patients/${id}$`));
  }
  await page.context().clearCookies();
  await signIn(page, "insurer.a@demo.claimix.invalid");
  return name;
}

/** Find the Patient: type, then pick the suggestion. */
async function suggestAndPick(page: Page, typed: string, name: string) {
  const input = page.getByRole("combobox", { name: FINDER });
  await input.fill(typed);
  const option = page.getByRole("listbox", { name: "Matching patients" }).getByRole("option").filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await option.click();
  await page.waitForURL(/\/pre-authorizations\/raise\?member=[0-9a-f-]{36}$/);
}

/** Opens 1A's demographics for editing, unless they are already open. */
async function editDemographics(page: Page) {
  const edit = page.getByRole("button", { name: /^(Edit Demographics|Done editing)$/ });
  if ((await edit.getAttribute("aria-pressed")) !== "true") await edit.click();
  await expect(edit).toHaveAttribute("aria-pressed", "true");
}

test.describe("New Claim (insurer reviewer)", () => {
  test("suggestions → optional KYC → clinical (pickers, conditions, cost) → documents → dashboard quick fix → submit", async ({ page }) => {
    test.setTimeout(300_000);
    const aadhaar = testAadhaar();
    const name = await memberAsInsurer(page, aadhaar);
    // No console errors anywhere in the flow.
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    // Find the Patient: nothing until typed; part of the name (any case) suggests the patient.
    await page.goto("/pre-authorizations");
    await page.getByRole("link", { name: "New Claim" }).click();
    await page.waitForURL(/\/pre-authorizations\/raise$/);
    await expect(page.getByRole("listbox", { name: "Matching patients" })).toHaveCount(0);
    const input = page.getByRole("combobox", { name: FINDER });
    await input.fill("zzqq-no-such-patient");
    await expect(page.getByRole("listbox", { name: "Matching patients" })).toContainText("No patients found");
    await input.fill("");
    await expect(page.getByRole("listbox", { name: "Matching patients" })).toHaveCount(0);
    // The last 4 digits of the Aadhaar find the patient, shown masked.
    await input.fill(aadhaar.slice(-4));
    const byAadhaar = page.getByRole("listbox", { name: "Matching patients" }).getByRole("option").filter({ hasText: name });
    await expect(byAadhaar).toContainText(`Aadhaar XXXX XXXX ${aadhaar.slice(-4)}`);
    await expect(page.getByRole("listbox", { name: "Matching patients" })).not.toContainText(aadhaar);
    await suggestAndPick(page, name.slice(0, 18).toLowerCase(), name);

    // KYC & Policy: filled from the record; no photo ID / policy card block; Aadhaar Number in Patient details.
    await expect(page.getByRole("button", { name: "Collapse form" })).toHaveCount(0);
    await expect(page.getByText("Photo ID and policy card")).toHaveCount(0);
    await expect(page.locator('main input[type="file"]')).toHaveCount(0);
    await expect(page.getByLabel("Patient Name")).toHaveValue(name);
    const aadhaarInput = page.getByLabel("Aadhaar Number");
    await expect(aadhaarInput).toHaveAttribute("placeholder", `XXXX XXXX ${aadhaar.slice(-4)}`);
    // 1A Patient KYC Verification and 1B Policy Details side by side, the live rules engine panel under 1B.
    await expect(page.getByRole("heading", { name: "Patient KYC Verification" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Policy Details & Coverage Identification" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Live Policy Balance & Rules Engine" })).toBeVisible();
    // No invented OTP / ABHA statuses.
    await expect(page.getByText("Mobile not OTP-verified")).toBeVisible();
    await expect(page.getByText("Claimix has no ABDM connection", { exact: false })).toBeVisible();
    // Demographics arrive verified against the patient record, read-only until Edit Demographics.
    await expect(page.getByTestId("kyc-status")).toHaveText("Verified");
    await editDemographics(page);
    await page.getByLabel("Gender").selectOption("female");
    await page.getByLabel("Mobile").fill("9876500000");
    await aadhaarInput.fill("12345");
    await footer(page).getByRole("button", { name: "Continue to Clinical Details" }).click();
    await expect(page.getByText("Aadhaar Number has exactly 12 digits.")).toBeVisible();
    await aadhaarInput.fill(`${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`);
    await page.getByRole("button", { name: "Re-verify via Aadhaar / UHID" }).click();
    await expect(page.getByText("Re-verified against the patient record: Verified.")).toBeVisible();
    await expect(page.getByTestId("kyc-status")).toHaveText("Verified");
    await page.getByText(/^Verification details/).click();
    await expect(page.getByRole("list", { name: "Verification results" })).toContainText("Aadhaar");
    await expect(page.getByText("Nothing is sent to UIDAI", { exact: false })).toBeVisible();
    // The live policy panel (collapsed by default; the heading opens it): real balances (INR), a measured response time and the engine status.
    await openEngine(page);
    await expect(page.getByTestId("sum-insured")).toHaveText("₹5,00,000");
    await expect(page.getByText(/Response time: \d+ms/)).toBeVisible();
    await expect(page.getByTestId("engine-status")).toHaveText(/Policy intact|Review warnings/);
    await expect(page.getByTestId("balance-available")).toHaveText("₹4,00,000");
    await page.getByLabel("Policy Number").fill("POL-E2E-001");
    await expect(page.getByTestId("available-balance")).toBeVisible();
    const policyAck = page.getByRole("checkbox", { name: /^I have reviewed these/ });
    if (await policyAck.count()) await policyAck.check();
    await footer(page).getByRole("button", { name: "Continue to Clinical Details" }).click();
    await page.waitForURL(/\/pre-authorizations\/raise\?id=[0-9a-f-]{36}&step=2$/);
    const id = new URL(page.url()).searchParams.get("id")!;

    // Clinical Details & Package.
    await expect(currentStep(page)).toContainText("Clinical Details & Package");
    await expect(page.getByLabel("Doctor's Contact Number")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Treatment / Packages" }).fill("Append");
    await page.getByRole("option", { name: "Appendectomy" }).click();
    await page.getByRole("combobox", { name: "Diagnoses" }).fill("K35");
    await page.getByRole("listbox", { name: "Diagnoses" }).getByRole("option").first().click();
    await page.getByLabel("Presenting Complaint").fill("Pain in the right lower abdomen for 2 days with fever.");

    // Stay starts: typed in the display format.
    const start = page.getByRole("textbox", { name: "Stay starts Date and time" });
    await start.fill("20/12/2026 09:00 AM");
    await start.press("Enter");
    await page.keyboard.press("Escape");
    await expect(start).toHaveValue("20/12/2026   09:00 AM");
    // Stay ends: through the popover (Escape first: nothing is saved without Confirm).
    const end = page.getByRole("textbox", { name: "Stay ends Date and time" });
    const endField = page.locator("[data-no-dirty]").filter({ has: end });
    await endField.getByRole("button", { name: "Open the date and time picker" }).click();
    const pop = page.getByRole("dialog", { name: "Choose date and time" });
    await expect(pop.getByRole("columnheader")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    await pop.getByRole("button", { name: /^\d+ \w+ \d{4}$/ }).first().click();
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(end).toHaveValue("");
    await endField.getByRole("button", { name: "Open the date and time picker" }).click();
    // Year and month are chosen directly from their lists (no paging month by month); no seconds / milliseconds.
    await expect(pop.getByRole("listbox", { name: "Seconds" })).toHaveCount(0);
    await expect(pop.getByRole("listbox", { name: "Milliseconds" })).toHaveCount(0);
    await pop.getByRole("button", { name: /^Choose year, / }).click();
    await pop.getByRole("button", { name: "Later years" }).click();
    await pop.getByRole("button", { name: "Earlier years" }).click();
    await pop.getByRole("listbox", { name: "Years" }).getByRole("option", { name: "2026" }).click();
    await pop.getByRole("button", { name: /^Choose month, / }).click();
    await expect(pop.getByRole("listbox", { name: "Months" }).getByRole("option")).toHaveCount(12);
    await pop.getByRole("listbox", { name: "Months" }).getByRole("option", { name: "December" }).click();
    await expect(pop.getByRole("grid", { name: "December 2026" })).toBeVisible();
    await pop.getByRole("button", { name: "23 December 2026" }).click();
    await pop.getByRole("listbox", { name: "Hours" }).getByRole("button", { name: "11", exact: true }).click();
    await pop.getByRole("listbox", { name: "Minutes" }).getByRole("button", { name: "30", exact: true }).click();
    await pop.getByRole("listbox", { name: "AM or PM" }).getByRole("button", { name: "AM", exact: true }).click();
    await pop.getByRole("button", { name: "Confirm" }).click();
    await expect(end).toHaveValue("23/12/2026   11:30 AM");
    await expect(page.getByTestId("stay-total")).toHaveText("Total stay: 4 days");
    // Stay starts (left) and Stay ends (right) on one row, same height, on wide screens.
    const [a, b] = [await start.boundingBox(), await end.boundingBox()];
    if ((page.viewportSize()?.width ?? 0) > 700) {
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
      expect(a!.x).toBeLessThan(b!.x);
      expect(Math.abs(a!.height - b!.height)).toBeLessThan(2);
    } else expect(b!.y).toBeGreaterThan(a!.y);

    await page.getByRole("textbox", { name: "Treating Doctor", exact: true }).fill("Dr Test Surgeon");
    // Chronic illness: from the list, and a typed one.
    await page.getByLabel("Choose a condition").selectOption("Diabetes");
    await page.getByLabel("Or type another condition").fill("Thyroid disorder");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    // The list and the typed entry sit side by side on wide screens.
    const pick = await page.getByLabel("Choose a condition").boundingBox();
    const typedBox = await page.getByLabel("Or type another condition").boundingBox();
    if ((page.viewportSize()?.width ?? 0) > 700) expect(Math.abs(pick!.y - typedBox!.y)).toBeLessThan(2);
    else expect(typedBox!.y).toBeGreaterThan(pick!.y);
    const conditions = page.getByRole("list", { name: "Chosen conditions" });
    await expect(conditions).toContainText("Diabetes");
    await expect(conditions).toContainText("Thyroid disorder");
    // Expected cost: a closed dropdown section.
    const cost = page.getByTestId("cost-section");
    await expect(cost).not.toHaveAttribute("open", "");
    await cost.locator("summary").click();
    await page.getByLabel("Head 1 per day").fill("4000");
    await page.getByLabel("Head 1 days").fill("3");
    await page.getByRole("button", { name: "+ Add a Head" }).click();
    await page.getByLabel("Head 2", { exact: true }).selectOption("Surgeon / OT charges");
    await page.getByLabel("Head 2 per day").fill("60000");
    await page.getByLabel("Head 2 days").fill("1");
    await expect(page.getByTestId("cost-total")).toContainText("72,000");
    await footer(page).getByRole("button", { name: "Register the Case" }).click();

    // Register Case: the form on its own page, read-only first.
    await page.waitForURL(new RegExp(`/pre-authorizations/raise/register\\?id=${id}$`));
    const sheet = page.getByRole("article", { name: "Case registration form" });
    await expect(sheet).toContainText("Pain in the right lower abdomen");
    await expect(sheet.getByRole("textbox", { name: "Presenting Complaint" })).toHaveCount(0);
    const toolbar = page.getByRole("toolbar", { name: "Registration form actions" });
    for (const n of ["Back", "Edit", "Print, download or save"]) await expect(toolbar.getByRole("button", { name: n })).toBeVisible();
    const submitForm = page.getByRole("button", { name: "Submit", exact: true });
    await expect(submitForm).toBeDisabled(); // not signed yet
    // Edit → change → save → back to read-only.
    await toolbar.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Presenting Complaint").fill("Pain in the right lower abdomen for 2 days with fever and vomiting.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("article", { name: "Case registration form" })).toContainText("fever and vomiting");
    // Print / Download / Save.
    await toolbar.getByRole("button", { name: "Print, download or save" }).click();
    await expect(page.getByRole("menuitem", { name: "Print" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toMatch(/^case-registration-PA-.*\.pdf$/);
    await toolbar.getByRole("button", { name: "Print, download or save" }).click();
    await page.getByRole("menuitem", { name: "Save a copy to the case documents" }).click();
    await expect(page.getByText("A copy of the form was saved with the case documents.")).toBeVisible();
    // Sign (typed) and submit.
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await page.getByLabel("Type your full name to sign").fill("Vikram Reviewer");
    await page.getByRole("button", { name: "Use as signature" }).click();
    await expect(submitForm).toBeEnabled();
    await submitForm.click();
    await expect(page.getByText("The registration form was saved with the case and the patient's record.")).toBeVisible();
    await expect(page.getByRole("figure")).toContainText("signed electronically by");
    // The saved form is on the patient's record.
    await page.getByRole("link", { name: /^Open .* record$/ }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    const forms = page.getByRole("table", { name: "Case registration forms" });
    await expect(forms).toContainText(/PA-/);
    await expect(forms).toContainText("case-registration-");
    await page.goto(`/pre-authorizations/raise?id=${id}&step=3`);

    // Supporting Documents: three groups, all closed; underline only on hover; no Print; uploads inside a group.
    await expect(currentStep(page)).toContainText("Supporting Documents");
    const progress = page.getByTestId("docs-progress");
    await expect(progress).toHaveText(/^0 of \d+ Documents Uploaded \(0%\)$/);
    const docs = page.getByRole("list", { name: "Document checklist" });
    const groups = docs.locator("details[data-category]");
    await expect(groups).toHaveCount(3);
    await expect(groups.locator("summary")).toHaveText([/^Identity & Policy/, /^Medical & Pre-Auth/, /^Financials & Estimates/]);
    for (let i = 0; i < 3; i++) await expect(groups.nth(i)).not.toHaveAttribute("open", "");
    await expect(docs.locator('li[data-doc="preauth_form"]')).toBeHidden();
    const medical = groups.filter({ hasText: "Medical & Pre-Auth" });
    const title = medical.locator("summary span").first();
    expect(await title.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("none");
    await medical.locator("summary").hover();
    expect(await title.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("underline");
    await page.mouse.move(5, 5);
    await medical.locator("summary").click();
    await expect(medical).toHaveAttribute("open", "");
    await page.mouse.move(5, 5); // no lasting underline once open
    expect(await title.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("none");
    await expect(groups.filter({ hasText: "Identity & Policy" })).not.toHaveAttribute("open", "");
    await expect(medical.getByRole("link", { name: "Print" })).toHaveCount(0);
    await expect(medical.getByRole("button", { name: "Print" })).toHaveCount(0);
    const form = medical.locator('li[data-doc="preauth_form"]');
    await expect(form).toHaveAttribute("data-state", "missing");
    await form.locator('input[type="file"]').setInputFiles(pdf("signed-form.pdf"));
    await expect(form).toHaveAttribute("data-state", "uploaded");
    await expect(progress).toHaveText(/^1 of \d+ Documents Uploaded \(\d+%\)$/);
    // Closing and reopening keeps the uploaded file.
    await medical.locator("summary").click();
    await expect(medical).not.toHaveAttribute("open", "");
    await medical.locator("summary").click();
    await expect(form).toContainText("Uploaded (1)");
    await expect(form).toContainText("signed-form.pdf");
    await footer(page).getByRole("button", { name: "Next" }).click();

    // AI Pre-Scrutiny & Rules Engine: risk summary, tabs, step groups, quick fix, re-run.
    await expect(currentStep(page)).toContainText("AI Pre-Scrutiny & Rules Engine");
    await page.getByRole("button", { name: "Run Engine" }).click();
    await expect(page.getByRole("button", { name: "Re-run Engine" })).toBeVisible();
    await expect(page.getByTestId("risk-level")).toHaveText(/^(High|Medium|Low)$/);
    const tabs = page.getByRole("tablist", { name: "Findings by severity" });
    await expect(tabs.getByRole("tab")).toHaveText([/^All Alerts \d+$/, /^Critical \/ Likely Refusal \d+$/, /^Queries & Warnings \d+$/, /^Cleared Checks \d+$/]);
    const panel = page.getByRole("tabpanel");
    await tabs.getByRole("tab", { name: /^Cleared Checks/ }).click();
    await expect(panel).toContainText("Cleared");
    await tabs.getByRole("tab", { name: /^All Alerts/ }).click();
    await expect(panel.locator("details[data-step]").first()).toBeVisible();

    // Quick fix: upload the missing photo ID from its finding; then re-run.
    const idFinding = panel.locator('[data-finding="document:id_proof"]');
    await expect(idFinding).toBeVisible();
    await idFinding.locator('input[type="file"]').setInputFiles(pdf("aadhaar-card.pdf"));
    await expect(panel.locator('[data-finding="document:id_proof"]')).toHaveCount(0);
    await page.getByRole("button", { name: /^(Re-run|Run) Engine$/ }).click();
    await expect(page.getByRole("button", { name: "Re-run Engine" })).toBeVisible();

    // Resolve confirmable findings in place.
    for (let i = 0; i < 20; i++) {
      const item = panel.locator("[data-finding]").filter({ has: page.getByRole("button", { name: /^(Record verification|Confirm)$/ }) }).first();
      if (!(await item.count())) break;
      const key = (await item.getAttribute("data-finding"))!;
      const one = panel.locator(`[data-finding="${key}"]`);
      if (await one.getByLabel("Verification note").count()) {
        await one.getByLabel("Verification note").fill("Verified with the payer desk by phone today.");
        await one.getByRole("button", { name: "Record verification" }).click();
      } else await one.getByRole("button", { name: "Confirm" }).click();
      await expect(one).toHaveCount(0);
    }

    // Data kept across steps: back to Clinical Details shows what was saved.
    await stepButton(page, "Clinical Details & Package").click();
    await expect(page.getByRole("textbox", { name: "Stay ends Date and time" })).toHaveValue("23/12/2026   11:30 AM");
    await expect(page.getByRole("list", { name: "Chosen conditions" })).toContainText("Thyroid disorder");

    // Review & Final Submission.
    await stepButton(page, "Review & Final Submission").click();
    const submit = footer(page).getByRole("button", { name: "Submit to payer" });
    const ack = page.getByRole("checkbox", { name: /^I have seen (these \d+ gaps|this 1 gap) and am sending anyway\./ });
    if (await ack.count()) {
      await expect(submit).toBeDisabled();
      await ack.check();
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await page.waitForURL(new RegExp(`/pre-authorizations/${id}$`));
    await expect(page.locator("main")).toContainText("Submitted");
    expect(consoleErrors).toEqual([]);
  });

  test("Find still works: typed search, the results table and Select", async ({ page }) => {
    test.setTimeout(120_000);
    const name = await memberAsInsurer(page);
    await page.goto("/pre-authorizations/raise");
    const search = page.getByRole("search");
    await search.getByRole("combobox", { name: FINDER }).fill(name);
    await search.getByRole("button", { name: "Find" }).click();
    const row = page.getByRole("table", { name: "Matching patients" }).getByRole("row").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.getByRole("link", { name: "Select" }).click();
    await page.waitForURL(/\?member=/);
    await editDemographics(page);
    await page.getByLabel("Gender").selectOption("female");
    await page.getByLabel("Mobile").fill("9876500001");
    await page.getByLabel("Policy Number").fill("POL-E2E-002");
    await openEngine(page);
    await expect(page.getByTestId("available-balance")).toBeVisible(); // the policy check has loaded
    const ack2 = page.getByRole("checkbox", { name: /^I have reviewed these/ });
    if (await ack2.count()) await ack2.check();
    await footer(page).getByRole("button", { name: "Continue to Clinical Details" }).click();
    await page.waitForURL(/step=2$/);

    // A quick fix from the engine view: Add Diagnosis, without filling the rest of Clinical Details first.
    await stepButton(page, "AI Pre-Scrutiny & Rules Engine").click();
    const fixRow = page.getByRole("tabpanel").locator('[data-finding="clinical:diagnosisIds"]');
    await fixRow.getByRole("button", { name: "Add Diagnosis" }).click();
    await fixRow.getByRole("combobox", { name: "Diagnoses" }).fill("K35");
    await fixRow.getByRole("listbox", { name: "Diagnoses" }).getByRole("option").first().click();
    await fixRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("tabpanel").locator('[data-finding="clinical:diagnosisIds"]')).toHaveCount(0);
    // The Clinical Details step shows the fixed diagnosis.
    await stepButton(page, "Clinical Details & Package").click();
    await expect(page.getByLabel("ICD-10 Codes")).toHaveValue(/K35/);

    await stepButton(page, "Clinical Details & Package").click();
    await footer(page).getByRole("button", { name: "Back" }).click();
    await expect(currentStep(page)).toContainText("Identity & Coverage");
    await expect(page.getByLabel("Policy Number")).toHaveValue("POL-E2E-002");
    await page.reload();
    await expect(page.getByTestId("case-banner")).toContainText(name);
  });

  test("another insurer gets no suggestions for the patient; hospital staff can't open New Claim", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await freshPatientWithCover(page);
    const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
    await page.goto("/pre-authorizations/raise");
    await expect(page).toHaveURL(/\/forbidden/);

    await page.context().clearCookies();
    await signIn(page, "insurer.b@demo.claimix.invalid");
    await page.goto("/pre-authorizations/raise");
    await page.getByRole("combobox", { name: FINDER }).fill(name);
    await expect(page.getByRole("listbox", { name: "Matching patients" })).toContainText("No patients found");
  });
});
