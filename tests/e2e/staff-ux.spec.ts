import { expect, test, type Page } from "@playwright/test";
import { freshPatientWithCover, signIn } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");

async function fillCase(page: Page) {
  await page.getByLabel("Expected admission date").fill("2026-10-15");
  await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
  await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
  await page.getByLabel("Due to an accident?").selectOption("no");
  await page.getByLabel("Pre-existing disease declared?").selectOption("no");
  await page.getByLabel("Estimated cost (₹)").fill("95000");
  await page.getByLabel("Room rent per day (₹)").fill("4000");
}

test.describe("Hospital staff: eligibility result, documents and workflow layout", () => {
  test("sidebar entry is named Insurers / Providers", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await expect(page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Insurers / Providers" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Policies", exact: true })).toHaveCount(0);
  });

  test("a check shows only the outcome; details open on request; Check again keeps everything entered; no repeated results", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "staff.a@demo.claimix.invalid");
    const beneficiary = await freshPatientWithCover(page);
    await page.goto(`/eligibility?beneficiary=${beneficiary}`);
    await fillCase(page);
    await page.getByRole("button", { name: "Check eligibility" }).click();

    const result = page.locator("#eligibility-result");
    await expect(result.getByRole("heading", { name: /^(Eligible|Not eligible|Needs verification)$/ })).toBeVisible();
    // Outcome only: no checks, no document list, until "View details".
    await expect(page.getByRole("heading", { name: "Documents that will be needed" })).toHaveCount(0);
    await expect(result.getByRole("button", { name: "View details" })).toBeVisible();
    await expect(result.getByRole("button", { name: "Check again" })).toBeVisible();

    await result.getByRole("button", { name: "View details" }).click();
    await expect(page.getByRole("heading", { name: "Documents that will be needed" })).toBeVisible();

    // Documents list: names, requirement badges and stages each line up in their own column.
    const rows = page.locator("ul li").filter({ has: page.getByText(/^(Mandatory|If applicable)$/) });
    const n = await rows.count();
    expect(n).toBeGreaterThan(1);
    const xs = await rows.evaluateAll((els) => els.map((li) => {
      const kids = [...li.children] as HTMLElement[];
      return kids.map((k) => Math.round(k.getBoundingClientRect().left));
    }));
    for (const r of xs) expect(r).toEqual(xs[0]);

    // Change one detail and check again: nothing has to be re-entered, and the form still holds every value.
    await page.getByLabel("Estimated cost (₹)").fill("120000");
    await result.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByLabel("Expected admission date")).toHaveValue("2026-10-15");
    await expect(page.getByLabel("Estimated cost (₹)")).toHaveValue("120000");
    await expect(result.getByRole("button", { name: "View details" })).toBeVisible(); // a fresh outcome, details closed again

    // Several checks, but the page never repeats them: one current result plus a short list of earlier ones.
    await result.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByText("Eligibility result", { exact: true })).toHaveCount(1);
    const history = page.getByRole("region", { name: "Previous eligibility checks" });
    await expect(page.getByRole("heading", { name: "Previous eligibility checks", exact: true })).toBeVisible(); // no count in the title
    await expect(history.getByRole("listitem")).toHaveCount(3); // all 3 checks stay listed, each collapsed
    await expect(history.getByText("Latest", { exact: true })).toHaveCount(1); // only on the newest
    await expect(history.getByRole("listitem").first().getByText("Latest", { exact: true })).toBeVisible();
    await expect(history.getByRole("button", { name: "Hide details" })).toHaveCount(0);
    await expect(history.getByRole("heading", { name: /Eligible|Needs verification/ })).toHaveCount(0); // collapsed, no repeated details

    // Coming back to the page restores what was entered.
    await page.reload();
    await expect(page.getByLabel("Estimated cost (₹)")).toHaveValue("120000");
    await expect(page.getByLabel("Expected admission date")).toHaveValue("2026-10-15");
  });

  test("an uploaded document can be deleted from a draft, after confirmation", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "staff.a@demo.claimix.invalid");
    const beneficiary = await freshPatientWithCover(page);
    await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}&claimType=cashless&admissionDate=2026-10-20&isAccident=no&pedDeclared=no&estimatedCost=80000&roomRentPerDay=4000`);
    await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
    await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);

    await page.getByLabel("Document type").selectOption({ label: "Photo ID proof" });
    await page.getByLabel(/^File/).setInputFiles({ name: "id-proof.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("Photo ID proof uploaded.")).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: "id-proof.pdf" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Delete id-proof.pdf" }).click(); // an icon button
    const dialog = page.getByRole("dialog", { name: "Delete this document?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click(); // cancelling keeps it
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Delete id-proof.pdf" }).click();
    await page.getByRole("dialog", { name: "Delete this document?" }).getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByRole("row").filter({ hasText: "id-proof.pdf" })).toHaveCount(0);
    // It can be uploaded again afterwards.
    await page.getByLabel("Document type").selectOption({ label: "Photo ID proof" });
    await page.getByLabel(/^File/).setInputFiles({ name: "id-proof-2.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "id-proof-2.pdf" })).toBeVisible();
  });

  test("the Insurance workflow fills the whole card width and stays tidy on a phone", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await freshPatientWithCover(page);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 800 }, { width: 390, height: 800 }]) {
      await page.setViewportSize(viewport);
      const steps = page.getByRole("navigation", { name: "Hospital workflow progress" }).first();
      await expect(steps).toBeVisible();
      const geo = await steps.evaluate((nav) => {
        const ol = nav.querySelector("ol")!;
        const items = [...ol.children] as HTMLElement[];
        const o = ol.getBoundingClientRect();
        const first = items[0]!.getBoundingClientRect();
        const rows = new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)));
        return { n: items.length, olLeft: o.left, olRight: o.right, firstLeft: first.left, lastRight: Math.max(...items.map((li) => li.getBoundingClientRect().right)), rows: rows.size, overflow: document.documentElement.scrollWidth > window.innerWidth };
      });
      expect(geo.overflow, `no horizontal scroll at ${viewport.width}px`).toBe(false);
      // The steps use the full width of the section: first starts at its left edge, the last ends at its right edge.
      expect(Math.abs(geo.lastRight - geo.olRight), `right edge at ${viewport.width}px`).toBeLessThan(2);
      expect(Math.abs(geo.firstLeft - geo.olLeft)).toBeLessThan(2);
      if (viewport.width >= 1024) expect(geo.rows, "a single row on wide screens").toBe(1);
    }
  });
});
