import { expect, test, type Browser, type Page } from "@playwright/test";
import { alphaId, signIn } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const DOCS = ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"];
const AAROGYA = "Aarogya Shield General Insurance (DEMO DATA)";
const NAVJEEVAN = "Navjeevan General Insurance (DEMO DATA)";
const SURAKSHA = "Suraksha Health Insurance (DEMO DATA)";

async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, ctx, close: () => ctx.close() };
}

async function upload(page: Page, label: string) {
  await page.getByLabel("Document type").selectOption({ label });
  await page.getByLabel(/^File/).setInputFiles({ name: `${label.replace(/\W+/g, "-")}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(`${label} uploaded.`)).toBeVisible();
}

/** Hospital staff: a new patient covered by `policy`, a pre-authorization, and its submission. */
async function submitPreauth(page: Page, policy: string) {
  const suffix = alphaId();
  const patientName = `Ctx Journey ${suffix}`;
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(patientName);
  await page.getByLabel("Date of birth").fill("1984-05-05");
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Add coverage" }).click();
  await page.getByLabel("Policy / scheme").selectOption({ label: policy });
  await page.getByLabel("Member / beneficiary ID").fill(`CTX-${suffix}`.toUpperCase());
  await page.getByLabel("Relationship to policyholder").selectOption("self");
  await page.getByLabel("First inception date").fill("2021-04-01");
  await page.getByLabel("Cover start").fill("2026-04-01");
  await page.getByLabel("Cover end").fill("2027-03-31");
  await page.getByLabel("Sum insured (₹)").fill("500000");
  await page.getByLabel("Available balance (₹)").fill("400000");
  await page.getByRole("button", { name: "Save coverage" }).click();
  const link = page.getByRole("link", { name: "Check eligibility" }).first();
  await link.waitFor();
  const beneficiary = new URL((await link.getAttribute("href"))!, "http://x").searchParams.get("beneficiary")!;

  await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}&claimType=cashless&admissionDate=2026-10-20&isAccident=no&pedDeclared=no&estimatedCost=80000&roomRentPerDay=4000`);
  await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
  await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
  const url = page.url();
  const reference = (await page.getByRole("heading", { name: /Pre-auth PA-/ }).innerText()).match(/PA-[\w-]+/)![0];
  for (const l of DOCS) await upload(page, l);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  for (let i = 0; i < 15; i++) {
    const verify = page.getByRole("button", { name: "Record verification" }).first();
    if (await verify.count()) {
      await page.getByLabel("Verification note").first().fill("Verified with the payer's network desk by phone.");
      await verify.click();
      await page.waitForTimeout(700);
      continue;
    }
    const confirm = page.getByRole("button", { name: "Confirm", exact: true }).first();
    if (await confirm.count()) {
      await confirm.click();
      await page.waitForTimeout(700);
      continue;
    }
    break;
  }
  const anyway = page.getByLabel("Reason for submitting anyway");
  if (await anyway.count()) await anyway.fill("Hospital confirms the cover applies; the payer will make the decision.");
  await page.getByRole("button", { name: "Submit Pre-Authorization" }).click();
  await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
  await expect(page.locator("#main").getByText("Submitted", { exact: true }).first()).toBeVisible();
  return { reference, url, patientName };
}

const refLink = (page: Page, reference: string) => page.getByRole("link", { name: reference });
const banner = (page: Page) => page.getByRole("status", { name: "Current testing context" });

/** Chooses a company and role in the two selectors on the dashboard, then applies. */
async function choose(page: Page, company: string, role?: string) {
  await page.goto("/dashboard");
  await page.getByLabel("Insurance Company").selectOption({ label: company });
  const roleSelect = page.getByLabel("Role", { exact: true });
  const roleOptions = (await roleSelect.locator("option").allInnerTexts()).filter((t) => t !== "Select Role");
  expect(roleOptions.length, `roles offered for ${company}`).toBeGreaterThan(0);
  await roleSelect.selectOption({ label: role ?? roleOptions[0]! });
  await page.getByRole("button", { name: "Switch Context" }).click();
}

test("one common login: Aarogya → Navjeevan → Suraksha through the insurance context, no second sign-in", async ({ page, browser }) => {
  test.setTimeout(480_000);

  // Hospital staff submit one pre-authorization to each of the three insurers.
  await signIn(page, "staff.a@demo.claimix.invalid");
  const a = await submitPreauth(page, "Aarogya Family Floater Plus (DEMO DATA)");
  const n = await submitPreauth(page, "Navjeevan Super Top-Up 10L (DEMO DATA)");
  const s = await submitPreauth(page, "Suraksha Individual Health Secure (DEMO DATA)");

  // --- Common login (once) and the two selectors at the top of the dashboard.
  const admin = await as(browser, "admin@demo.claimix.invalid");
  const p = admin.page;
  const sessionCookie = async () => (await admin.ctx.cookies()).find((c) => c.name.includes("claimix_session"))?.value;
  const session = await sessionCookie();
  expect(session).toBeTruthy();
  let sawLogin = false;
  p.on("framenavigated", (f) => { if (f === p.mainFrame() && /\/login/.test(f.url())) sawLogin = true; });

  await p.goto("/dashboard");
  await expect(p.getByLabel("Insurance Company")).toHaveValue("");
  await expect(p.getByLabel("Role", { exact: true })).toHaveValue("");
  await expect(p.getByLabel("Role", { exact: true })).toBeDisabled(); // until a company is chosen
  const companies = await p.getByLabel("Insurance Company").locator("option").allInnerTexts();
  expect(companies[0]).toBe("All Insurers");
  for (const name of [AAROGYA, NAVJEEVAN, SURAKSHA, "MediAssist Claims Services (DEMO DATA)"]) expect(companies).toContain(name);
  await expect(banner(p)).toHaveCount(0);

  // --- 1. Aarogya Shield → Payer Reviewer
  await choose(p, AAROGYA, "Payer Reviewer");
  await expect(banner(p)).toContainText(`Insurance: ${AAROGYA}`);
  await expect(banner(p)).toContainText("Role: Payer Reviewer");
  await expect(p.getByText("Actionable workflows")).toBeVisible(); // the reviewer's dashboard
  await p.goto("/pre-authorizations?view=all");
  await expect(banner(p)).toBeVisible(); // the indicator follows you to every page
  await expect(refLink(p, a.reference)).toBeVisible();
  await expect(refLink(p, n.reference)).toHaveCount(0);
  await expect(refLink(p, s.reference)).toHaveCount(0);
  await p.goto("/patients");
  await expect(p.getByRole("link", { name: a.patientName })).toBeVisible();
  await expect(p.getByRole("link", { name: n.patientName })).toHaveCount(0);
  await p.goto("/documents");
  await expect(p.getByRole("link", { name: a.reference }).first()).toBeVisible();
  await expect(p.getByRole("link", { name: n.reference })).toHaveCount(0);
  await p.goto("/policies");
  await expect(p.getByRole("link", { name: /Aarogya Family Floater/ })).toBeVisible();
  await expect(p.getByRole("link", { name: /Navjeevan Super Top-Up/ })).toHaveCount(0);
  for (const path of ["/claims?view=all", "/notifications", "/reports"]) {
    expect((await p.goto(path))?.status(), path).toBe(200);
    await expect(banner(p)).toBeVisible();
  }
  expect((await p.goto(n.url))?.status()).toBe(404); // another company's request is not reachable
  // Exactly the reviewer's reach: the administrator pages are closed in this context.
  await p.goto("/admin/users");
  await expect(p).toHaveURL(/\/forbidden/);

  // --- 2. Switch Context → Navjeevan → Payer Reviewer (no sign-in)
  await p.goto("/pre-authorizations?view=all");
  await banner(p).getByRole("button", { name: "Switch Context" }).click(); // opens the switcher in place, on any page
  await expect(p).toHaveURL(/\/pre-authorizations/);
  await expect(p.getByLabel("Insurance Company")).toHaveValue(/[0-9a-f-]{36}/); // current context preselected
  await choose(p, NAVJEEVAN, "Payer Reviewer");
  await expect(banner(p)).toContainText(`Insurance: ${NAVJEEVAN}`);
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, n.reference)).toBeVisible();
  await expect(refLink(p, a.reference)).toHaveCount(0);
  await expect(refLink(p, s.reference)).toHaveCount(0);
  await p.goto("/policies");
  await expect(p.getByRole("link", { name: /Navjeevan Super Top-Up/ })).toBeVisible();
  await expect(p.getByRole("link", { name: /Aarogya Family Floater/ })).toHaveCount(0);

  // --- 3. Switch → Suraksha → its insurer role (whatever role the database offers for it)
  await choose(p, SURAKSHA);
  await expect(banner(p)).toContainText(`Insurance: ${SURAKSHA}`);
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, s.reference)).toBeVisible();
  await expect(refLink(p, a.reference)).toHaveCount(0);
  await expect(refLink(p, n.reference)).toHaveCount(0);

  // --- The real role's permissions apply: Suraksha's reviewer can open and decide its own request.
  await p.goto(s.url);
  await expect(p.getByLabel("Decision")).toBeVisible();

  // --- One sign-in throughout: same session cookie, never sent back to the login page.
  expect(await sessionCookie()).toBe(session);
  expect(sawLogin).toBe(false);

  // --- Exit returns to the account's own (administrator) view.
  await p.goto("/dashboard");
  await p.getByRole("button", { name: "Exit testing context" }).click();
  await expect(banner(p)).toHaveCount(0);
  await expect(p.getByLabel("Insurance Company")).toHaveValue("");
  await p.goto("/admin/users");
  await expect(p).toHaveURL(/\/admin\/users/);
  await admin.close();
});

test("insurer reviewers get the testing block for their own company only; other companies stay out of reach", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page, "staff.a@demo.claimix.invalid");
  const a = await submitPreauth(page, "Aarogya Family Floater Plus (DEMO DATA)");
  const n = await submitPreauth(page, "Navjeevan Super Top-Up 10L (DEMO DATA)");

  const rev = await as(browser, "insurer.a@demo.claimix.invalid");
  const p = rev.page;
  await p.goto("/dashboard");
  // The same block as the testing login, on the reviewer's own dashboard.
  await expect(p.getByRole("heading", { name: "Insurance portal testing" })).toBeVisible();
  const company = p.getByLabel("Insurance Company");
  const role = p.getByLabel("Role", { exact: true });
  // Every insurance company is listed, but only its own can be chosen; no "All Insurers", no TPAs.
  for (const other of [NAVJEEVAN, SURAKSHA]) await expect(company.locator("option", { hasText: other })).toBeDisabled();
  await expect(company.locator("option", { hasText: NAVJEEVAN })).toContainText("not available for your account");
  await expect(company.locator("option:not([disabled])")).toHaveText([AAROGYA]);
  await expect(company.locator("option", { hasText: "All Insurers" })).toHaveCount(0);
  await expect(company.locator("option", { hasText: /MediAssist|CareLink/ })).toHaveCount(0);
  await expect(company.locator("option:checked")).toHaveText(AAROGYA);
  await expect(role.locator("option:checked")).toHaveText("Payer Reviewer");
  await expect(banner(p)).toHaveCount(0);

  // Switching works exactly as for the testing login, and shows its own company's data only.
  await choose(p, AAROGYA, "Payer Reviewer");
  await expect(banner(p)).toContainText(`Insurance: ${AAROGYA}`);
  await expect(banner(p)).toContainText("Role: Payer Reviewer");
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, a.reference)).toBeVisible();
  await expect(refLink(p, n.reference)).toHaveCount(0);
  expect((await p.goto(n.url))?.status()).toBe(404);
  // Back to its normal view.
  await p.goto("/dashboard");
  await p.getByRole("button", { name: "Back to my own company" }).click();
  await expect(banner(p)).toHaveCount(0);

  // A made-up context cookie changes nothing.
  await rev.ctx.addCookies([{ name: "claimix_context", value: "eyJzIjoieCJ9.deadbeef", url: "http://localhost:3100" }]);
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, n.reference)).toHaveCount(0);
  expect((await p.goto(n.url))?.status()).toBe(404);
  await expect(banner(p)).toHaveCount(0);
  await rev.close();

  // Hospital staff don't get it.
  await page.goto("/dashboard");
  await expect(page.getByLabel("Insurance Company")).toHaveCount(0);
});

test("the designated insurance login (a payer reviewer, like Vikram) switches company and role from its own dashboard", async ({ page, browser }) => {
  test.setTimeout(480_000);
  await signIn(page, "staff.a@demo.claimix.invalid");
  const a = await submitPreauth(page, "Aarogya Family Floater Plus (DEMO DATA)");
  const n = await submitPreauth(page, "Navjeevan Super Top-Up 10L (DEMO DATA)");
  const s = await submitPreauth(page, "Suraksha Individual Health Secure (DEMO DATA)");

  // Login once, as the flagged payer reviewer.
  const portal = await as(browser, "insurer.portal@demo.claimix.invalid");
  const p = portal.page;
  const sessionCookie = async () => (await portal.ctx.cookies()).find((c) => c.name.includes("claimix_session"))?.value;
  const session = await sessionCookie();
  let sawLogin = false;
  p.on("framenavigated", (f) => { if (f === p.mainFrame() && /\/login/.test(f.url())) sawLogin = true; });

  // The selectors are on the existing payer dashboard, right under "Welcome… Payer Reviewer · Aarogya…", no other page needed.
  await p.goto("/dashboard");
  await expect(p.getByRole("heading", { name: /Welcome, Portal/ })).toBeVisible();
  await expect(p.locator("#main").getByText(/Payer Reviewer · Aarogya Shield General Insurance/)).toBeVisible();
  await expect(p.getByText("Actionable workflows")).toBeVisible(); // the existing payer dashboard
  const company = p.getByLabel("Insurance Company");
  const role = p.getByLabel("Role", { exact: true });
  await expect(company.locator("option:checked")).toHaveText(AAROGYA); // preselected to the account's own company
  await expect(role.locator("option:checked")).toHaveText("Payer Reviewer");
  await expect(p.getByRole("button", { name: "Switch Context" })).toBeVisible();
  const [cBox, hBox, wBox] = await Promise.all([company.boundingBox(), p.getByRole("heading", { name: /Welcome, Portal/ }).boundingBox(), p.getByText("Actionable workflows").boundingBox()]);
  expect(cBox!.y).toBeGreaterThan(hBox!.y); // under the welcome header...
  expect(cBox!.y).toBeLessThan(wBox!.y); // ...and above the dashboard content
  await expect(company.locator("option", { hasText: "All Insurers" })).toHaveCount(0); // an insurer login always has a company
  await expect(banner(p)).toHaveCount(0); // not switched yet

  // Its own company's data.
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, a.reference)).toBeVisible();
  await expect(refLink(p, n.reference)).toHaveCount(0);

  // Navjeevan → Payer Reviewer: the same dashboard now shows Navjeevan.
  await choose(p, NAVJEEVAN, "Payer Reviewer");
  await expect(banner(p)).toContainText(`Insurance: ${NAVJEEVAN}`);
  await expect(banner(p)).toContainText("Role: Payer Reviewer");
  await expect(p.getByText("Actionable workflows")).toBeVisible();
  await expect(p.getByLabel("Insurance Company").locator("option:checked")).toHaveText(NAVJEEVAN);
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, n.reference)).toBeVisible();
  await expect(refLink(p, a.reference)).toHaveCount(0);
  await expect(refLink(p, s.reference)).toHaveCount(0);

  // Aarogya again, then Suraksha.
  await choose(p, AAROGYA, "Payer Reviewer");
  await expect(banner(p)).toContainText(`Insurance: ${AAROGYA}`);
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, a.reference)).toBeVisible();
  await expect(refLink(p, n.reference)).toHaveCount(0);
  await choose(p, SURAKSHA);
  await expect(banner(p)).toContainText(`Insurance: ${SURAKSHA}`);
  await p.goto("/pre-authorizations?view=all");
  await expect(refLink(p, s.reference)).toBeVisible();
  await expect(refLink(p, a.reference)).toHaveCount(0);
  await expect(refLink(p, n.reference)).toHaveCount(0);

  // Back to its own company; one sign-in throughout.
  await p.goto("/dashboard");
  await p.getByRole("button", { name: "Back to my own company" }).click();
  await expect(banner(p)).toHaveCount(0);
  await expect(p.getByLabel("Insurance Company").locator("option:checked")).toHaveText(AAROGYA);
  expect(await sessionCookie()).toBe(session);
  expect(sawLogin).toBe(false);
  await portal.close();
});

test("an administrator turns cross-insurer testing on and off for a reviewer account", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await as(browser, "admin@demo.claimix.invalid");
  const a = admin.page;
  const toggle = async (on: boolean) => {
    await a.goto("/admin/users?q=insurer.b@demo.claimix.invalid");
    await a.getByRole("link", { name: /Nisha Reviewer/ }).first().click();
    const box = a.getByLabel(/Insurance portal testing access/);
    await box.setChecked(on);
    await a.getByRole("button", { name: "Save changes" }).click();
    await expect(a.getByText(/^Saved\./)).toBeVisible();
  };
  try {
    const rev = await as(browser, "insurer.b@demo.claimix.invalid");
    await rev.page.goto("/dashboard");
    const company = rev.page.getByLabel("Insurance Company");
    await expect(company.locator("option:not([disabled])")).toHaveText([SURAKSHA]); // ordinary reviewer: only its own company can be chosen

    await toggle(true);
    await rev.page.reload();
    await expect(company.locator("option:checked")).toHaveText(SURAKSHA); // every insurer, without signing in again
    await expect(company.locator("option", { hasText: AAROGYA })).toBeEnabled();
    await expect(company.locator("option", { hasText: NAVJEEVAN })).toBeEnabled();

    await toggle(false);
    await rev.page.reload();
    await expect(company.locator("option:not([disabled])")).toHaveText([SURAKSHA]);
    await rev.close();
  } finally {
    await toggle(false).catch(() => undefined);
    await admin.close();
  }
});
