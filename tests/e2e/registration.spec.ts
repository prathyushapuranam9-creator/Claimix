import { expect, test, type Page } from "@playwright/test";
import { alphaId, registerPatient, signIn } from "./helpers";

/**
 * The Hospital Staff registration workflow in the browser:
 * find or register the patient → doctor & slot → payment & register → patient registered.
 * The patient must not exist until the last step completes.
 */

const step = (page: Page, n: 1 | 2 | 3) => page.getByRole("heading", { name: new RegExp(`Step ${n}`) });
const freeSlots = (page: Page) => page.locator('button[data-state="free"]');

async function startNewPatient(page: Page, name: string, dob = "1984-05-05") {
  await page.goto("/patients/new");
  await page.getByRole("button", { name: "Register Without ABHA ID" }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Date of birth").fill(dob);
}

async function toDoctorAndSlot(page: Page, department = "General Medicine") {
  await page.getByRole("button", { name: "Continue to doctor & slot" }).click();
  await expect(step(page, 2)).toBeVisible();
  await page.getByLabel("Department").selectOption({ label: department });
  await page.getByLabel("Doctor").selectOption({ index: 1 });
  await freeSlots(page).first().waitFor();
}


/** From step 2 with the department and doctor already chosen, through payment to the patient's page. */
async function finishFromStepTwo(page: Page, payment: "Cash" | "UPI" | "Card" = "Cash") {
  const free = page.locator('button[data-state="free"]');
  await free.first().waitFor();
  await free.first().click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("radio", { name: payment }).check();
  await page.getByLabel(/^I confirm the above was explained/).check();
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.getByText("Patient registered successfully.").waitFor();
  await page.getByRole("link", { name: "Open patient" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

test.describe("Hospital Staff: patient registration", () => {
  test("the three steps gate each other, and the patient exists only after the final action", async ({ page }) => {
    const name = `Wizard Patient ${alphaId()}`;
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");

    // Step 1 first: nothing can be continued until the patient is identified.
    await expect(step(page, 1)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to doctor & slot" })).toBeDisabled();
    await expect(page.getByText("Find the patient or create a new record to continue.")).toBeVisible();

    await startNewPatient(page, name);
    await toDoctorAndSlot(page);

    // Step 2 gates on an actual slot.
    await expect(page.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
    await freeSlots(page).first().click();
    await expect(page.getByRole("button", { name: "Continue to payment" })).toBeEnabled();

    // Nothing has been written yet, two steps in.
    await page.goto(`/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("link", { name })).toHaveCount(0);

    // Walk it again and finish.
    const path = await registerPatient(page, { name, visitType: "IP admission", payment: "UPI" });
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.goto(`/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("link", { name })).toHaveCount(1);

    // The visit is on the patient's record with its doctor, department and payment.
    await page.goto(path);
    const visits = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Visits & appointments" }) });
    await expect(visits.getByText(/REG-\d{8}-/)).toBeVisible();
    await expect(visits).toContainText("IP admission");
    await expect(visits).toContainText("General Medicine");
    await expect(visits).toContainText("Dr Asha Rao");
  });

  test("registration cannot complete without the rights & responsibilities acknowledgement", async ({ page }) => {
    const name = `Consent Gate ${alphaId()}`;
    await signIn(page, "staff.a@demo.claimix.invalid");
    await startNewPatient(page, name);
    await toDoctorAndSlot(page);
    await freeSlots(page).first().click();
    await page.getByRole("button", { name: "Continue to payment" }).click();

    await expect(step(page, 3)).toBeVisible();
    await expect(page.getByText("Patient Rights & Responsibilities consent required.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Register patient" })).toBeDisabled();

    // Payment alone does not unlock it.
    await page.getByRole("radio", { name: "Cash" }).check();
    await expect(page.getByRole("button", { name: "Register patient" })).toBeDisabled();

    await page.getByLabel(/^I confirm the above was explained/).check();
    await expect(page.getByRole("button", { name: "Register patient" })).toBeEnabled();

    // And nothing was created while it was blocked.
    await page.goto(`/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  });

  test("the summary carries what was already entered, and the payment can be left to collect", async ({ page }) => {
    const name = `Summary Patient ${alphaId()}`;
    await signIn(page, "staff.a@demo.claimix.invalid");
    await startNewPatient(page, name, "1979-11-02");
    await page.getByLabel("Mobile number").fill("9876500011");
    await toDoctorAndSlot(page, "Cardiology");
    await freeSlots(page).first().click();
    const slotTime = (await freeSlots(page).first().innerText()).split("\n")[0]!.trim();
    await page.getByRole("button", { name: "Continue to payment" }).click();

    // Nothing is re-entered: the summary is built from steps 1 and 2.
    const main = page.locator("#main");
    await expect(main).toContainText(name);
    await expect(main).toContainText("9876500011");
    await expect(main).toContainText("Cardiology");
    await expect(main).toContainText("Dr Vivek Menon");
    await expect(main).toContainText(slotTime);
    await expect(main).toContainText("₹900");

    await page.getByLabel("Collect the payment later").check();
    await expect(page.getByRole("radio", { name: "Cash" })).toBeDisabled();
    await page.getByLabel(/^I confirm the above was explained/).check();
    await page.getByRole("button", { name: "Register patient" }).click();

    await expect(page.getByText("Patient registered successfully.")).toBeVisible();
    await expect(page.locator("#main")).toContainText("To collect");
    await page.getByRole("link", { name: "Open patient" }).click();
    await expect(page.locator("main section").filter({ has: page.getByRole("heading", { name: "Visits & appointments" }) })).toContainText("To collect");
  });

  test("an existing patient gets a new visit, not a second patient record", async ({ page }) => {
    const name = `Returning Visitor ${alphaId()}`;
    await signIn(page, "staff.a@demo.claimix.invalid");
    const path = await registerPatient(page, { name, phone: "9811100022" });

    // Find them by mobile number and register a second visit.
    await page.goto("/patients/new");
    await page.getByLabel("Patient name, number or mobile").fill("9811100022");
    await page.getByRole("button", { name: "Search patient" }).click();
    await expect(page.getByText("Existing patients found")).toBeVisible();
    await page.getByRole("button", { name: "Select patient" }).first().click();
    await expect(page.getByText("Registering an existing patient")).toBeVisible();
    await expect(page.getByText("No second patient record is created")).toBeVisible();

    await page.getByRole("button", { name: "Continue to doctor & slot" }).click();
    await page.getByLabel("Department").selectOption({ label: "General Medicine" });
    await page.getByLabel("Doctor").selectOption({ index: 1 });
    await freeSlots(page).first().waitFor();
    await freeSlots(page).first().click();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.getByRole("radio", { name: "Card" }).check();
    await page.getByLabel(/^I confirm the above was explained/).check();
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByText("Patient registered successfully.")).toBeVisible();

    // One patient, two visits.
    await page.goto(`/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("link", { name })).toHaveCount(1);
    await page.goto(path);
    const visits = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Visits & appointments" }) });
    await expect(visits.getByText(/REG-\d{8}-/)).toHaveCount(2);
  });

  test("a booked slot is shown as taken and cannot be selected again", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await startNewPatient(page, `Slot Holder ${alphaId()}`);
    await toDoctorAndSlot(page);
    const time = (await freeSlots(page).first().innerText()).split("\n")[0]!.trim();
    const date = await page.getByLabel("Booking date").inputValue();
    await freeSlots(page).first().click();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.getByRole("radio", { name: "Cash" }).check();
    await page.getByLabel(/^I confirm the above was explained/).check();
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByText("Patient registered successfully.")).toBeVisible();

    // That time now reads as booked for the next registration, and is not clickable.
    await startNewPatient(page, `Slot Seeker ${alphaId()}`);
    await toDoctorAndSlot(page);
    await page.getByLabel("Booking date").fill(date);
    const taken = page.locator('button[data-state="taken"]').filter({ hasText: time });
    await expect(taken).toHaveCount(1);
    await expect(taken).toBeDisabled();
  });

  test("the department list only offers departments with a doctor, and the doctor list follows it", async ({ page }) => {
    await signIn(page, "staff.b@demo.claimix.invalid");
    await startNewPatient(page, `Dept Limited ${alphaId()}`);
    await page.getByRole("button", { name: "Continue to doctor & slot" }).click();
    const departments = page.getByLabel("Department");
    const labels = await departments.locator("option").allInnerTexts();
    // Hospital B's fixture doctor is in general medicine only.
    expect(labels.filter((l) => l !== "Select department…")).toEqual(["General Medicine"]);
    await departments.selectOption({ label: "General Medicine" });
    await expect(page.getByLabel("Doctor")).toContainText("Dr Priya Nair");
    await expect(page.getByLabel("Doctor")).not.toContainText("Dr Asha Rao");
  });

  test("doctors and slots are administrator reference data, not staff's", async ({ page, browser }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/admin/doctors");
    await expect(page).toHaveURL(/\/forbidden/);
    await page.goto("/patients/new");
    await expect(page.getByRole("link", { name: "Doctors & slots" })).toHaveCount(0);

    const admin = await browser.newContext();
    const adminPage = await admin.newPage();
    await signIn(adminPage, "admin@demo.claimix.invalid");
    await adminPage.goto("/admin/doctors");
    await expect(adminPage.getByRole("heading", { name: "Doctors & slots", level: 1 })).toBeVisible();
    await expect(adminPage.getByRole("cell", { name: /Dr Asha Rao/ })).toBeVisible();
    await admin.close();
  });
});

test.describe("Hospital Staff: registration methods, fee, visit types and payment", () => {
  test("the entry screen offers Register New ABHA and Register Without ABHA ID", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");

    // The old single "Create new patient" button is gone.
    await expect(page.getByRole("button", { name: "Create new patient" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Register New ABHA" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Register Without ABHA ID" })).toBeVisible();

    // Without an ABHA: no ABHA fields, and registration still completes.
    await page.getByRole("button", { name: "Register Without ABHA ID" }).click();
    await expect(page.getByText("No ABHA is needed or created")).toBeVisible();
    await expect(page.getByLabel("ABHA number")).toHaveCount(0);

    // With an ABHA: the fields appear and are recorded, not created.
    await page.goto("/patients/new");
    await page.getByRole("button", { name: "Register New ABHA" }).click();
    await expect(page.getByText("no ABDM connection")).toBeVisible();
    await expect(page.getByLabel("ABHA number")).toBeVisible();
    await expect(page.getByLabel("ABHA address")).toBeVisible();
  });

  test("an ABHA is recorded on the patient; a bad one is refused", async ({ page }) => {
    const id = alphaId();
    const name = `Abha Patient ${id}`;
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");
    await page.getByRole("button", { name: "Register New ABHA" }).click();
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Date of birth").fill("1988-04-04");
    await page.getByLabel("ABHA number").fill("1234");
    await page.getByRole("button", { name: "Continue to doctor & slot" }).click();
    await expect(page.getByText("An ABHA number is 14 digits.")).toBeVisible();

    await page.getByLabel("ABHA number").fill("11-2233-4455-6677");
    await page.getByLabel("ABHA address").fill(`abha.${id}@abdm`);
    await page.getByRole("button", { name: "Continue to doctor & slot" }).click();
    await page.getByLabel("Department").selectOption({ label: "General Medicine" });
    await page.getByLabel("Doctor").selectOption({ index: 1 });
    const path = await finishFromStepTwo(page);
    await page.goto(path);
    await expect(page.locator("#main")).toContainText("11-2233-4455-6677");
    await expect(page.locator("#main")).toContainText(`abha.${id}@abdm`);
  });

  test("the consultation fee appears after the doctor is chosen, not beside their name", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");
    await page.getByRole("button", { name: "Register Without ABHA ID" }).click();
    await page.getByLabel("Full name").fill(`Fee Check ${alphaId()}`);
    await page.getByLabel("Date of birth").fill("1990-06-06");
    await page.getByRole("button", { name: "Continue to doctor & slot" }).click();

    await page.getByLabel("Department").selectOption({ label: "Cardiology" });
    // The doctor list carries names only — no amount beside them.
    await expect(page.getByLabel("Doctor")).toContainText("Dr Vivek Menon");
    const options = await page.getByLabel("Doctor").locator("option").allInnerTexts();
    expect(options.join(" ")).not.toContain("₹");
    await expect(page.getByText("Consultation fee")).toHaveCount(0);

    await page.getByLabel("Doctor").selectOption({ index: 1 });
    // ...and it is fetched and shown once the doctor is selected.
    await expect(page.getByText("Consultation fee")).toBeVisible();
    await expect(page.locator("#main")).toContainText("₹900");
    // Nowhere to type it: the fee comes from the doctor's configuration.
    await expect(page.getByRole("textbox", { name: /consultation fee/i })).toHaveCount(0);
  });

  test("visit type offers OPD, IP admission and pre-auth, each explained", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");
    const visit = page.getByLabel("Visit type");
    const labels = (await visit.locator("option").allInnerTexts()).map((t) => t.trim());
    expect(labels).toEqual(["OPD consultation", "IP admission", "Pre-auth"]);

    await visit.selectOption({ label: "IP admission" });
    await expect(page.getByText("Inpatient admission")).toBeVisible();
    await expect(page.getByText(/the stay runs until a discharge is recorded/)).toBeVisible();

    await visit.selectOption({ label: "Pre-auth" });
    await expect(page.getByText("Pre-auth: approval requested before admission")).toBeVisible();
    // Honest about what this role can and cannot do with it.
    await expect(page.getByText(/insurance user has to raise the pre-authorization/)).toBeVisible();
  });

  test("an IP admission records the stay and can be discharged", async ({ page }) => {
    const id = alphaId();
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");
    await page.getByRole("button", { name: "Register Without ABHA ID" }).click();
    await page.getByLabel("Full name").fill(`Inpatient ${id}`);
    await page.getByLabel("Date of birth").fill("1972-02-02");
    await page.getByLabel("Visit type").selectOption({ label: "IP admission" });
    await page.getByRole("button", { name: "Continue to doctor & slot" }).click();
    await page.getByLabel("Department").selectOption({ label: "General Medicine" });
    await page.getByLabel("Doctor").selectOption({ index: 1 });

    // Admission details belong to a stay, not to an ordinary appointment.
    await page.getByLabel("Ward").fill("Ward C");
    await page.getByLabel("Bed").fill("7");
    await page.getByLabel("Expected stay (days)").fill("3");
    const path = await finishFromStepTwo(page);

    await page.goto(path);
    const visits = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Visits & appointments" }) });
    await expect(visits).toContainText("IP admission");
    await expect(visits).toContainText("In hospital");
    await expect(visits).toContainText("Ward C");

    // The patient shows on the dashboard's inpatient list, until discharged.
    await page.goto("/appointments?view=admitted");
    const row = page.getByRole("row", { name: new RegExp(`Inpatient ${id}`) });
    await expect(row).toContainText("Ward C");
    await row.getByRole("button", { name: "Record discharge" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record discharge" }).click();
    await expect(page.getByRole("row", { name: new RegExp(`Inpatient ${id}`) })).toHaveCount(0);

    await page.goto(path);
    await expect(visits).toContainText("Discharged");
  });

  test("payment offers cash, UPI with a QR area, and a card form", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto("/patients/new");
    await page.getByRole("button", { name: "Register Without ABHA ID" }).click();
    await page.getByLabel("Full name").fill(`Payer Choice ${alphaId()}`);
    await page.getByLabel("Date of birth").fill("1991-01-01");
    await page.getByRole("button", { name: "Continue to doctor & slot" }).click();
    await page.getByLabel("Department").selectOption({ label: "General Medicine" });
    await page.getByLabel("Doctor").selectOption({ index: 1 });
    const free = page.locator('button[data-state="free"]');
    await free.first().waitFor();
    await free.first().click();
    await page.getByRole("button", { name: "Continue to payment" }).click();

    const main = page.locator("#main");
    await expect(main).toContainText("Amount to collect");
    for (const m of ["Cash", "UPI", "Card"]) await expect(page.getByRole("radio", { name: m })).toBeVisible();

    await page.getByRole("radio", { name: "Cash" }).check();
    await expect(page.getByText(/Take .* in cash/)).toBeVisible();

    await page.getByRole("radio", { name: "UPI" }).check();
    await expect(page.getByText("Ask the patient to scan this with any UPI app")).toBeVisible();
    await expect(main).toContainText("upi://pay?");
    // Honest about settling nothing.
    await expect(page.getByText("Demo UPI collection")).toBeVisible();
    await page.getByLabel("UPI reference").fill("UPI-REF-9001");

    await page.getByRole("radio", { name: "Card" }).check();
    await expect(page.getByText("Demo card capture")).toBeVisible();
    await page.getByLabel("Card number").fill("4111 1111 1111 4242");
    // Only the masked reference is kept.
    await expect(page.getByLabel("Kept with the visit")).toHaveValue("****4242");

    await page.getByLabel(/^I confirm the above was explained/).check();
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByText("Patient registered successfully.")).toBeVisible();
    await expect(page.locator("#main")).toContainText("Collected");
  });
});

test.describe("Front-desk dashboard", () => {
  test("every figure in Today at the front desk opens the list it counts", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await registerPatient(page, { name: `Dash Link ${alphaId()}`, payment: "later" });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Today at the front desk" })).toBeVisible();

    await page.getByRole("link", { name: /Day sheet: registered today/i }).click();
    await expect(page).toHaveURL(/\/appointments\?date=\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("heading", { name: "Appointments", level: 1 })).toBeVisible();

    await page.goto("/dashboard");
    await page.getByRole("link", { name: /collect: payments to collect/i }).click();
    await expect(page).toHaveURL(/payment=pending/);

    await page.goto("/dashboard");
    await page.getByRole("link", { name: /view: collected today/i }).click();
    await expect(page).toHaveURL(/payment=paid/);

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Open day sheet" }).click();
    await expect(page).toHaveURL(/\/appointments\?date=/);
  });

  test("Today's appointments rows line up and nothing overflows", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    // A very long name must not push the layout wider than the page.
    await registerPatient(page, { name: `Averylongpatientnamethatkeepsgoing Andkeepsgoingfurther ${alphaId()}` });
    await page.goto("/dashboard");
    const card = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Today's appointments" }) });
    await expect(card).toBeVisible();

    for (const size of [{ width: 1440, height: 900 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `overflow at ${size.width}px`).toBeLessThanOrEqual(0);
      // Rows keep their columns aligned: every row starts at the same x as the first.
      const xs = await card.locator("li > span:first-child").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      expect(new Set(xs).size, `row starts at ${size.width}px`).toBe(1);
    }
  });
});
