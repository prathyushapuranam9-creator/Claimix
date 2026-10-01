import { expect, test } from "@playwright/test";
import { alphaId, openMenuIfCollapsed, signIn } from "./helpers";

const overflowOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("public website", () => {
  test("landing page: hero, calls to action, workflow and disclaimer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Simplify Health Insurance & Hospital Claims" })).toBeVisible();
    for (const name of ["Check Eligibility", "Explore Insurance", "Hospital Login", "Learn How It Works"]) {
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByText("it does not guarantee claim approval or payment").first()).toBeVisible();
    await page.getByRole("link", { name: "Explore Insurance", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Private health insurance" })).toBeVisible();
  });

  test("government schemes page says ABDM is not insurance; cashless page says it isn't free", async ({ page }) => {
    await page.goto("/insurance/government");
    await expect(page.getByRole("heading", { name: "ABDM and ABHA are not insurance" })).toBeVisible();
    await page.goto("/cashless-vs-reimbursement");
    await expect(page.getByRole("heading", { name: "Cashless does not mean everything is free." })).toBeVisible();
  });

  test("knowledge center lists 16 guides and opens one; glossary search works without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/knowledge");
    await expect(page.locator("main a[href^='/knowledge/']")).toHaveCount(16);
    await page.getByRole("link", { name: /What is co-pay\?/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "What is co-pay?" })).toBeVisible();
    await expect(page.getByText("Example:")).toBeVisible();

    await page.goto("/glossary");
    await page.getByLabel("Search terms").fill("deductible");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=deductible/);
    const term = page.getByRole("region", { name: "Deductible" });
    await expect(term).toBeVisible();
    for (const dt of ["Simple explanation", "Example", "Why it matters"]) await expect(term.getByText(dt, { exact: true })).toBeVisible();
    await context.close();
  });

  test("public network search: insurer → city → hospital, reference fields only", async ({ page }) => {
    await page.goto("/network");
    await expect(page.getByText("Choose an insurer or scheme to see hospitals")).toBeVisible();
    const payer = page.getByRole("combobox", { name: /Insurance or scheme/ });
    const firstInsurer = await payer.locator("optgroup[label='Private insurers'] option").first().getAttribute("value");
    await payer.selectOption(firstInsurer!);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("heading", { name: "Network hospitals" })).toBeVisible();
    const table = page.getByRole("region", { name: "Network hospitals" });
    await expect(table.getByRole("columnheader")).toHaveText(["Hospital", "Location", "Status", "Last verified"]);
    // City is enabled now; narrowing keeps the payer.
    const city = page.getByRole("combobox", { name: "City" });
    await expect(city).toBeEnabled();
    const firstCity = await city.locator("option").nth(1).getAttribute("value");
    if (firstCity) {
      await city.selectOption(firstCity);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(new RegExp(`city=${encodeURIComponent(firstCity).replace(/%20/g, "\\+")}`));
    }
  });

  test("mobile menu works and public pages don't overflow on a phone", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "phone layout only");
    await page.goto("/");
    await page.getByLabel("Menu").click();
    await page.getByRole("navigation", { name: "Main (mobile)" }).getByRole("link", { name: "Glossary" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Insurance glossary" })).toBeVisible();
    for (const path of ["/", "/about", "/insurance/private", "/insurance/government", "/cashless-vs-reimbursement", "/knowledge", "/knowledge/why-claims-get-rejected", "/glossary", "/network", "/register"]) {
      await page.goto(path);
      expect(await overflowOf(page), `${path} overflows`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("request access", () => {
  test("a request is recorded for review, never creating an account; an admin declines it", async ({ page }) => {
    const email = `e2e.${alphaId()}@example.test`;
    // Act as a distinct client behind the (single) trusted proxy, so reruns don't share the per-IP limit.
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` });
    await page.goto("/register");
    await page.getByLabel("Full name").fill("Access Requester");
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("textbox", { name: /^Organization/ }).fill("Example Care Hospital");
    await page.getByRole("combobox", { name: /Organization type/ }).selectOption("hospital");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("No account has been created yet.")).toBeVisible();

    // No account exists: signing in with that email fails.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("whatever-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    await page.setExtraHTTPHeaders({});
    await signIn(page, "admin@demo.claimix.invalid");
    await page.goto(`/admin/access-requests?q=${encodeURIComponent(email)}&status=pending`);
    const group = page.getByRole("group", { name: "Decision for Access Requester" });
    await group.getByLabel("Note (optional)").fill("Could not verify.");
    await group.getByRole("button", { name: "Decline" }).click();
    await expect(group).toHaveCount(0);
    await page.goto(`/admin/access-requests?q=${encodeURIComponent(email)}&status=declined`);
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("Could not verify.", { exact: false })).toBeVisible();
  });

  test("non-admins cannot open the access request queue", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/admin/access-requests");
    await expect(page).toHaveURL(/\/forbidden/);
  });
});

test.describe("dashboards and reports", () => {
  test("each role sees its own dashboard", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await expect(page.getByText("Queries to answer")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pre-authorizations needing action" })).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await expect(page.getByText("Pre-auths awaiting decision")).toBeVisible();
    await expect(page.getByText("Queries to answer")).toHaveCount(0);

    // Patient and read-only users have no dashboard: /dashboard sends them to their landing page.
    await page.context().clearCookies();
    await signIn(page, "patient.a1@demo.claimix.invalid");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/patients/);

    await page.context().clearCookies();
    await signIn(page, "readonly@demo.claimix.invalid");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/hospitals/);

    await page.context().clearCookies();
    await signIn(page, "admin@demo.claimix.invalid");
    await expect(page.getByText("Access requests", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Failed jobs")).toBeVisible();
  });

  test("reports: filters, chart with table view, and a scoped CSV export", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await openMenuIfCollapsed(page);
    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await page.getByRole("link", { name: "All time" }).click();
    await expect(page).toHaveURL(/range=all/);
    await expect(page.getByRole("list", { name: "Pre-authorizations by status" })).toBeVisible();
    const chart = page.getByRole("group", { name: "Claims submitted per month" });
    if (await chart.count()) {
      await page.getByText("Show as table").click();
      await expect(page.getByRole("table", { name: "Claims submitted per month" })).toBeVisible();
    }
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^claimix-report-\d{4}-\d{2}-\d{2}\.csv$/);

    // Custom range in the far past: empty, not an error.
    await page.goto("/reports?range=custom&from=1990-01-01&to=1990-12-31");
    await expect(page.getByText("No pre-authorizations in this period")).toBeVisible();

    const overflow = await overflowOf(page);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("patients cannot open reports or the export", async ({ page }) => {
    await signIn(page, "patient.a1@demo.claimix.invalid");
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/forbidden/);
    const res = await page.request.get("/api/reports/export");
    expect(res.status()).toBe(403);
  });
});
