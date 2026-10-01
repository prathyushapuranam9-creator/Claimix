import { expect, test, type Page } from "@playwright/test";

import { PASSWORD } from "./helpers";

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function openMenuIfCollapsed(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
}

test("anonymous visitors are sent to login from protected pages", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong credentials show a generic error", async ({ page }) => {
  await signIn(page, `nobody-${Date.now()}@demo.claimix.invalid`, "definitely-wrong-1");
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password." })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("client-side validation blocks empty submission", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
});

test("hospital staff can sign in, see their scope, and sign out", async ({ page }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator("#main").getByText("Hospital Staff · Sunrise Multispeciality Hospital")).toBeVisible();
  // Hospital dashboard, and navigation limited to the role's permissions.
  await expect(page.getByText("Queries to answer")).toBeVisible();
  await openMenuIfCollapsed(page);
  const nav = page.getByRole("complementary", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Claims" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("session cookie is httpOnly and SameSite=Lax", async ({ page, context }) => {
  await signIn(page, "insurer.a@demo.claimix.invalid");
  await expect(page).toHaveURL(/\/dashboard/);
  const cookie = (await context.cookies()).find((c) => c.name.includes("claimix_session"));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});

test("patients have no dashboard and no staff navigation", async ({ page }) => {
  await signIn(page, "patient.a1@demo.claimix.invalid");
  await expect(page).toHaveURL(/\/patients/);
  await openMenuIfCollapsed(page);
  const nav = page.getByRole("complementary", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Eligibility checker" })).toHaveCount(0);
});

test("post-login redirect ignores off-site targets", async ({ page }) => {
  await page.goto("/login?next=//evil.example.com");
  await page.getByLabel("Email").fill("staff.b@demo.claimix.invalid");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:3100\/dashboard/);
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["x-request-id"]).toBeTruthy();
});

test("mutating API calls from another origin are refused", async ({ request }) => {
  const res = await request.post("/api/health", { headers: { origin: "https://evil.example.com" } });
  expect(res.status()).toBe(403);
});

test("health endpoint reports database status", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
});
