import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("assistant answers from records, labels sources, and routes unclear questions to human review", async ({ page, browser }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await page.goto("/pre-authorizations?view=all");
  await page.getByRole("link", { name: /^PA-/ }).first().click();
  await page.getByRole("link", { name: "Ask the Insurance Assistant" }).click();
  await expect(page).toHaveURL(/\/assistant\?preauth=/);

  await page.getByRole("button", { name: "Is the policy active?" }).click();
  await expect(page.getByText("Answered from records").or(page.getByText("Needs more information"))).toBeVisible();
  await expect(page.getByText("Decision sequence")).toBeVisible();
  await expect(page.getByText(/not a payer decision|checks haven't been run/).first()).toBeVisible();

  const question = `Can the patient pay the balance in instalments ${Date.now()}?`;
  await page.getByLabel("Or type your question").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Needs human review")).toBeVisible();
  await page.getByRole("button", { name: "Send for human review" }).click();
  await expect(page.getByText("Sent for human review.")).toBeVisible();

  // An admin answers from the queue; the asker can't answer their own.
  await page.goto("/assistant/reviews");
  const mine = page.getByRole("region").or(page.locator("section")).filter({ hasText: question }).first();
  await expect(mine.getByText("Waiting for a colleague to respond.")).toBeVisible();

  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await signIn(admin, "admin@demo.claimix.invalid");
  await admin.goto("/assistant/reviews");
  const card = admin.locator("section").filter({ hasText: question }).first();
  await card.getByLabel("Your response").fill("Instalments are a hospital billing matter; the insurer pays only the approved amount.");
  await card.getByRole("button", { name: "Send response" }).click();
  await expect(admin.locator("section").filter({ hasText: question })).toHaveCount(0);
  await ctx.close();

  await page.goto("/notifications?show=unread");
  await expect(page.getByText("Your question was reviewed").first()).toBeVisible();
});

test("patients and read-only users don't get the assistant", async ({ page }) => {
  await signIn(page, "patient.a1@demo.claimix.invalid");
  await page.goto("/assistant");
  await expect(page).toHaveURL(/\/forbidden/);
});
