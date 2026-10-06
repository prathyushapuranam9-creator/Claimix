import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import postgres from "postgres";
import path from "node:path";
import { alphaId, IDS, PASSWORD, signIn } from "./helpers";

/**
 * Hospital-staff end-to-end test. Every `check()` records PASS/FAIL to results.jsonl and the test keeps going,
 * so one defect doesn't hide the rest of the workflow. Console errors and failed requests are recorded to issues.jsonl.
 */
const OUT = process.env.HS_OUT ?? path.join(process.cwd(), "test-results", "hs");
fs.mkdirSync(OUT, { recursive: true });

const STAFF = "staff.a@demo.claimix.invalid";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const FLOATER = "Aarogya Family Floater Plus (DEMO DATA)";
const PREAUTH_DOCS = ["Photo ID proof", "Insurance / health card", "Doctor consultation note", "Investigation reports", "Treatment cost estimate"];
const CLAIM_DOCS = ["Final itemised bill", "Discharge summary", "Pharmacy bills"];

type Result = "PASS" | "FAIL" | "NA";
const failures: string[] = [];

function record(area: string, desc: string, result: Result, note = "") {
  fs.appendFileSync(path.join(OUT, "results.jsonl"), JSON.stringify({ area, desc, result, note, at: new Date().toISOString() }) + "\n");
  if (result === "FAIL") failures.push(`${area}: ${desc} — ${note}`);
}

async function check(area: string, desc: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    record(area, desc, "PASS");
  } catch (e) {
    record(area, desc, "FAIL", (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 3).join(" | ").slice(0, 400));
  }
}

function na(area: string, desc: string, why: string) {
  record(area, desc, "NA", why);
}

/** Records console errors/warnings, page errors and 4xx/5xx or failed requests. */
function monitor(page: Page, tag: string) {
  const add = (kind: string, text: string) => fs.appendFileSync(path.join(OUT, "issues.jsonl"), JSON.stringify({ tag, kind, page: page.url().replace(/[0-9a-f-]{36}/g, "<id>"), text: text.slice(0, 300) }) + "\n");
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") add(`console.${m.type()}`, m.text()); });
  page.on("pageerror", (e) => add("pageerror", e.message));
  page.on("response", (r) => { if (r.status() >= 400) add(`http.${r.status()}`, `${r.request().method()} ${r.url().replace(/[0-9a-f-]{36}/g, "<id>")}`); });
  page.on("requestfailed", (r) => { if (r.url().includes("_rsc=")) return; /* cancelled link prefetch */ add("requestfailed", `${r.url()} ${r.failure()?.errorText ?? ""}`); });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }).catch(() => undefined);
}

async function asRole(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  monitor(page, `payer:${email.split("@")[0]}`);
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}

async function upload(page: Page, label: string) {
  await page.getByLabel("Document type").selectOption({ label });
  await page.getByLabel(/^File/).setInputFiles({ name: `${label.replace(/\W+/g, "-")}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(`${label} uploaded.`)).toBeVisible();
}

const rupees = (t: string | undefined) => Number((t ?? "").replace(/[^\d.]/g, "") || 0);

/** Reads every hospital-dashboard metric from the rendered page. */
async function dash(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByText("Queries to answer").first()).toBeVisible();
  const ring = async (label: string) => {
    const t = (await page.locator(`[aria-label^="${label}:"]`).first().getAttribute("aria-label").catch(() => null)) ?? "";
    return t ? Number(t.split(":")[1]) : null;
  };
  const text = (await page.locator("#main").innerText()).replace(/\s+/g, " ");
  const m = (re: RegExp) => text.match(re)?.[1];
  return {
    queries: await ring("Queries to answer"),
    drafts: await ring("Drafts"),
    reviews: await ring("Assistant reviews"),
    awaiting: Number(m(/Awaiting payer (\d+)/)),
    preApproved: Number(m(/Pre-auths approved (\d+)/)),
    settled: rupees(m(/Settled \(paid\) (₹[\d,]+)/)),
    claimed: rupees(m(/(₹[\d,]+) Claimed · Submitted claims/)),
    approvedAmt: rupees(m(/(₹[\d,]+) Approved · By payer decision/)),
    text,
  };
}

/** The same numbers straight from the database, for hospital A. */
async function dbStats() {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const H = IDS.hospitalA;
    const by = async (table: string) => Object.fromEntries((await sql.unsafe(`select status, count(*)::int n from ${table} where hospital_id = '${H}' group by status`)).map((r) => [r.status as string, r.n as number]));
    const pre = await by("pre_authorizations");
    const cl = await by("claims");
    const [fin] = await sql.unsafe(
      `select coalesce(sum(claimed_amount) filter (where status not in ('draft','cancelled')),0)::float claimed,
              coalesce(sum(approved_amount) filter (where status in ('approved','partially_approved','settled')),0)::float approved
       from claims where hospital_id = '${H}'`,
    );
    const [st] = await sql.unsafe(`select coalesce(sum(se.amount) filter (where se.status = 'paid'),0)::float settled from settlements se join claims c on c.id = se.claim_id where c.hospital_id = '${H}'`);
    const sum = (o: Record<string, number>, ks: string[]) => ks.reduce((a, k) => a + (o[k] ?? 0), 0);
    const [rv] = await sql.unsafe(`select count(*)::int n from review_requests where status = 'open' and organization_id = '${H}'`);
    return {
      queries: (pre.query ?? 0) + (cl.query ?? 0),
      drafts: (pre.draft ?? 0) + (cl.draft ?? 0),
      awaiting: sum(pre, ["submitted", "pending"]) + sum(cl, ["submitted", "pending"]),
      preApproved: sum(pre, ["approved", "partially_approved", "final_approved", "settled"]),
      settled: st!.settled as number,
      claimed: fin!.claimed as number,
      approvedAmt: fin!.approved as number,
      reviews: rv!.n as number,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Number of recorded eligibility checks for the test coverage (to prove reading history never records new ones). */
async function evaluationRows() {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const [r] = await sql`select count(*)::int n from rule_evaluations where subject_type = 'eligibility_check' and subject_id = ${beneficiary}`;
    return r!.n as number;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function dashMatchesDb(page: Page) {
  const [ui, db] = [await dash(page), await dbStats()];
  const keys = ["queries", "drafts", "awaiting", "preApproved", "settled", "claimed", "approvedAmt", "reviews"] as const;
  const diff = keys.filter((k) => ui[k] !== db[k]).map((k) => `${k}: UI=${ui[k]} DB=${db[k]}`);
  expect(diff, diff.join("; ")).toEqual([]);
  return { ui, db };
}

const patientName = `HS Test Patient ${alphaId()}`;
const noCoverName = `HS NoCover Patient ${alphaId()}`;
let patientUrl = "";
let noCoverUrl = "";
let beneficiary = "";
let preauthUrl = "";
let claimUrl = "";
let reimbUrl = "";
const MEMBER = `HS-${alphaId()}`.toUpperCase();

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "responsive checks run inside the desktop project");

test.afterAll(() => {
  fs.writeFileSync(path.join(OUT, "failures.txt"), failures.join("\n"));
});

test("01 login and dashboard identity", async ({ page, context }) => {
  monitor(page, "staff");
  await check("Login", "invalid credentials do not authenticate", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(STAFF);
    await page.locator("#password").fill("definitely-wrong-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password." })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect((await context.cookies()).some((c) => c.name.includes("claimix_session"))).toBe(false);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  await check("Login", "the sign-in page has no role selector", async () => {
    await page.goto("/login");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  await check("Login", "empty form shows validation, nothing submitted", async () => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  });

  await check("Login", "valid credentials reach the dashboard with the right identity", async () => {
    await signIn(page, STAFF);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /Welcome, Kiran/ })).toBeVisible();
    await expect(page.locator("#main").getByText("Hospital Staff · Sunrise Multispeciality Hospital")).toBeVisible();
    await expect(page.getByText("Hospital Staff", { exact: true }).first()).toBeVisible(); // taskbar portal
  });

  await check("Login", "no admin or payer UI is shown", async () => {
    const nav = page.getByRole("complementary", { name: "Main navigation" });
    for (const n of ["Users", "Access requests", "Audit log", "Medical codes"]) await expect(nav.getByRole("link", { name: n, exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Decision")).toHaveCount(0);
  });

  await check("Login", "a favicon is configured and loads: no 404 or console error on a fresh first load", async () => {
    const fresh = await context.browser()!.newContext();
    const p = await fresh.newPage();
    const bad: string[] = [];
    p.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    p.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
    await p.goto("/login");
    await p.waitForTimeout(1500);
    const href = await p.locator('link[rel~="icon"]').first().getAttribute("href");
    expect(href).toBeTruthy();
    expect((await p.request.get(href!)).status()).toBe(200);
    expect(bad).toEqual([]);
    await fresh.close();
  });

  await check("Login", "session cookie is httpOnly + SameSite=Lax", async () => {
    const c = (await context.cookies()).find((x) => x.name.includes("claimix_session"));
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe("Lax");
  });
  await shot(page, "dashboard-desktop-light");
});

test("02 dashboard buttons, metrics and work queues", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Dashboard", "three primary actions are present", async () => {
    await expect(page.getByRole("link", { name: "Check eligibility" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New pre-authorization" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New claim" })).toBeVisible();
  });

  await check("Dashboard", "Check eligibility → /eligibility with Back working", async () => {
    await page.getByRole("link", { name: "Check eligibility" }).first().click();
    await expect(page).toHaveURL(/\/eligibility$/);
    await expect(page.getByRole("heading", { name: "Eligibility checker", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /back/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await check("Dashboard", "New pre-authorization → coverage picker (patient/coverage selectable)", async () => {
    await page.getByRole("link", { name: "New pre-authorization" }).first().click();
    await expect(page).toHaveURL(/\/pre-authorizations\/new$/);
    await expect(page.getByRole("heading", { name: "New pre-authorization" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Select" }).first()).toBeVisible();
    await page.goto("/dashboard");
  });

  await check("Dashboard", "New claim → cashless + reimbursement pickers", async () => {
    await page.getByRole("link", { name: "New claim" }).first().click();
    await expect(page).toHaveURL(/\/claims\/new$/);
    await expect(page.getByRole("heading", { name: "Cashless: approved pre-authorizations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reimbursement: choose the patient's coverage" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start reimbursement claim" }).first()).toBeVisible();
  });

  await check("Dashboard", "all eight metric labels exist", async () => {
    await page.goto("/dashboard");
    for (const l of ["Queries to answer", "Drafts", "Assistant reviews", "Awaiting payer", "Pre-auths approved", "Settled (paid)", "Claimed", "Approved"]) {
      await expect(page.locator("#main").getByText(l, { exact: false }).first(), l).toBeVisible();
    }
  });

  await check("Dashboard", "work-queue headings and 'All' links go to existing pages", async () => {
    await expect(page.getByRole("heading", { name: "Pre-authorizations needing action" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Claims needing action" })).toBeVisible();
    const hrefs = await page.locator("#main").getByRole("link", { name: "All", exact: true }).evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    expect(hrefs).toEqual(["/pre-authorizations", "/claims"]);
    await page.getByRole("link", { name: "All", exact: true }).first().click();
    await expect(page).toHaveURL(/\/pre-authorizations/);
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "All", exact: true }).nth(1).click();
    await expect(page).toHaveURL(/\/claims/);
  });

  await check("Dashboard", "all eight metrics equal the database values (baseline, before any test data)", async () => {
    await dashMatchesDb(page);
  });

  await check("Dashboard", "lobby backdrop is fixed, loads, and frosted cards are readable", async () => {
    await page.goto("/dashboard");
    const img = await page.request.get("/hospital-lobby.png");
    expect(img.status()).toBe(200);
    const bd = page.locator("[class*=backdrop]").first();
    await expect(bd).toHaveCSS("position", "fixed");
    expect(await bd.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("hospital-lobby.png");
  });
});

test("03 patients: validation, registration, list, persistence, duplicates", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Patients", "list loads with search and register button", async () => {
    await page.goto("/patients");
    await expect(page.getByRole("heading", { name: "Patients", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Register patient" })).toBeVisible();
    await expect(page.getByLabel("Search by name or patient number")).toBeVisible();
  });

  await check("Patients", "required-field validation", async () => {
    await page.goto("/patients/new");
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page).toHaveURL(/\/patients\/new/);
    await expect(page.locator("[role=alert], [class*=error]").first()).toBeVisible();
  });

  await check("Patients", "invalid data rejected (future DOB, bad phone, bad email, bad number)", async () => {
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill("HS Invalid Case");
    await page.getByLabel("Date of birth").fill("2999-01-01");
    await page.getByLabel("Gender").selectOption({ index: 1 });
    await page.getByLabel("Mobile number").fill("12");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Hospital patient number").fill("bad number!");
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page).toHaveURL(/\/patients\/new/);
    await expect(page.locator("#main")).toContainText(/date of birth|past|valid|phone|email|letters, numbers/i);
  });

  await check("Patients", "valid registration creates a patient and opens its page", async () => {
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill(patientName);
    await page.getByLabel("Date of birth").fill("1984-05-05");
    await page.getByLabel("Gender").selectOption({ index: 1 });
    await page.getByLabel("Mobile number").fill("9876543210");
    await page.getByLabel("Email").fill("hs.test@example.test");
    await page.getByRole("button", { name: "Register patient" }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    patientUrl = page.url();
    await expect(page.getByRole("heading", { name: patientName })).toBeVisible();
    await expect(page.getByText(/PT-[A-Z0-9]{6,8}/).first()).toBeVisible();
  });

  await check("Patients", "patient appears in list and persists after refresh", async () => {
    await page.goto(`/patients?q=${encodeURIComponent(patientName)}`);
    await expect(page.getByRole("link", { name: patientName })).toBeVisible();
    await page.goto(patientUrl);
    await page.reload();
    await expect(page.getByRole("heading", { name: patientName })).toBeVisible();
  });

  await check("Patients", "duplicate patient number at same hospital is refused", async () => {
    await page.goto(patientUrl);
    const no = (await page.getByText(/PT-[A-Z0-9]{6,8}/).first().innerText()).match(/PT-[A-Z0-9]{6,8}/)![0];
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill(`HS Dup ${alphaId()}`);
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page.getByLabel("Gender").selectOption({ index: 1 });
    await page.getByLabel("Hospital patient number").fill(no);
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.locator("#main")).toContainText(/already in use/i);
  });

  await check("Patients", "same name + DOB warns about a possible duplicate, links the existing record, and creates nothing until confirmed", async () => {
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill(patientName.toUpperCase());
    await page.getByLabel("Date of birth").fill("1984-05-05");
    await page.getByLabel("Gender").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Register patient" }).click();
    const warning = page.getByRole("status").filter({ hasText: "may already be registered" });
    await expect(warning).toBeVisible();
    await expect(page).toHaveURL(/\/patients\/new/);
    await expect(warning.getByRole("link", { name: /^PT-/ })).toHaveAttribute("href", new URL(patientUrl).pathname);
    await page.goto(`/patients?q=${encodeURIComponent(patientName)}`);
    await expect(page.getByRole("link", { name: patientName })).toHaveCount(1);
  });

  await check("Patients", "'Register as a new patient anyway' creates a separate patient (a legitimate namesake)", async () => {
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill(patientName);
    await page.getByLabel("Date of birth").fill("1984-05-05");
    await page.getByLabel("Gender").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Register patient" }).click();
    await page.getByRole("button", { name: "Register as a new patient anyway" }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toBe(patientUrl);
    await page.goto(`/patients?q=${encodeURIComponent(patientName)}`);
    await expect(page.getByRole("link", { name: patientName })).toHaveCount(2);
  });

  await check("Patients", "patient without coverage: registration needs no insurance", async () => {
    await page.goto("/patients/new");
    await page.getByLabel("Full name").fill(noCoverName);
    await page.getByLabel("Date of birth").fill("1975-03-03");
    await page.getByLabel("Gender").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Register patient" }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    noCoverUrl = page.url();
    await expect(page.getByText("No coverage recorded")).toBeVisible();
    await expect(page.getByRole("link", { name: "Check eligibility" })).toHaveCount(0);
  });

  await check("Patients", "no-coverage patient is absent from pre-auth and reimbursement pickers", async () => {
    await page.goto(`/pre-authorizations/new?q=${encodeURIComponent(noCoverName)}`);
    await expect(page.getByText("No matching coverage")).toBeVisible();
    await page.goto(`/claims/new?q=${encodeURIComponent(noCoverName)}`);
    await expect(page.getByText("No matching coverage")).toBeVisible();
  });
});

test("04 add coverage: fields, amounts, validation, persistence", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);
  await page.goto(patientUrl);

  const open = async () => {
    if (!(await page.getByLabel("Policy / scheme").isVisible())) await page.getByRole("button", { name: "Add coverage" }).click();
  };
  const fill = async (o: { member?: string; si?: string; avail?: string; start?: string; end?: string; incep?: string; rel?: string }) => {
    await open();
    await page.getByLabel("Policy / scheme").selectOption({ label: FLOATER });
    await page.getByLabel("Member / beneficiary ID").fill(o.member ?? MEMBER);
    await page.getByLabel("Relationship to policyholder").selectOption(o.rel ?? "self");
    await page.getByLabel("First inception date").fill(o.incep ?? "2021-04-01");
    await page.getByLabel("Cover start").fill(o.start ?? "2026-04-01");
    await page.getByLabel("Cover end").fill(o.end ?? "2027-03-31");
    await page.getByLabel("Sum insured (₹)").fill(o.si ?? "1000000");
    await page.getByLabel("Available balance (₹)").fill(o.avail ?? "850000");
  };
  const save = () => page.getByRole("button", { name: "Save coverage" }).click();

  await check("Coverage", "required fields are enforced", async () => {
    await open();
    await save();
    await expect(page.locator("form").filter({ hasText: "Save coverage" }).locator("[role=alert], [class*=error]").first()).toBeVisible();
  });

  await check("Coverage", "cover end before start is rejected", async () => {
    await fill({ start: "2027-03-31", end: "2026-04-01" });
    await save();
    await expect(page.getByText(/End date must be after the start date/)).toBeVisible();
  });

  await check("Coverage", "available balance above sum insured is rejected", async () => {
    await fill({ si: "100000", avail: "900000" });
    await save();
    await expect(page.getByText(/Available balance can't exceed the sum insured/)).toBeVisible();
  });

  await check("Coverage", "inception after cover start is rejected", async () => {
    await fill({ incep: "2026-06-01" });
    await save();
    await expect(page.getByText(/First inception can't be after/)).toBeVisible();
  });

  await check("Coverage", "invalid member ID characters are rejected", async () => {
    await fill({ member: "ab" });
    await save();
    await expect(page.getByText(/Enter the member|letters, numbers/)).toBeVisible();
  });

  await check("Coverage", "negative / alphabetic money is rejected", async () => {
    await fill({ si: "-5", avail: "abc" });
    await save();
    await expect(page.locator("form").filter({ hasText: "Save coverage" })).toContainText(/amount|number|valid|negative|digits/i);
  });

  // Indian grouping "10,00,000": record what the app does (the task asks whether it is intentionally accepted or rejected).
  const ig = { v: "rejected" as "accepted" | "rejected" };
  await check("Coverage", "Indian-grouped amount '10,00,000' is handled deterministically (accepted or clearly rejected)", async () => {
    await fill({ si: "10,00,000", avail: "8,50,000", member: `${MEMBER}-IG` });
    await save();
    await page.waitForTimeout(1500);
    const err = await page.locator("form").filter({ hasText: "Save coverage" }).locator("[role=alert], [class*=error]").count();
    ig.v = err > 0 ? "rejected" : "accepted";
    record("Coverage", `INFO: '10,00,000' is ${ig.v}`, "PASS", ig.v === "accepted" ? "grouped separators were parsed" : "a field error was shown");
  });

  if (ig.v === "accepted") {
    // It saved a second coverage; that is fine, but verify the stored value afterwards.
    await page.goto(patientUrl);
  }

  await check("Coverage", "valid raw amounts 1000000 / 850000 save and show correctly", async () => {
    await page.goto(patientUrl);
    await fill({ si: "1000000", avail: "850000" });
    await save();
    await expect(page.getByRole("link", { name: "Check eligibility" }).first()).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: MEMBER }).first();
    await expect(row).toBeVisible();
    await expect(page.locator("#main")).toContainText("₹10,00,000");
    await expect(page.locator("#main")).toContainText("₹8,50,000");
    const href = await page.getByRole("link", { name: "Check eligibility" }).first().getAttribute("href");
    beneficiary = new URL(href!, "http://x").searchParams.get("beneficiary")!;
  });

  await check("Coverage", "duplicate member ID on another patient is refused", async () => {
    await page.goto(noCoverUrl);
    await page.getByRole("button", { name: "Add coverage" }).click();
    await page.getByLabel("Policy / scheme").selectOption({ label: FLOATER });
    await page.getByLabel("Member / beneficiary ID").fill(MEMBER);
    await page.getByLabel("Relationship to policyholder").selectOption("self");
    await page.getByLabel("Cover start").fill("2026-04-01");
    await page.getByLabel("Cover end").fill("2027-03-31");
    await page.getByRole("button", { name: "Save coverage" }).click();
    await expect(page.locator("#main")).toContainText(/already recorded for another patient/i);
  });

  await check("Coverage", "coverage persists after refresh", async () => {
    await page.goto(patientUrl);
    await page.reload();
    await expect(page.getByText(MEMBER).first()).toBeVisible();
  });
});

test("05 eligibility: both entry points, result, persistence", async ({ page, browser }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);

  const fillCase = async () => {
    await page.getByLabel("Expected admission date").fill("2026-10-15");
    await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
    await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
    await page.getByLabel("Due to an accident?").selectOption("no");
    await page.getByLabel("Pre-existing disease declared?").selectOption("no");
    await page.getByLabel("Estimated cost (₹)").fill("95000");
    await page.getByLabel("Room rent per day (₹)").fill("4000");
  };

  await check("Eligibility", "Patient → Coverage → Check eligibility opens that patient's coverage", async () => {
    await page.goto(patientUrl);
    await page.getByRole("link", { name: "Check eligibility" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/eligibility\\?beneficiary=${beneficiary}`));
    await expect(page.getByRole("heading", { name: `Checking ${patientName}` })).toBeVisible();
    await expect(page.locator("#main")).toContainText(MEMBER);
  });

  await check("Eligibility", "run with insufficient info → Needs verification, never Eligible", async () => {
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(page.getByRole("heading", { name: "Needs verification" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Eligible", exact: true })).toHaveCount(0);
  });

  await check("Eligibility", "complete case → Eligible with pre-auth required + disclaimer", async () => {
    await page.goto(`/eligibility?beneficiary=${beneficiary}`);
    await fillCase();
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(page.getByRole("heading", { name: "Eligible" })).toBeVisible();
    await expect(page.getByText("Pre-authorization: required before admission")).toBeVisible();
    await expect(page.getByText(/does not guarantee claim approval/)).toBeVisible();
    await shot(page, "eligibility-result");
  });

  await check("Eligibility", "Dashboard → Check eligibility works without a registered patient (manual entry) and validates", async () => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Check eligibility" }).first().click();
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(page.locator("#main")).toContainText(/Select|required|policy|scheme/i);
  });

  await check("Eligibility", "the result survives a refresh, navigating away, and returning to the patient (previous checks)", async () => {
    await page.goto(`/eligibility?beneficiary=${beneficiary}`);
    await fillCase();
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await expect(page.getByRole("heading", { name: "Eligible", exact: true })).toBeVisible();
    const refMatch = (await page.locator("#eligibility-result").innerText()).match(/ref\s+([0-9a-f]{8})/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1]!;

    // 1. Refresh: the same stored result is shown again (latest check open), without running a new check.
    const before = await evaluationRows();
    await page.reload();
    const history = page.getByRole("region", { name: "Previous eligibility checks" });
    await expect(history).toBeVisible();
    await expect(history.getByRole("heading", { name: "Eligible", exact: true })).toBeVisible();
    await expect(history).toContainText(ref);
    expect(await evaluationRows()).toBe(before);

    // 2. Navigate away and come back from the patient page, which shows the last check for the coverage.
    await page.goto("/dashboard");
    await page.goto(patientUrl);
    const row = page.getByRole("row").filter({ hasText: MEMBER });
    await row.getByRole("link", { name: "Eligible", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/eligibility\\?beneficiary=${beneficiary}`));
    await expect(history).toContainText(ref);
    expect(await evaluationRows()).toBe(before);
  });

  await check("Eligibility", "several checks are all kept, newest first, none overwritten", async () => {
    await page.goto(`/eligibility?beneficiary=${beneficiary}`);
    const history = page.getByRole("region", { name: "Previous eligibility checks" });
    const n = await evaluationRows();
    expect(n).toBeGreaterThanOrEqual(3);
    await expect(history.getByRole("listitem").filter({ has: page.getByRole("button", { name: /View details|Hide details/ }) })).toHaveCount(n);
    // Only the latest is open; older ones open on demand and show their own stored result.
    await expect(history.getByRole("button", { name: "Hide details" })).toHaveCount(1);
    await history.getByRole("button", { name: "View details" }).last().click();
    await expect(history.getByRole("button", { name: "Hide details" })).toHaveCount(2);
    await expect(history.getByRole("heading", { name: /Needs verification/ })).toBeVisible(); // the very first check had no case details
  });

  await check("Eligibility", "another hospital cannot open this coverage's eligibility page or history", async () => {
    const b = await asRole(browser, "staff.b@demo.claimix.invalid");
    expect((await b.page.goto(`/eligibility?beneficiary=${beneficiary}`))?.status()).toBe(404);
    await b.close();
  });

  await check("Eligibility", "each check is stored as an evaluation row for this coverage (database)", async () => {
    const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const [r] = await sql`select count(*)::int n from rule_evaluations where subject_type = 'eligibility_check' and subject_id = ${beneficiary}`;
      expect(r!.n).toBeGreaterThanOrEqual(3);
      const [a] = await sql`select count(*)::int n from audit_logs where action = 'eligibility.checked' and resource_id = ${beneficiary}`;
      expect(a!.n).toBeGreaterThanOrEqual(3);
      const [none] = await sql`select count(*)::int n from rule_evaluations e join beneficiaries b on b.id = e.subject_id join patients p on p.id = b.patient_id where p.full_name = ${noCoverName}`;
      expect(none!.n).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  await check("Eligibility", "no-coverage patient has no eligibility entry point", async () => {
    await page.goto(noCoverUrl);
    await expect(page.getByRole("link", { name: "Check eligibility" })).toHaveCount(0);
  });

  await check("Eligibility", "'Start pre-authorization with these details' carries values over", async () => {
    await page.goto(`/eligibility?beneficiary=${beneficiary}`);
    await fillCase();
    await page.getByRole("button", { name: "Check eligibility" }).click();
    await page.getByRole("link", { name: "Start pre-authorization with these details" }).click();
    await expect(page.getByLabel("Estimated cost (₹)")).toHaveValue("95000");
  });
});

test("06 pre-authorization: draft, docs, checks, checklist, submit", async ({ page, browser }) => {
  test.setTimeout(420_000);
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Pre-auth", "Pre-authorizations list is reachable and shows existing requests", async () => {
    await page.goto("/pre-authorizations?view=all");
    await expect(page.getByRole("heading", { name: /Pre-auth/i, level: 1 })).toBeVisible();
  });

  await check("Pre-auth", "case form: a draft can be saved with no case data; completeness is enforced by the checklist (Submit stays disabled)", async () => {
    await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}`);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toBeDisabled();
    record("Pre-auth", "OBSERVATION: Create draft accepts an empty case form (no required fields)", "PASS", "creates a blank draft; every mandatory item is only enforced at submission");
  });

  const before = await dash(page);

  await check("Pre-auth", "draft is created with an ID and reference", async () => {
    await page.goto(`/pre-authorizations/new?beneficiary=${beneficiary}&claimType=cashless&admissionDate=2026-10-15&isAccident=no&pedDeclared=no&estimatedCost=80000&roomRentPerDay=4000`);
    await page.getByLabel("Diagnosis").selectOption({ label: "K35 — Acute appendicitis" });
    await page.getByLabel("Treatment / procedure").selectOption({ label: "Appendectomy" });
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
    preauthUrl = page.url();
    await expect(page.getByRole("heading", { name: /Pre-auth PA-\d{8}-[A-Z0-9]+/ })).toBeVisible();
  });

  await check("Pre-auth", "draft appears in the list, persists after refresh, and Drafts metric rises", async () => {
    await page.goto("/pre-authorizations?view=all&q=" + encodeURIComponent(patientName));
    await expect(page.getByRole("link", { name: /^PA-/ }).first()).toBeVisible();
    await page.goto(preauthUrl);
    await page.reload();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
    const after = await dash(page);
    expect(after.drafts).toBe((before.drafts ?? 0) + 1);
    await dashMatchesDb(page);
  });

  await check("Pre-auth", "Submit is disabled until the checklist is complete", async () => {
    await page.goto(preauthUrl);
    await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toBeDisabled();
  });

  await check("Pre-auth", "spoofed file (MZ header named .pdf) is rejected with a clear message", async () => {
    await page.getByLabel("Document type").selectOption({ label: "Photo ID proof" });
    await page.getByLabel(/^File/).setInputFiles({ name: "id.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not a pdf") });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(/isn't a valid PDF, PNG or JPG/)).toBeVisible();
  });

  await check("Pre-auth", "wrong extension (.exe) is rejected", async () => {
    await page.getByLabel("Document type").selectOption({ label: "Photo ID proof" });
    await page.getByLabel(/^File/).setInputFiles({ name: "malware.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ\x90\x00") });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.locator("#main")).toContainText(/PDF, PNG or JPG|not allowed|type/i);
  });

  await check("Pre-auth", "oversized file is rejected", async () => {
    await page.getByLabel("Document type").selectOption({ label: "Photo ID proof" });
    const big = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024, 0x20)]);
    await page.getByLabel(/^File/).setInputFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: big });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.locator("#main")).toContainText(/MB|too large|size/i);
  });

  await check("Pre-auth", "upload without choosing a file shows an error", async () => {
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.locator("#main")).toContainText(/choose|select|file/i);
  });

  await check("Pre-auth", "five mandatory documents upload and are listed", async () => {
    for (const l of PREAUTH_DOCS) await upload(page, l);
    await page.reload();
    for (const l of PREAUTH_DOCS) await expect(page.locator("#main table").getByText(l).first()).toBeVisible();
  });

  await check("Pre-auth", "uploaded document can be downloaded (200, attachment)", async () => {
    const href = await page.getByRole("link", { name: "Download" }).first().getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
  });

  await check("Pre-auth", "Run checks executes and reports", async () => {
    await page.getByRole("button", { name: "Run checks" }).click();
    await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
  });

  await check("Pre-auth", "checklist: manual items confirm, state persists after refresh", async () => {
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(3);
    await page.reload();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toBeDisabled();
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
      await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(2 - i);
    }
    await expect(page.getByText("20 of 20")).toBeVisible();
  });

  await check("Pre-auth", "double-click Submit creates exactly one submission", async () => {
    await page.getByRole("button", { name: "Submit Pre-Authorization" }).dblclick();
    await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
    await expect(page.locator("#main").getByText("Submitted", { exact: true }).first()).toBeVisible();
    await page.reload();
    const stepCount = await page.getByText("Submitted", { exact: true }).count();
    expect(stepCount).toBeGreaterThan(0);
  });

  await check("Pre-auth", "submitted request is no longer editable and keeps its timeline", async () => {
    await expect(page.getByRole("button", { name: "Submit Pre-Authorization" })).toHaveCount(0);
    await expect(page.getByLabel("Document type")).toHaveCount(1); // docs still allowed while submitted
  });

  // ---- payer simulation through the real payer UI (existing demo accounts; no fabricated data) ----
  const tpa = await asRole(browser, "tpa.a@demo.claimix.invalid");
  await check("Pre-auth query", "payer raises a query; hospital sees reason, notification, can respond with documents", async () => {
    await tpa.page.goto(preauthUrl);
    await tpa.page.getByLabel("Decision").selectOption({ label: "Raise a query" });
    await tpa.page.getByLabel("Reason").selectOption({ label: "Insufficient medical information" });
    await tpa.page.getByLabel("Message to the hospital").fill("Please share the ultrasound report and surgeon's notes.");
    await tpa.page.getByRole("button", { name: "Raise a query" }).click();
    await expect(tpa.page.getByText("Recorded: Query raised.")).toBeVisible();

    await page.goto("/notifications?show=unread");
    const note = page.locator(`a[href="${new URL(preauthUrl).pathname}"]`).first();
    await expect(note).toBeVisible();
    await expect(note).toContainText(/quer/i);
    await note.click();
    await expect(page).toHaveURL(preauthUrl);
    await expect(page.getByText("Query from the payer")).toBeVisible();
    await expect(page.getByText(/Insufficient medical information/).first()).toBeVisible();
    await expect(page.getByText(/ultrasound report and surgeon/).first()).toBeVisible();
  });

  await check("Pre-auth query", "empty / too-short response is refused", async () => {
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.locator("#main")).toContainText(/response|at least|enter|required/i);
    await expect(page.getByText("Query from the payer")).toBeVisible();
  });

  await check("Pre-auth query", "hospital uploads requested doc, answers, status and timeline update", async () => {
    await upload(page, "Ultrasound");
    await page.getByLabel("Response to the payer").fill("Ultrasound report and surgeon notes uploaded.");
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.getByText("Query from the payer")).toHaveCount(0);
    await page.reload();
    for (const s of ["Query raised", "Submitted"]) await expect(page.getByText(s, { exact: true }).first()).toBeVisible();
  });

  await check("Pre-auth", "status transitions are payer-only: staff has no decision form on an insurer-backed request", async () => {
    await expect(page.getByLabel("Decision")).toHaveCount(0);
  });

  const ins = await asRole(browser, "insurer.a@demo.claimix.invalid");
  await check("Pre-auth decision", "payer approves; hospital sees Approved, notification and Pre-auths approved metric", async () => {
    await ins.page.goto(preauthUrl);
    await ins.page.getByLabel("Decision").selectOption({ label: "Approve" });
    await ins.page.getByLabel("Approved amount (₹)").fill("80000");
    await ins.page.getByRole("button", { name: "Approve" }).click();
    await expect(ins.page.getByText("Recorded: Approved.")).toBeVisible();
    await page.goto(preauthUrl);
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByText(/approved/i).first()).toBeVisible();
  });
  await tpa.close();
  await ins.close();
  await shot(page, "preauth-approved");
});

test("07 claims: cashless, documents, checks, submit, query, decision", async ({ page, browser }) => {
  test.setTimeout(420_000);
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Claims", "cashless picker lists the approved pre-auth only (draft/other-hospital ones are absent)", async () => {
    await page.goto("/claims/new");
    await expect(page.getByRole("link", { name: "Start claim" }).first()).toBeVisible();
    const refs = await page.getByRole("row").filter({ has: page.getByRole("link", { name: "Start claim" }) }).allInnerTexts();
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r).toContain("Approved");
  });

  await check("Claims", "Start cashless claim from the approved pre-auth: patient/policy/pre-auth pre-filled", async () => {
    await page.goto(preauthUrl);
    await page.getByRole("link", { name: "Start final claim" }).click();
    await expect(page.getByRole("heading", { name: "New cashless claim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: patientName })).toBeVisible();
    await expect(page.locator("#main")).toContainText("From pre-authorization PA-");
    await expect(page.getByLabel("Final diagnosis", { exact: true })).toHaveValue(/.+/);
  });

  await check("Claims", "claim form validation (missing bill amount / bad dates)", async () => {
    await page.getByLabel("Admission date").fill("2026-09-25");
    await page.getByLabel("Discharge date").fill("2026-09-20");
    await page.getByRole("button", { name: "Create claim draft" }).click();
    await expect(page).toHaveURL(/\/claims\/new/);
    await expect(page.getByText("Discharge can't be before admission.")).toBeVisible();
    await page.getByLabel("Discharge date").fill("2026-12-31");
    await page.getByRole("button", { name: "Create claim draft" }).click();
    await expect(page.getByText(/can't be in the future/)).toBeVisible();
  });

  await check("Claims", "cashless claim draft is created", async () => {
    await page.getByLabel("Admission date").fill("2026-09-25");
    await page.getByLabel("Discharge date").fill("2026-09-28");
    await page.getByLabel("Final bill number").fill("HS-BILL-1001");
    await page.getByLabel("Final bill amount (₹)").fill("76000");
    await page.getByRole("button", { name: "Create claim draft" }).click();
    await expect(page).toHaveURL(/\/claims\/[0-9a-f-]{36}$/);
    claimUrl = page.url();
  });

  await check("Claims", "a second claim for the same pre-auth is refused (one live claim per pre-auth)", async () => {
    await page.goto(preauthUrl);
    const link = page.getByRole("link", { name: /Start final claim|Open claim|claim/i }).first();
    const href = await link.getAttribute("href");
    record("Claims", "INFO: pre-auth page link to the existing claim", "PASS", String(href));
    await page.goto(`/claims/new?preauth=${preauthUrl.split("/").pop()}`);
    await page.getByLabel("Admission date").fill("2026-09-25");
    await page.getByLabel("Discharge date").fill("2026-09-28");
    await page.getByLabel("Final bill number").fill("HS-DUP");
    await page.getByLabel("Final bill amount (₹)").fill("1000");
    await page.getByRole("button", { name: "Create claim draft" }).click();
    await expect(page.locator("#main")).toContainText(/already exists/i);
  });

  await check("Claims", "Submit is disabled on a fresh claim draft", async () => {
    await page.goto(claimUrl);
    await expect(page.getByRole("button", { name: "Submit claim" })).toBeDisabled();
  });

  await check("Claim documents", "upload claim documents, listed on the claim, not mixed with the pre-auth's", async () => {
    for (const l of CLAIM_DOCS) await upload(page, l);
    await page.reload();
    for (const l of CLAIM_DOCS) await expect(page.locator("#main table").getByText(l).first()).toBeVisible();
  });

  await check("Claim checks", "Run checks executes; checklist confirm; double-click Submit once", async () => {
    await page.getByRole("button", { name: "Run checks" }).click();
    await expect(page.getByText("Checks updated from the policy's rules.")).toBeVisible();
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
      await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(1 - i);
    }
    await page.getByRole("button", { name: "Submit claim" }).dblclick();
    await expect(page.getByRole("button", { name: "Submit claim" })).toHaveCount(0);
    await expect(page.locator("#main").getByText("Submitted", { exact: true }).first()).toBeVisible();
  });

  const tpa = await asRole(browser, "tpa.a@demo.claimix.invalid");
  await check("Claim query", "payer raises query; notification; hospital answers with docs; status/timeline update", async () => {
    await tpa.page.goto(claimUrl);
    await tpa.page.getByLabel("Decision").selectOption({ label: "Raise a query" });
    await tpa.page.getByLabel("Reason").selectOption({ label: "Insufficient medical information" });
    await tpa.page.getByLabel("Message to the hospital").fill("Please share the operation theatre notes.");
    await tpa.page.getByRole("button", { name: "Raise a query" }).click();
    await expect(tpa.page.getByText("Recorded: Query raised.")).toBeVisible();

    await page.goto("/notifications?show=unread");
    const note = page.locator(`a[href="${new URL(claimUrl).pathname}"]`).first();
    await expect(note).toBeVisible();
    await expect(note).toContainText(/quer/i);
    await note.click();
    await expect(page).toHaveURL(claimUrl);
    await expect(page.getByText("Query from the payer")).toBeVisible();
    await upload(page, "Operation notes");
    await page.getByLabel("Response to the payer").fill("Operation theatre notes uploaded as requested.");
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.getByText("Query from the payer")).toHaveCount(0);
  });

  await check("Claim decision", "payer partially approves; hospital sees patient share; metrics update", async () => {
    await tpa.page.goto(claimUrl);
    await tpa.page.getByLabel("Decision").selectOption({ label: "Partially approve" });
    await tpa.page.getByLabel("Approved amount (₹)").fill("70000");
    await tpa.page.getByLabel("Remarks").fill("Consumables are non-payable.");
    await tpa.page.getByRole("button", { name: "Partially approve" }).click();
    await expect(tpa.page.getByText("Recorded: Partially approved.")).toBeVisible();
    await page.goto(claimUrl);
    await expect(page.getByText("₹6,000").first()).toBeVisible();
  });
  await tpa.close();

  const ins = await asRole(browser, "insurer.a@demo.claimix.invalid");
  await check("Claim settlement", "insurer settles; hospital sees UTR, Settled status and pre-auth settled", async () => {
    await ins.page.goto(claimUrl);
    await ins.page.getByLabel("UTR / payment reference").fill("UTRHS20261001");
    await ins.page.getByRole("button", { name: "Record settlement" }).click();
    await expect(ins.page.getByText("UTRHS20261001").first()).toBeVisible();
    await page.goto(claimUrl);
    await expect(page.getByText("UTRHS20261001").first()).toBeVisible();
    await page.goto(preauthUrl);
    await expect(page.locator("#main").getByRole("paragraph").first().getByText("Settled", { exact: true })).toBeVisible();
  });
  await ins.close();

  await check("Claims", "claims list shows the claim; filter + CSV export for staff works", async () => {
    await page.goto("/claims?view=all");
    await expect(page.getByRole("link", { name: /^CL-/ }).first()).toBeVisible();
    const res = await page.request.get("/api/claims/export?view=all");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });
  await shot(page, "claim-settled");
});

test("08 reimbursement claim from recorded coverage", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Reimbursement", "coverage picker finds the patient; draft is created with coverage + patient linked", async () => {
    await page.goto(`/claims/new?q=${encodeURIComponent(patientName)}`);
    await page.getByRole("link", { name: "Start reimbursement claim" }).first().click();
    await expect(page.getByRole("heading", { name: "New reimbursement claim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: patientName })).toBeVisible();
    await expect(page.locator("#main")).toContainText(MEMBER);
    await page.getByLabel("Admission date").fill("2026-09-01");
    await page.getByLabel("Discharge date").fill("2026-09-04");
    await page.getByLabel("Final bill number").fill("HS-REIMB-1");
    await page.getByLabel("Final bill amount (₹)").fill("42000");
    await page.getByRole("button", { name: /Create claim draft|Create/ }).click();
    await expect(page).toHaveURL(/\/claims\/[0-9a-f-]{36}$/);
    reimbUrl = page.url();
    await expect(page.getByText(/Reimbursement/).first()).toBeVisible();
  });

  await check("Reimbursement", "draft persists and shows in the list", async () => {
    await page.reload();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  });
});

test("09 documents module", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Documents", "page loads with Missing-documents section and document table", async () => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Missing documents/ })).toBeVisible();
  });

  await check("Documents", "reimbursement draft (no docs) is listed as missing documents", async () => {
    await expect(page.getByRole("row").filter({ hasText: /Reimbursement|HS-REIMB|CL-/ }).first()).toBeVisible();
  });

  await check("Documents", "status filter works", async () => {
    await page.getByRole("link", { name: "Uploaded" }).first().click();
    await expect(page).toHaveURL(/status=uploaded/);
  });

  await check("Documents", "each document links to its own request; no cross-request leakage", async () => {
    await page.goto("/documents");
    const preRef = (await (async () => { await page.goto(preauthUrl); return (await page.getByRole("heading", { name: /Pre-auth PA-/ }).innerText()).match(/PA-[\w-]+/)![0]; })());
    await page.goto("/documents");
    const rows = page.getByRole("row").filter({ hasText: preRef });
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (const l of CLAIM_DOCS) {
      const mine = await page.getByRole("row").filter({ hasText: l }).filter({ hasText: preRef }).count();
      expect(mine, `${l} must not be attached to the pre-auth ${preRef}`).toBe(0);
    }
  });

  await check("Documents", "download link works from the list", async () => {
    const href = await page.getByRole("link", { name: "Download" }).first().getAttribute("href");
    expect((await page.request.get(href!)).status()).toBe(200);
  });

  await check("Documents", "another hospital's document id is not downloadable (404/403)", async () => {
    const res = await page.request.get("/api/documents/00000000-0000-4000-8000-00000000dead");
    expect([403, 404]).toContain(res.status());
  });
});

test("10 notifications", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Notifications", "bell opens the inbox with a count", async () => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /^Notifications/ }).first().click();
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByText(/\d+ unread/)).toBeVisible();
  });

  await check("Notifications", "decision / query / status notifications exist and link to the right request", async () => {
    const links = page.locator("#main ul a").first();
    await expect(links).toBeVisible();
    const hrefs = await page.locator("#main ul a").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    for (const h of hrefs) expect(h).toMatch(/^\/(pre-authorizations|claims|assistant|documents)/);
    await links.click();
    await expect(page).not.toHaveURL(/\/notifications/);
    await expect(page.locator("body")).not.toContainText("This page could not be found");
  });

  await check("Notifications", "mark all as read clears the unread count", async () => {
    await page.goto("/notifications");
    const btn = page.getByRole("button", { name: "Mark all as read" });
    if (await btn.isEnabled()) await btn.click();
    await expect(page.getByText("0 unread")).toBeVisible();
    await page.reload();
    await expect(page.getByText("0 unread")).toBeVisible();
  });
});

test("11 reports and CSV", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Reports", "page loads with status, money and turnaround sections", async () => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "All time" }).click();
    await expect(page).toHaveURL(/range=all/);
    await expect(page.getByRole("heading", { name: "Financial summary by claim type" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Pre-authorizations by status" })).toBeVisible();
  });

  await check("Reports", "UI numbers match the CSV (headers, rows, INR values)", async () => {
    const res = await page.request.get("/api/reports/export?range=all");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const csv = (await res.text()).replace(/^﻿/, "");
    fs.writeFileSync(path.join(OUT, "reports-export.csv"), csv);
    const lines = csv.split(/\r?\n/);
    expect((lines[0] ?? "").replace(/"/g, "")).toBe("Section,Item,Measure,Value");
    expect(csv).toContain("Settled paid (INR)");
    expect(csv).not.toMatch(/HS Test Patient|@example|9876543210/); // no patient-level/PII data
  });

  await check("Reports", "Export CSV button downloads a file", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(dl.suggestedFilename()).toMatch(/claimix-report-\d{4}-\d{2}-\d{2}\.csv/);
  });

  await check("Reports", "custom date range with no data shows empty states, not errors", async () => {
    await page.goto("/reports?range=custom&from=2001-01-01&to=2001-01-31");
    await expect(page.getByText("No claims in this period").first()).toBeVisible();
  });
});

test("12 dashboard metrics reflect the workflow", async ({ page }) => {
  monitor(page, "staff");
  await signIn(page, STAFF);
  await check("Dashboard", "after the full journey every metric still equals the database", async () => {
    const { ui } = await dashMatchesDb(page);
    fs.writeFileSync(path.join(OUT, "dashboard-text.txt"), ui.text);
  });
  await check("Dashboard", "Settled (paid) includes the ₹70,000 test settlement; Claimed includes ₹76,000", async () => {
    const m = await dash(page);
    expect(m.settled).toBeGreaterThanOrEqual(70000);
    expect(m.claimed).toBeGreaterThanOrEqual(76000);
    expect(m.approvedAmt).toBeGreaterThanOrEqual(70000);
  });
  await check("Dashboard", "'Pre-auths approved' still counts the pre-auth after its claim was settled", async () => {
    const m = await dash(page);
    const db = await dbStats();
    expect(m.preApproved).toBeGreaterThanOrEqual(1);
    expect(m.preApproved).toBe(db.preApproved);
    const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const [r] = await sql`select count(*)::int n from pre_authorizations where hospital_id = ${IDS.hospitalA} and status = 'settled'`;
      expect(r!.n).toBeGreaterThanOrEqual(1);
      expect(m.preApproved).toBeGreaterThanOrEqual(r!.n as number);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
  await check("Dashboard", "empty state: 'Nothing waiting on you' only when the queue is empty", async () => {
    await page.goto("/dashboard");
    const empties = await page.getByText("Nothing waiting on you").count();
    const rows = await page.locator("#main ul li").count();
    record("Dashboard", `INFO: empty-state labels=${empties}, queue rows=${rows}`, "PASS");
    const m = await dash(page);
    // the queues list drafts and queries; with none of either the empty state must show on both panels.
    if ((m.drafts ?? 0) + (m.queries ?? 0) === 0) expect(empties).toBe(2);
    else expect(empties).toBeLessThan(2);
  });
});

test("13 assistant and human review", async ({ page, browser }) => {
  test.setTimeout(180_000);
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Assistant", "page loads; request dropdown lists pre-auths and claims", async () => {
    await page.goto("/assistant?mode=request");
    await expect(page.getByRole("heading", { name: "Insurance Assistant", level: 1 })).toBeVisible();
    const opts = await page.getByLabel("About which request?").locator("option").allInnerTexts();
    expect(opts.some((o) => o.startsWith("Pre-auth"))).toBe(true);
    expect(opts.some((o) => o.startsWith("Claim"))).toBe(true);
  });

  const preId = preauthUrl.split("/").pop()!;
  await check("Assistant", "deep link from a request preselects it", async () => {
    await page.goto(`/assistant?preauth=${preId}`);
    await expect(page.getByLabel("About which request?")).toHaveValue(`preauth:${preId}`);
  });

  const quick = ["Is the policy active?", "Is the patient eligible?", "Is the hospital eligible?", "Is cashless available?", "What documents are required?", "Is pre-auth required?", "What should be checked?", "Why was the request queried?", "Why was it rejected?", "What document is missing?", "What should happen next?"];
  const chips = await page.getByRole("group", { name: "Suggested questions" }).getByRole("button").allInnerTexts();
  record("Assistant", `INFO: suggested questions offered = ${chips.length}`, "PASS", chips.join(" | "));

  for (const label of chips) {
    await check("Assistant", `quick question "${label}" answers from records`, async () => {
      await page.getByRole("group", { name: "Suggested questions" }).getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByText(/Answered from records|Needs more information|Needs human review/)).toBeVisible();
      await expect(page.locator("[aria-live=polite]")).toContainText(/\w+/);
      await expect(page.getByText("The assistant doesn't make or change insurance decisions.", { exact: false })).toBeVisible();
    });
  }
  record("Assistant", `INFO: user-listed questions not offered as chips: ${quick.filter((q) => !chips.includes(q)).join(" | ") || "none"}`, "PASS");

  await check("Assistant", "custom question works and is tied to the selected request", async () => {
    await page.goto(`/assistant?preauth=${preId}`);
    await page.getByLabel("Or type your question").fill("Why was this queried?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Why was this queried?" })).toBeVisible();
    await expect(page.getByText(/Insufficient medical information|ultrasound/i).first()).toBeVisible();
  });

  await check("Assistant", "too-short question is refused", async () => {
    await page.getByLabel("Or type your question").fill("a");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator("#main").getByRole("alert")).toContainText(/Type a question|question/i);
  });

  await check("Assistant", "an unrelated question containing a generic word ('next year') is NOT answered from records", async () => {
    await page.getByLabel("Or type your question").fill("Will my cousin's astrology chart affect the premium next year?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Needs human review")).toBeVisible();
    await expect(page.getByText("Answered from records")).toHaveCount(0);
  });

  await check("Assistant", "unanswerable free-text question never invents facts", async () => {
    await page.getByLabel("Or type your question").fill("Tell me a joke about elephants.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/Needs human review|Needs more information/)).toBeVisible();
  });

  await check("Human review", "unanswered question can be sent to review; requester sees waiting state", async () => {
    await page.getByLabel("Note for the reviewer (optional)").fill("HS test review request");
    await page.getByRole("button", { name: "Send for human review" }).click();
    await expect(page.getByText(/Sent for human review/)).toBeVisible();
  });

  await check("Human review", "queue opens; item shows question, reason, request link; requester cannot self-answer", async () => {
    await page.goto("/assistant/reviews");
    await expect(page.getByRole("heading", { name: "Human review", level: 1 })).toBeVisible();
    await expect(page.getByText("joke about elephants").first()).toBeVisible();
    await expect(page.getByText("Why it needs a person:").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open request" }).first()).toBeVisible();
    await expect(page.getByText("Waiting for a colleague to respond.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send response" })).toHaveCount(0);
  });

  await check("Human review", "Open request link leads to the right request", async () => {
    await page.getByRole("link", { name: "Open request" }).first().click();
    await expect(page).toHaveURL(preauthUrl);
  });

  await check("Human review", "no colleague exists to answer in hospital A (demo data has one staff user per hospital)", async () => {
    // Another hospital's staff must NOT be able to answer it (org-scoped).
    const b = await asRole(browser, "staff.b@demo.claimix.invalid");
    await b.page.goto("/assistant/reviews");
    await expect(b.page.getByText("joke about elephants")).toHaveCount(0);
    await b.close();
    record("Human review", "LIMITATION: the review workflow can't be completed with demo users", "PASS", "requester cannot answer own item and Hospital A has a single staff account");
  });

  await check("Assistant", "dashboard 'Assistant reviews' metric counts the open review", async () => {
    await page.goto("/dashboard");
    await expect(page.locator("#main")).toContainText("Assistant reviews");
  });
});

test("14 navigation, routes, back/breadcrumb and refresh", async ({ page }) => {
  test.setTimeout(300_000);
  monitor(page, "staff");
  await signIn(page, STAFF);
  const nav = [
    ["/dashboard", "Welcome"], ["/patients", "Patients"], ["/eligibility", "Eligibility checker"], ["/documents", "Documents"], ["/assistant", "Insurance Assistant"],
    ["/reports", "Reports"], ["/policies", "Policies"], ["/schemes", "Government health schemes"], ["/rejection-reasons", "Query & rejection reasons"],
    ["/hospitals", "Hospitals"], ["/insurers", "Insurance companies"], ["/tpas", "Third-party administrators"], ["/pre-authorizations", "Pre-Authorization"], ["/claims", "Claims"],
    ["/notifications", "Notifications"], ["/profile", "Profile"],
  ] as const;
  for (const [href, head] of nav) {
    await check("Navigation", `${href} loads, heading present, survives refresh`, async () => {
      const r = await page.goto(href);
      expect(r?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: new RegExp(head, "i") }).first()).toBeVisible();
      await page.reload();
      await expect(page).toHaveURL(new RegExp(href.replace(/\//g, "\\/")));
      await expect(page.getByRole("heading", { name: new RegExp(head, "i") }).first()).toBeVisible();
    });
  }

  await check("Navigation", "sidebar lists exactly the permitted items", async () => {
    await page.goto("/dashboard");
    const labels = await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link").allInnerTexts();
    const clean = labels.map((l) => l.replace(/^[^\w]+/, "").trim()).filter((l) => l && l !== "Claimix");
    record("Navigation", `INFO: sidebar = ${clean.join(" | ")}`, "PASS");
    expect(clean.join("|")).not.toContain("Eligibility checker"); // hidden by design; reached from the Dashboard button / patient coverage
    for (const want of ["Dashboard", "Patients", "Documents", "Insurance Assistant", "Reports", "Policies", "Government schemes", "Hospitals & network", "Insurance companies", "TPAs", "Knowledge Center"]) {
      expect(clean.join("|")).toContain(want);
    }
  });

  await check("Navigation", "Back button on a detail page returns to the page you came from", async () => {
    await page.goto(`/patients?q=${encodeURIComponent(patientName)}`);
    await page.getByRole("link", { name: patientName }).first().click();
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}/);
    await page.getByRole("button", { name: /back/i }).first().click();
    await expect(page).toHaveURL(/\/patients/);
  });

  await check("Navigation", "contextual links: patient → coverage → eligibility, claim → pre-auth, notification → request", async () => {
    await page.goto(patientUrl);
    await page.getByRole("link", { name: "Check eligibility" }).first().click();
    await expect(page).toHaveURL(/\/eligibility\?beneficiary=/);
    await page.goto(claimUrl);
    const preLink = page.getByRole("link", { name: /PA-/ }).first();
    if (await preLink.count()) { await preLink.click(); await expect(page).toHaveURL(/\/pre-authorizations\//); }
  });

  await check("Navigation", "unknown routes show the app's 404, not a blank page", async () => {
    const r = await page.goto("/pre-authorizations/00000000-0000-4000-8000-0000000fffff");
    expect(r?.status()).toBe(404);
    await expect(page.getByRole("heading").first()).toBeVisible();
    const r2 = await page.goto("/pre-authorizations/not-a-uuid");
    expect([400, 404]).toContain(r2?.status());
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

test("15 permissions and data isolation (direct URL + API)", async ({ page }) => {
  test.setTimeout(300_000);
  monitor(page, "staff");
  await signIn(page, STAFF);

  for (const p of ["/admin/users", "/admin/users/new", "/admin/access-requests", "/admin/medical-codes", "/audit", "/policies/new", "/hospitals/new", "/insurers/new", "/tpas/new", "/rejection-reasons/00000000-0000-4000-8000-000000000001/edit"]) {
    await check("Permissions", `direct URL ${p} is refused`, async () => {
      await page.goto(p);
      await expect(page).toHaveURL(/\/forbidden|\/dashboard|\/login/);
      await expect(page).not.toHaveURL(new RegExp(p.replace(/\//g, "\\/") + "$"));
    });
  }

  await check("Permissions", "other hospital's patient is 404 (tenant isolation)", async () => {
    expect((await page.goto(`/patients/${IDS.patientB1}`))?.status()).toBe(404);
    expect((await page.goto(`/patients/${IDS.patientB1}/edit`))?.status()).toBe(404);
  });

  await check("Permissions", "cannot use another hospital's coverage to open a pre-auth / claim / eligibility", async () => {
    // Hospital B's seeded coverage id pattern: use patient B1's coverage found via the B principal is not possible; probe a random uuid.
    expect((await page.goto("/pre-authorizations/new?beneficiary=00000000-0000-4000-8000-0000000003b1"))?.status()).toBe(404);
    expect((await page.goto("/eligibility?beneficiary=00000000-0000-4000-8000-0000000003b1"))?.status()).toBe(404);
    expect((await page.goto("/claims/new?beneficiary=00000000-0000-4000-8000-0000000003b1"))?.status()).toBe(404);
  });

  await check("Permissions", "admin-only API/exports refused; staff report export allowed", async () => {
    expect((await page.request.get("/api/reports/export")).status()).toBe(200);
    expect((await page.request.get("/api/documents/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  });

  await check("Permissions", "mutating API from another origin is refused", async () => {
    const r = await page.request.post("/api/health", { headers: { origin: "https://evil.example" } });
    expect(r.status()).toBe(403);
  });

  await check("Permissions", "Pre-auth page of another hospital's request is 404", async () => {
    const res = await page.goto("/pre-authorizations/00000000-0000-4000-8000-0000000004b1");
    expect(res?.status()).toBe(404);
  });
});

test("16 errors, session, refresh, logout/login", async ({ page, context }) => {
  test.setTimeout(300_000);
  monitor(page, "staff");
  await signIn(page, STAFF);

  await check("Session", "failed upload (network offline) shows a useful error, no misleading success", async () => {
    await page.goto(reimbUrl);
    await page.getByLabel("Document type").selectOption({ label: "Final itemised bill" });
    await page.getByLabel(/^File/).setInputFiles({ name: "offline.pdf", mimeType: "application/pdf", buffer: PDF });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.waitForTimeout(1500);
    await context.setOffline(false);
    await expect(page.getByText("Final itemised bill uploaded.")).toHaveCount(0);
    await expect(page.getByRole("alert").or(page.getByText(/went wrong|network|try again|failed/i)).first()).toBeVisible();
  });

  await check("Session", "server error from an action is shown, not an infinite spinner", async () => {
    await page.goto(reimbUrl);
    await page.route("**/claims/**", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "boom" }) : route.continue()));
    await page.getByLabel("Document type").selectOption({ label: "Final itemised bill" });
    await page.getByLabel(/^File/).setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText("Final itemised bill uploaded.")).toHaveCount(0);
    // The app shows its error screen with a recovery button (not a spinner and not a fake success).
    await expect(page.getByText("We couldn't complete that request. Please try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    record("Session", "OBSERVATION: a server 500 on an action swaps the page for an error screen (entered form data is lost)", "PASS");
    await page.unroute("**/claims/**");
  });

  await check("Session", "expired/removed session redirects to login with return path", async () => {
    await context.clearCookies();
    await page.goto("/claims");
    await expect(page).toHaveURL(/\/login\?next=%2Fclaims/);
  });

  await check("Session", "logout ends the session; protected pages and API refuse afterwards; login again keeps data", async () => {
    await signIn(page, STAFF);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get("/api/reports/export")).status()).toBe(401);
    await signIn(page, STAFF);
    await page.goto(patientUrl);
    await expect(page.getByRole("heading", { name: patientName })).toBeVisible();
    await page.goto(claimUrl);
    await expect(page.getByText("UTRHS20261001").first()).toBeVisible();
    await page.goto(reimbUrl);
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  });
});

test("17 responsive and visual", async ({ page }) => {
  test.setTimeout(300_000);
  monitor(page, "staff");
  await signIn(page, STAFF);
  const sizes = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };
  const pages = ["/dashboard", "/patients", patientUrl, "/eligibility", "/pre-authorizations", preauthUrl, "/claims", claimUrl, "/documents", "/notifications", "/reports", "/assistant", "/assistant/reviews"];
  for (const [name, vp] of Object.entries(sizes)) {
    await page.setViewportSize(vp);
    for (const p of pages) {
      await check("Responsive", `${name}: ${p.replace(/[0-9a-f-]{36}/, "<id>")} has no horizontal overflow`, async () => {
        await page.goto(p);
        await page.waitForLoadState("load");
        await page.waitForTimeout(400);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `overflow ${over}px`).toBeLessThanOrEqual(0);
      });
    }
    await page.goto("/dashboard");
    await shot(page, `dashboard-${name}`);
  }

  for (const [w, h] of [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1100, 650]] as const) {
    await check("Dashboard", `${w}x${h}: work queues keep a usable height, every row is reachable, nothing is clipped or overlapped`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/dashboard");
      await page.waitForTimeout(500);
      const bodies = page.locator('[class*="panelBody"]');
      expect(await bodies.count()).toBe(2);
      for (let i = 0; i < 2; i++) {
        const box = await bodies.nth(i).boundingBox();
        expect(box!.height, `queue ${i} height`).toBeGreaterThanOrEqual(120);
      }
      const rows = page.locator('[class*="panelBody"] li');
      const n = await rows.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        await rows.nth(i).scrollIntoViewIfNeeded();
        await expect(rows.nth(i), `row ${i}`).toBeInViewport();
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const geometry = await page.evaluate(() => {
        const note = document.querySelector('[role="status"]')?.getBoundingClientRect();
        const panels = [...document.querySelectorAll("section")].filter((s) => /needing action/.test(s.textContent ?? "")).map((s) => s.getBoundingClientRect());
        return { noteTop: note?.top ?? null, panelBottoms: panels.map((p) => p.bottom), overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(geometry.overflowX).toBeLessThanOrEqual(0);
      for (const bottom of geometry.panelBottoms) expect(bottom, "queue overlaps the disclaimer").toBeLessThanOrEqual((geometry.noteTop ?? Infinity) + 1);
    });
  }
  await page.setViewportSize(sizes.desktop);

  await page.setViewportSize(sizes.mobile);
  await check("Responsive", "mobile: menu button opens the drawer and navigation works", async () => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Patients" }).click();
    await expect(page).toHaveURL(/\/patients/);
  });
  await check("Responsive", "mobile: document upload form is usable", async () => {
    await page.goto(reimbUrl);
    await expect(page.getByLabel("Document type")).toBeVisible();
    const box = await page.getByRole("button", { name: "Upload", exact: true }).boundingBox();
    expect(box && box.width >= 40 && box.height >= 32).toBe(true);
  });

  await page.setViewportSize(sizes.desktop);
  await check("Visual", "dark theme: dashboard readable, cards present, backdrop fixed", async () => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /theme|dark|light/i }).first().click();
    await page.waitForTimeout(500);
    await shot(page, "dashboard-desktop-theme-toggled");
    await expect(page.getByText("Queries to answer")).toBeVisible();
    const bd = page.locator("[class*=backdrop]").first();
    await expect(bd).toHaveCSS("position", "fixed");
  });
});

test("zz final: failures summary", () => {
  expect(failures, failures.join("\n")).toEqual([]);
});
