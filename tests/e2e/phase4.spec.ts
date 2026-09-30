import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const FLOATER = "00000000-0000-4000-8000-0000000002a1";
const SURAKSHA = "00000000-0000-4000-8000-0000000002a2";

test("policy tabs explain rules in plain language", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto(`/policies/${FLOATER}`);
  await expect(page.getByText("Version 1 from")).toBeVisible();
  await page.getByRole("link", { name: "Waiting period" }).click();
  await expect(page.getByText("Cataract: 2 years waiting period from inception.")).toBeVisible();
  await page.getByRole("link", { name: "Limits" }).click();
  await expect(page.getByText(/Room rent up to 1% of sum insured per day/)).toBeVisible();
  await expect(page.getByText(/does not guarantee claim approval or payment/)).toBeVisible();
  // Staff can read but not manage rules.
  await expect(page.getByRole("link", { name: "Manage rules" })).toHaveCount(0);
});

test("private insurance and government schemes are listed separately", async ({ page }) => {
  await signIn(page, "readonly@demo.claimix.invalid");
  await page.goto("/policies");
  await expect(page.getByRole("link", { name: /Aarogya Family Floater/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /PM-JAY/ })).toHaveCount(0);
  await page.locator("#main").getByRole("link", { name: "Government schemes" }).click();
  await expect(page.getByRole("link", { name: /PM-JAY family health cover/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Aarogya Family Floater/ })).toHaveCount(0);
});

test("an insurer cannot open another insurer's policy", async ({ page }) => {
  await signIn(page, "insurer.a@demo.claimix.invalid");
  expect((await page.goto(`/policies/${SURAKSHA}`))?.status()).toBe(404);
  expect((await page.goto(`/policies/${FLOATER}`))?.status()).toBe(200);
});

test("admin creates a policy, drafts a rule with live preview, and publishes it", async ({ page }) => {
  await signIn(page, "admin@demo.claimix.invalid");
  await page.goto("/policies/new");
  await page.getByLabel("Product type").selectOption("individual");
  await page.getByLabel("Policy name").fill("Playwright Test Policy");
  await page.getByRole("combobox", { name: "Insurer", exact: true }).selectOption({ label: "Navjeevan General Insurance (DEMO DATA)" });
  await page.getByRole("button", { name: "Save and add rules" }).click();
  await expect(page).toHaveURL(/\/rules$/);

  await page.getByRole("button", { name: "Create first draft" }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule type").selectOption({ label: "Age range" });
  await expect(page.getByText("Patient age must be at least 18 and at most 65 years on the admission date.")).toBeVisible();
  await page.getByLabel("Code").fill("age_limit");
  await page.getByLabel("Title").fill("Adults only");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Adults only", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish version" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Active v1" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "active" })).toBeVisible();
});
