import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const OUT = "I'm the Claimix Insurance Assistant. I can only help with the Claimix application";

async function openAssistant(page: Page) {
  await page.getByRole("link", { name: "Insurance Assistant" }).first().click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByRole("heading", { name: "Ask Claimix" })).toBeVisible();
}

/** Types a question, sends it, and returns the newest assistant message. */
async function ask(page: Page, question: string) {
  const before = await page.locator('[role="log"] > div:has(> span[aria-hidden])').count();
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Thinking" })).toHaveCount(0); // the reply has arrived
  await expect(page.locator('[role="log"] > div:has(> span[aria-hidden])')).toHaveCount(before + 1);
  return page.locator('[role="log"] > div:has(> span[aria-hidden])').last();
}

/** The Navigation-path blocks of a message, one string per block ("Dashboard → Claims needing action"). */
const paths = async (msg: ReturnType<Page["locator"]>) => (await msg.getByRole("group", { name: /^Navigation path/ }).allInnerTexts()).map((t) => t.replace(/\s*\n\s*/g, " → ").replace(/(→ )+→/g, "→"));

test.describe("Insurance Assistant: Claimix guide", () => {
  test("Hospital Staff: navigation, workflow, status and role answers use the real screens", async ({ page }) => {
    test.setTimeout(180_000);
    const leaked: string[] = [];
    page.on("response", async (r) => {
      const type = r.headers()["content-type"] ?? "";
      if (!/text|json|javascript/.test(type)) return;
      const body = await r.text().catch(() => "");
      if (/sk-or-|OPENROUTER_API_KEY|openrouter\.ai/i.test(body)) leaked.push(r.url());
    });

    await signIn(page, "staff.a@demo.claimix.invalid");
    await openAssistant(page);

    // Suggested questions for this role, then a ChatGPT-style thread.
    await expect(page.getByRole("button", { name: "How do I create a pre-authorization?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Explain my dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "How do I review a pre-authorization?" })).toHaveCount(0);

    let m = await ask(page, "How do I create a pre-authorization?");
    await expect(m).toContainText("Create draft");
    await expect(m).toContainText("Submit Pre-Authorization");
    expect(await paths(m)).toContain("Dashboard → New pre-authorization");
    await m.getByRole("link", { name: "New pre-authorization" }).hover(); // the link is offered

    m = await ask(page, "Where can I find claims?");
    expect(await paths(m)).toContain("Dashboard → Claims needing action");

    m = await ask(page, "I can't find the eligibility checker");
    expect(await paths(m)).toContain("Dashboard → Check eligibility");
    await expect(m).toContainText("Check eligibility button");

    m = await ask(page, "What does awaiting payer mean?");
    await expect(m).toContainText("waiting for the insurance/payer team to review and decide");

    m = await ask(page, "How do I upload documents?");
    await expect(m).toContainText("Document type");

    m = await ask(page, "Why can't I approve this?");
    await expect(m).toContainText("payer/insurer-side action");

    m = await ask(page, "Where can I find reports?");
    expect(await paths(m)).toContain("Sidebar → Reports");

    m = await ask(page, "I cannot find the pre-auth I submitted");
    await expect(m).toContainText("All");
    await expect(m).toContainText("Draft");

    // The navigation the assistant gave really exists: follow its link and land on the screen.
    m = await ask(page, "Where can I find policies?");
    await m.getByRole("link", { name: "Open Policies" }).click();
    await expect(page).toHaveURL(/\/policies$/);
    await expect(page.getByRole("heading", { name: "Policies", level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Ask Claimix" })).toBeVisible();
    // The conversation is still there after coming back; New conversation clears it.
    await expect(page.getByText("Where can I find policies?").first()).toBeVisible();
    await page.getByRole("button", { name: "New conversation" }).click();
    await expect(page.getByRole("button", { name: "New conversation" })).toBeDisabled(); // empty again
    await expect(page.getByText("Hi! I am the Claimix Insurance Assistant.")).toBeVisible();

    // The dashboard card paths it describes exist on the dashboard.
    await page.goto("/dashboard");
    for (const card of ["Awaiting payer", "Pre-auths approved", "Settled \\(paid\\)"]) await expect(page.getByRole("link", { name: new RegExp(`^\\s*${card}`) })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check eligibility" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New pre-authorization" })).toBeVisible();

    expect(leaked, "no response mentions the OpenRouter key or endpoint").toEqual([]);
  });

  test("out-of-scope questions get the fixed Claimix-only reply", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await openAssistant(page);
    for (const q of ["What is the capital of India?", "Write Python code.", "Give me a recipe.", "Who is Elon Musk?"]) {
      const m = await ask(page, q);
      await expect(m).toContainText(OUT);
      await expect(m).not.toContainText("New Delhi");
    }
  });

  test("Payer Reviewer: own suggestions and review path; cannot create pre-authorizations", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await openAssistant(page);
    await expect(page.getByRole("button", { name: "How do I review a pre-authorization?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "How do I create a pre-authorization?" })).toHaveCount(0);

    let m = await ask(page, "Where can I find pre-authorizations?");
    expect(await paths(m)).toContain("Dashboard → Pre-auths awaiting decision → View");

    m = await ask(page, "How do I approve a claim?");
    await expect(m).toContainText("Decision");
    await expect(m).toContainText("Partially approve");

    m = await ask(page, "How do I create a pre-authorization?");
    await expect(m).toContainText("created by hospital staff");

    m = await ask(page, "What can a Payer Reviewer do?");
    await expect(m).toContainText("Reviews pre-auths and claims");
  });

  test("Insurance portal testing context: answers follow the selected insurer and role", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "insurer.portal@demo.claimix.invalid");
    await page.goto("/dashboard");
    await page.getByLabel("Insurance Company").selectOption({ label: "Navjeevan General Insurance (DEMO DATA)" });
    const role = page.getByLabel("Role", { exact: true });
    const options = (await role.locator("option").allInnerTexts()).filter((t) => t !== "Select Role");
    await role.selectOption({ label: options[0]! });
    await page.getByRole("button", { name: "Switch Context" }).click();
    await expect(page.getByRole("status", { name: "Current testing context" })).toBeVisible();

    await openAssistant(page);
    const m = await ask(page, "Why can't I see this Aarogya pre-auth?");
    await expect(m).toContainText("Navjeevan General Insurance");
    await expect(m).toContainText("Switch Context");
  });
});
