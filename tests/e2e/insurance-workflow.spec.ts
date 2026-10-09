import { expect, test, type Page } from "@playwright/test";
import { AAROGYA_CARD, insuranceCardPdf } from "../fixtures/insurance-card";
import { alphaId, signIn } from "./helpers";

/**
 * The Hospital Staff journey in the browser, in both insurance scenarios:
 * register patient -> insurance document (or not) -> coverage -> eligibility -> pre-authorization
 * -> treatment documents -> review -> submit -> awaiting payer, routed to the right payer.
 */
const CARD = Buffer.from(insuranceCardPdf(AAROGYA_CARD));
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const TREATMENT_DOCS = ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"];

async function registerPatient(page: Page, name: string) {
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Date of birth").fill("1984-05-05");
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
  return new URL(page.url()).pathname;
}

/** Insurance Documents sit inside the Policy Check block on the patient page: open it (idempotent). */
async function openPolicyCheck(page: Page) {
  const block = page.locator("details#policy-check");
  if (!(await block.evaluate((d) => (d as HTMLDetailsElement).open))) await block.locator("summary").click();
  await expect(block).toHaveAttribute("open", "");
}

async function uploadRequestDoc(page: Page, label: string) {
  await page.getByLabel("Document type").selectOption({ label });
  await page.getByLabel(/^File/).setInputFiles({ name: `${label.replace(/\W+/g, "-")}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(`${label} uploaded.`)).toBeVisible();
}

/** Documents, checks, checklist and submission on an open pre-authorization draft. */
async function completeAndSubmit(page: Page) {
  for (const l of TREATMENT_DOCS) await uploadRequestDoc(page, l);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  for (let left = await confirm.count(); left > 0; left--) {
    await confirm.first().click();
    await expect(confirm).toHaveCount(left - 1);
  }
  // A complete case leaves nothing for the staff to verify with the payer by hand.
  await expect(page.getByRole("button", { name: "Record verification" })).toHaveCount(0);
  await page.getByRole("button", { name: "Submit Pre-Authorization" }).click();
  await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
}

test.describe("Hospital Staff: patient to pre-authorization", () => {
  test("Scenario A: with an insurance document, the coverage form is filled from it and the request reaches the payer", async ({ page }) => {
    const id = alphaId();
    await signIn(page, "staff.a@demo.claimix.invalid");
    const patientPath = await registerPatient(page, `Scenario A Patient ${id}`);

    // Step 1: registration confirms itself and names the next step, without inventing insurance.
    await expect(page.getByText("Patient registered successfully.")).toBeVisible();
    await expect(page.locator("#main")).toContainText("Next step: add insurance coverage");
    await expect(page.getByText("No coverage recorded")).toBeVisible();
    await openPolicyCheck(page);
    await expect(page.getByText("No insurance document uploaded")).toBeVisible();

    // Step 2: the insurance card is filed against this patient.
    await page.getByLabel("Document type").selectOption({ label: "Insurance / health card" });
    await page.getByLabel(/^File/).setInputFiles({ name: "aarogya-card.pdf", mimeType: "application/pdf", buffer: CARD });
    await page.getByRole("button", { name: "Upload insurance document" }).click();
    await expect(page.getByText("Insurance / health card uploaded.")).toBeVisible();

    // Step 3: the details are read and offered for checking - never saved on their own.
    await page.getByRole("link", { name: "Review extracted details" }).click();
    await expect(page.getByText("Details extracted from the uploaded document. Please verify before saving.")).toBeVisible();
    await expect(page.getByText("No coverage recorded")).toBeVisible(); // still nothing recorded

    // Step 4: the form carries what the document said, and every value stays editable.
    // The policy was identified from the document and is selected (it decides which payer gets the request).
    await expect(page.getByLabel("Policy / scheme")).toHaveValue(/^[0-9a-f-]{36}$/);
    const selected = await page.getByLabel("Policy / scheme").evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.text ?? "");
    expect(selected).toContain("Aarogya Family Floater Plus");
    await expect(page.getByLabel("Member / beneficiary ID")).toHaveValue("AAR-FF-778901");
    await expect(page.getByLabel("Cover start")).toHaveValue("2026-04-01");
    await expect(page.getByLabel("Cover end")).toHaveValue("2027-03-31");
    await expect(page.getByLabel("First inception date")).toHaveValue("2021-04-01");
    await expect(page.getByLabel("Sum insured (₹)")).toHaveValue("500000");
    await expect(page.getByLabel("Available balance (₹)")).toHaveValue("400000");

    // The member ID on the card is corrected by hand; only what staff save is recorded.
    const memberId = `AAR-E2E-${id.toUpperCase()}`;
    await page.getByLabel("Member / beneficiary ID").fill(memberId);
    await page.getByRole("button", { name: "Save coverage" }).click();

    // Step 5: coverage is on the patient's page, verified, with the next step named.
    await expect(page.getByText("Coverage added successfully.")).toBeVisible();
    const coverageRow = page.getByRole("row", { name: new RegExp(memberId) });
    await expect(coverageRow).toContainText("Aarogya Family Floater Plus");
    await expect(coverageRow).toContainText("Verified");
    await expect(coverageRow).toContainText("In force");

    // Step 6: eligibility, from that coverage.
    await coverageRow.getByRole("link", { name: "Check eligibility" }).click();
    await expect(page.locator("#main")).toContainText(memberId);
    await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
    await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
    await page.getByLabel("Expected admission date").fill("2026-10-20");
    await page.getByLabel("Due to an accident?").selectOption("no");
    await page.getByLabel("Pre-existing disease declared?").selectOption("no");
    await page.getByLabel("Estimated cost (₹)").fill("80000");
    await page.getByLabel("Room rent per day (₹)").fill("4000");
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(page.getByText("Eligibility result")).toBeVisible();

    // Step 6: the next step carries this patient and this coverage.
    const start = page.getByRole("link", { name: "New pre-authorization" });
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute("href", /beneficiary=[0-9a-f-]{36}/);
    await start.click();
    await expect(page).toHaveURL(/\/pre-authorizations\/new\?/);
    await expect(page.locator("#main")).toContainText(memberId);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
    const reference = (await page.getByRole("heading", { name: /Pre-auth PA-/ }).innerText()).match(/PA-[\w-]+/)![0];

    // Step 7/8: the request's own documents, and the review of what will be sent.
    await expect(page.getByRole("heading", { name: "Treatment & supporting documents" })).toBeVisible();
    const review = page.locator("section").filter({ has: page.getByRole("heading", { name: "Review before submitting" }) });
    await expect(review).toContainText(memberId);
    await expect(review).toContainText(`Scenario A Patient ${id}`);
    await expect(review).toContainText("Aarogya Shield General Insurance");
    await completeAndSubmit(page);

    // Step 9/10: submitted, awaiting the payer, and in the hospital's Awaiting payer tab.
    await expect(page.getByText("Submitted — awaiting payer")).toBeVisible();
    await page.goto("/pre-authorizations?view=review");
    await expect(page.getByRole("link", { name: reference })).toBeVisible();

    // The insurance document stayed on the patient and did not become a request document.
    await page.goto(patientPath);
    await expect(page.getByRole("row", { name: /aarogya-card\.pdf/ })).toBeVisible();

    // Routed to the policy's own insurer, and to nobody else.
    const ctx = page.context().browser()!;
    const aarogya = await ctx.newContext();
    const aarogyaPage = await aarogya.newPage();
    await signIn(aarogyaPage, "insurer.a@demo.claimix.invalid");
    await aarogyaPage.goto("/pre-authorizations?view=all");
    await expect(aarogyaPage.getByRole("link", { name: reference })).toBeVisible();
    await aarogya.close();

    const suraksha = await ctx.newContext();
    const surakshaPage = await suraksha.newPage();
    await signIn(surakshaPage, "insurer.b@demo.claimix.invalid");
    await surakshaPage.goto("/pre-authorizations?view=all");
    await expect(surakshaPage.getByRole("link", { name: reference })).toHaveCount(0);
    await suraksha.close();
  });

  test("Scenario B: coverage is recorded by hand with no document, and the request still goes through", async ({ page }) => {
    const id = alphaId();
    await signIn(page, "staff.b@demo.claimix.invalid");
    await registerPatient(page, `Scenario B Patient ${id}`);

    // No document is uploaded at any point, and nothing asks for one.
    const memberId = `SUR-E2E-${id.toUpperCase()}`;
    await page.getByRole("button", { name: "Add coverage manually" }).click();
    await page.getByLabel("Policy / scheme").selectOption({ label: "Suraksha Individual Health Secure (DEMO DATA)" });
    await page.getByLabel("Member / beneficiary ID").fill(memberId);
    await page.getByLabel("First inception date").fill("2021-04-01");
    await page.getByLabel("Cover start").fill("2026-04-01");
    await page.getByLabel("Cover end").fill("2027-03-31");
    await page.getByLabel("Sum insured (₹)").fill("300000");
    await page.getByLabel("Available balance (₹)").fill("300000");
    await page.getByRole("button", { name: "Save coverage" }).click();

    await expect(page.getByText("Coverage added successfully.")).toBeVisible();
    await expect(page.getByText("No insurance document uploaded")).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(memberId) });
    // Saved without the document, so it is marked as still to be checked - and nothing is blocked.
    await expect(row).toContainText("Requires verification");
    await expect(row.getByRole("link", { name: "Check eligibility" })).toBeVisible();

    await row.getByRole("link", { name: "Check eligibility" }).click();
    await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
    await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
    await page.getByLabel("Expected admission date").fill("2026-10-20");
    await page.getByLabel("Estimated cost (₹)").fill("60000");
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(page.getByText("Eligibility result")).toBeVisible();
    await page.getByRole("link", { name: "New pre-authorization" }).click();
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
    // The review names the coverage as unverified rather than hiding it.
    await expect(page.locator("#main")).toContainText("Coverage not yet verified against the insurance document");
  });

  test("the insurance document can be added afterwards and the coverage confirmed against it", async ({ page }) => {
    const id = alphaId();
    await signIn(page, "staff.a@demo.claimix.invalid");
    const patientPath = await registerPatient(page, `Late Document Patient ${id}`);
    const memberId = `AAR-LATE-${id.toUpperCase()}`;

    await page.getByRole("button", { name: "Add coverage manually" }).click();
    await page.getByLabel("Policy / scheme").selectOption({ label: "Aarogya Family Floater Plus (DEMO DATA)" });
    await page.getByLabel("Member / beneficiary ID").fill(memberId);
    await page.getByLabel("Cover start").fill("2026-04-01");
    await page.getByLabel("Cover end").fill("2027-03-31");
    await page.getByRole("button", { name: "Save coverage" }).click();
    await expect(page.getByRole("row", { name: new RegExp(memberId) })).toContainText("Requires verification");

    // The document arrives later.
    await openPolicyCheck(page);
    await page.getByLabel("Document type").selectOption({ label: "Insurance / health card" });
    await page.getByLabel(/^File/).setInputFiles({ name: "late-card.pdf", mimeType: "application/pdf", buffer: CARD });
    await page.getByRole("button", { name: "Upload insurance document" }).click();
    await expect(page.getByText("Insurance / health card uploaded.")).toBeVisible();

    // Edit reads it and confirms the existing coverage, without creating a second one.
    await page.getByRole("row", { name: new RegExp(memberId) }).getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit coverage" })).toBeVisible();
    await page.getByRole("link", { name: "late-card.pdf" }).click();
    await expect(page.getByText("Details extracted from the uploaded document. Please verify before saving.")).toBeVisible();
    await page.getByLabel("Member / beneficiary ID").fill(memberId);
    await page.getByLabel("Verification").selectOption({ label: "Verified against the insurance document" });
    await page.getByRole("button", { name: "Save coverage" }).click();

    await expect(page).toHaveURL(new RegExp(`${patientPath}$`));
    const row = page.getByRole("row", { name: new RegExp(memberId) });
    await expect(row).toContainText("Verified");
    await expect(page.getByRole("row", { name: /AAR-FF-778901/ })).toHaveCount(0); // no second coverage
  });

  test("expired coverage is not treated as active", async ({ page }) => {
    const id = alphaId();
    await signIn(page, "staff.a@demo.claimix.invalid");
    await registerPatient(page, `Expired Cover Patient ${id}`);
    const memberId = `AAR-OLD-${id.toUpperCase()}`;

    await page.getByRole("button", { name: "Add coverage manually" }).click();
    await page.getByLabel("Policy / scheme").selectOption({ label: "Aarogya Family Floater Plus (DEMO DATA)" });
    await page.getByLabel("Member / beneficiary ID").fill(memberId);
    await page.getByLabel("Cover start").fill("2024-04-01");
    await page.getByLabel("Cover end").fill("2025-03-31");
    await page.getByRole("button", { name: "Save coverage" }).click();

    const row = page.getByRole("row", { name: new RegExp(memberId) });
    await expect(row).toContainText("Expired");
    // No request is offered for it, and reaching the page by hand is refused with a way forward.
    await expect(page.getByRole("link", { name: "New pre-authorization" })).toHaveCount(0);
    const href = await row.getByRole("link", { name: "Check eligibility" }).getAttribute("href");
    const beneficiary = new URL(href!, "http://x").searchParams.get("beneficiary")!;
    await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}`);
    await expect(page.getByText("This cover has ended")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Review / edit coverage" })).toBeVisible();

    // It is also absent as a selectable cover in the picker.
    await page.goto(`/pre-authorizations/new?q=${encodeURIComponent(memberId)}`);
    await expect(page.getByRole("row", { name: new RegExp(memberId) })).toContainText("Expired");
    await expect(page.getByRole("row", { name: new RegExp(memberId) }).getByRole("link", { name: "Select" })).toHaveCount(0);
  });
});
