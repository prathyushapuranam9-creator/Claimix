import { expect, test } from "@playwright/test";
import { IDS, openMenuIfCollapsed, signIn } from "./helpers";

test.describe("patients", () => {
  test("hospital staff register a patient with validation feedback", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByText("Enter at least 2 characters.")).toBeVisible();

    // Names allow letters only, so make the unique suffix alphabetic.
    const name = `Test Patient ${Date.now().toString(36).replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)]!)}`;
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Date of birth").fill("1992-03-04");
    await page.getByLabel("Mobile number").fill("not-a-phone");
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByText(/Enter a valid phone number/)).toBeVisible();

    await page.getByLabel("Mobile number").fill("+91 98765 43210");
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Sunrise Multispeciality Hospital").first()).toBeVisible();
  });

  test("staff cannot open another hospital's patient by URL", async ({ page }) => {
    await signIn(page, "staff.b@demo.claimix.invalid");
    const res = await page.goto(`/patients/${IDS.patientA1}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("a patient sees only their own record", async ({ page }) => {
    await signIn(page, "patient.a1@demo.claimix.invalid");
    await page.goto("/patients");
    await expect(page.getByRole("link", { name: "Demo Patient Anil" })).toBeVisible();
    await expect(page.getByText("Demo Patient Bhavna")).toHaveCount(0);
    expect((await page.goto(`/patients/${IDS.patientA2}`))?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Register patient" })).toHaveCount(0);
  });

  test("insurers cannot open the registration form", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await page.goto("/patients/new");
    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("malformed ids render the not-found page, not an error", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    expect((await page.goto("/patients/not-a-uuid"))?.status()).toBe(404);
  });
});

test.describe("hospitals & network", () => {
  test("search by insurer network then state", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/hospitals");
    await page.getByLabel("Insurer network").selectOption({ label: "Aarogya Shield General Insurance (DEMO DATA)" });
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("link", { name: /Coastal Heart/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Lakeview/ })).toHaveCount(0);

    await page.getByLabel("State / UT").selectOption("Telangana");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("link", { name: /Sunrise/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Coastal Heart/ })).toHaveCount(0);
  });

  test("hospital detail separates private network from scheme empanelment; staff see no admin tools", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/hospitals/${IDS.hospitalA}`);
    await expect(page.getByRole("heading", { name: "Private insurance network" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Government scheme empanelment" })).toBeVisible();
    await expect(page.getByText("PM-JAY / Ayushman Bharat")).toBeVisible();
    await expect(page.getByText("Record or verify network status")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });

  test("admin records a network status", async ({ page }) => {
    await signIn(page, "admin@demo.claimix.invalid");
    await page.goto(`/hospitals/${IDS.hospitalA}`);
    await page.getByLabel("Payer type").selectOption("tpa");
    await page.getByRole("combobox", { name: "Payer", exact: true }).selectOption({ label: "CareLink TPA (DEMO DATA)" });
    await page.getByRole("button", { name: "Save network status" }).click();
    await expect(page.getByText("Network status saved")).toBeVisible();
    await expect(page.getByRole("cell", { name: "CareLink TPA (DEMO DATA)" })).toBeVisible();
  });
});

test.describe("administration", () => {
  test("admin invites a user; role picks the allowed organizations", async ({ page }) => {
    await signIn(page, "admin@demo.claimix.invalid");
    await page.goto("/admin/users/new");
    await expect(page.getByLabel("Organization")).toBeDisabled();
    await page.getByLabel("Role").selectOption({ label: "Payer Reviewer" });
    const orgOptions = await page.getByLabel("Organization").locator("option").allTextContents();
    expect(orgOptions.some((o) => o.includes("Suraksha"))).toBe(true);
    expect(orgOptions.some((o) => o.includes("Sunrise"))).toBe(false);

    await page.getByLabel("Full name").fill("Invited Reviewer");
    await page.getByLabel("Work email").fill(`e2e-${Date.now()}@test.claimix.invalid`);
    await page.getByLabel("Organization").selectOption({ label: "Suraksha Health Insurance (DEMO DATA)" });
    await page.getByRole("button", { name: "Create and send invite" }).click();
    await expect(page.getByText("Invitation sent")).toBeVisible();
  });

  test("non-admins cannot reach user administration and don't see it in navigation", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await openMenuIfCollapsed(page);
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("read-only users see reference data but not patients", async ({ page }) => {
    await signIn(page, "readonly@demo.claimix.invalid");
    await openMenuIfCollapsed(page);
    const nav = page.getByRole("complementary", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Hospitals & network" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Patients" })).toHaveCount(0);
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/forbidden/);
  });
});

test.describe("responsive layout", () => {
  test("key pages never scroll horizontally (tables scroll inside their card)", async ({ page }) => {
    await signIn(page, "admin@demo.claimix.invalid");
    for (const path of ["/dashboard", "/patients", `/patients/${IDS.patientA1}`, "/hospitals", `/hospitals/${IDS.hospitalA}`, "/insurers", "/tpas", "/admin/users", "/admin/users/new", "/patients/new", "/policies", "/policies/00000000-0000-4000-8000-0000000002a1?tab=limits", "/policies/00000000-0000-4000-8000-0000000002a1/rules", "/schemes", "/eligibility", "/pre-authorizations?view=all", "/claims?view=all", "/claims/new", "/rejection-reasons", "/documents", "/notifications", "/audit", "/assistant", "/assistant/reviews"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });
});
