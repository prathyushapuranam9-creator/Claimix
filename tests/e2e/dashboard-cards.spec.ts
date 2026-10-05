import { expect, test, type Page } from "@playwright/test";
import { freshPatientWithCover, signIn } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const DOCS = ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"];

async function upload(page: Page, label: string) {
  await page.getByLabel("Document type").selectOption({ label });
  await page.getByLabel(/^File/).setInputFiles({ name: `${label.replace(/\W+/g, "-")}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(`${label} uploaded.`)).toBeVisible();
}

/** Hospital staff submit a pre-authorization, so "Awaiting payer" has something real in it. Returns its reference. */
async function submitPreauth(page: Page) {
  const beneficiary = await freshPatientWithCover(page);
  await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}&claimType=cashless&admissionDate=2026-10-20&isAccident=no&pedDeclared=no&estimatedCost=80000&roomRentPerDay=4000`);
  await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
  await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
  const reference = (await page.getByRole("heading", { name: /Pre-auth PA-/ }).innerText()).match(/PA-[\w-]+/)![0];
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
  return reference;
}

/** The text of the Status column of the list's rows. */
const statuses = async (page: Page) => (await page.locator("tbody tr td:nth-child(2)").allInnerTexts()).map((t) => t.split("\n")[0]!.trim());
const card = (page: Page, name: string) => page.getByRole("link", { name: new RegExp(`^\\s*${name}`) });

test.describe("Hospital Staff dashboard: metric cards open the matching, already-filtered list", () => {
  test("Awaiting payer → Pre-authorizations, Awaiting payer tab selected, only waiting requests", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "staff.a@demo.claimix.invalid");
    const reference = await submitPreauth(page);

    await page.goto("/dashboard");
    const awaiting = card(page, "Awaiting payer");
    await expect(awaiting).toBeVisible();
    const before = (await awaiting.innerText()).replace(/\s+/g, " ");
    expect(await awaiting.getAttribute("href")).toBe("/pre-authorizations?view=review");
    expect(await awaiting.evaluate((e) => getComputedStyle(e).cursor)).toBe("pointer");
    await awaiting.click();

    await expect(page).toHaveURL(/\/pre-authorizations\?view=review$/);
    await expect(page.getByRole("heading", { name: "Pre-authorizations", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Awaiting payer", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: reference })).toBeVisible(); // the request just submitted
    const st = await statuses(page);
    expect(st.length).toBeGreaterThan(0);
    for (const s of st) expect(["Submitted", "Under review"], s).toContain(s);

    // The browser's Back returns to the dashboard, with the card and its value unchanged.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /Welcome, Kiran/ })).toBeVisible();
    expect((await card(page, "Awaiting payer").innerText()).replace(/\s+/g, " ")).toBe(before);
  });

  test("Pre-auths approved → Pre-authorizations, Approved tab selected, approvals only (no rejections)", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/dashboard");
    const approved = card(page, "Pre-auths approved");
    await expect(approved).toBeVisible();
    expect(await approved.getAttribute("href")).toBe("/pre-authorizations?view=approved");
    const count = Number((await approved.innerText()).replace(/\s+/g, " ").match(/Pre-auths approved (\d+)/)![1]);
    await approved.click();

    await expect(page).toHaveURL(/\/pre-authorizations\?view=approved$/);
    await expect(page.getByRole("link", { name: "Approved", exact: true })).toHaveAttribute("aria-current", "page");
    const st = await statuses(page);
    for (const s of st) expect(["Approved", "Partially approved", "Final approved", "Settled"], s).toContain(s);
    expect(st).not.toContain("Rejected");
    expect(st).not.toContain("Draft");
    // The list holds exactly what the card counted (first page covers it in the demo data; otherwise at least a full page).
    if (count <= 20) expect(st.length).toBe(count);
    else expect(st.length).toBeGreaterThanOrEqual(20);

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /Welcome, Kiran/ })).toBeVisible();
    await expect(card(page, "Pre-auths approved")).toBeVisible();
  });

  test("Settled (paid) → Claims, Settled tab selected, settled claims only", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/dashboard");
    const settled = card(page, "Settled \\(paid\\)");
    await expect(settled).toBeVisible();
    const before = (await settled.innerText()).replace(/\s+/g, " ");
    expect(await settled.getAttribute("href")).toBe("/claims?view=settled");
    await settled.click();

    await expect(page).toHaveURL(/\/claims\?view=settled$/);
    await expect(page.getByRole("heading", { name: "Claims", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settled", exact: true })).toHaveAttribute("aria-current", "page");
    const st = await statuses(page);
    for (const s of st) expect(s).toBe("Settled");

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /Welcome, Kiran/ })).toBeVisible();
    expect((await card(page, "Settled \\(paid\\)").innerText()).replace(/\s+/g, " ")).toBe(before); // the amount is unchanged
  });

  test("the whole card is the link; other cards stay plain; keyboard users can use it", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/dashboard");
    // Clicking on the card's padding (not the number or title) still navigates.
    const awaiting = card(page, "Awaiting payer");
    const box = (await awaiting.boundingBox())!;
    await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
    await expect(page).toHaveURL(/\/pre-authorizations\?view=review$/);
    await page.goBack();

    // Keyboard: focus the card and press Enter.
    await card(page, "Pre-auths approved").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/pre-authorizations\?view=approved$/);
    await page.goBack();

    // Cards that were not asked to link remain non-links.
    await expect(page.getByRole("link", { name: /^\s*Drafts/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^\s*Queries to answer/ })).toHaveCount(0);
  });

  test("hospital-level filtering is unchanged: another hospital's requests never appear", async ({ page }) => {
    await signIn(page, "staff.b@demo.claimix.invalid");
    await page.goto("/dashboard");
    for (const [name, href] of [["Awaiting payer", "/pre-authorizations?view=review"], ["Pre-auths approved", "/pre-authorizations?view=approved"], ["Settled \\(paid\\)", "/claims?view=settled"]] as const) {
      await page.goto("/dashboard");
      await card(page, name).click();
      await expect(page).toHaveURL(new RegExp(href.replace(/[?]/g, "\\?") + "$"));
      await expect(page.locator("tbody tr a", { hasText: /Sunrise/ })).toHaveCount(0);
      await expect(page.getByText("Sunrise Multispeciality Hospital")).toHaveCount(0);
    }
  });
});
