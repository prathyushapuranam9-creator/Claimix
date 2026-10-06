import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLES, type PermissionKey } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { guideChat, isOutOfScope, ruleAnswer } from "@/modules/assistant/guide";
import { OUT_OF_SCOPE, whoIs } from "@/modules/assistant/knowledge";

const principal = (roleKey: string, orgType: Principal["orgType"], acting?: Principal["acting"]): Principal => ({
  userId: "u", organizationId: "o", orgType, roleKey, patientId: null, sessionId: "s", acting,
  permissions: new Map(Object.entries(ROLES.find((r) => r.key === roleKey)!.grants) as [PermissionKey, "own" | "organization" | "all"][]),
});
const hospital = whoIs(principal("hospital_staff", "hospital"));
const payer = whoIs(principal("payer_reviewer", "insurer"));
const testing = whoIs(principal("payer_reviewer", "insurer", { organizationName: "Aarogya Shield General Insurance", roleName: "Payer Reviewer" }));
const ask = (w: typeof hospital, q: string) => ruleAnswer(w, q)?.markdown ?? null;

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("scope control", () => {
  it.each(["What is the capital of India?", "Write Python code.", "What is today's weather?", "Who is Elon Musk?", "Give me a recipe.", "Explain Java.", "Write an email for me."])("refuses %s", async (q) => {
    expect(isOutOfScope(q, false)).toBe(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const r = await guideChat(principal("hospital_staff", "hospital"), q, []);
    expect(r.markdown).toBe(OUT_OF_SCOPE);
    expect(fetchSpy).not.toHaveBeenCalled(); // never sent to the model
  });
  it("keeps Claimix questions in scope", () => {
    for (const q of ["How do I create a pre-authorization?", "Where can I find claims?", "What does awaiting payer mean?"]) expect(isOutOfScope(q, false)).toBe(false);
  });
});

describe("navigation matches the application", () => {
  it("claims and pre-authorizations for hospital staff start from the dashboard (they are not in the sidebar)", () => {
    expect(ask(hospital, "Where can I find claims?")).toContain("Dashboard\n→ Claims needing action");
    expect(ask(hospital, "Where can I find pre-authorizations?")).toContain("Dashboard\n→ Pre-authorizations needing action");
  });
  it("payer reviewers reach the decision list from their own dashboard cards", () => {
    expect(ask(payer, "Where can I find pre-authorizations?")).toContain("Dashboard\n→ Pre-auths awaiting decision\n→ View");
  });
  it("eligibility checker is the dashboard button for hospital staff", () => {
    const a = ask(hospital, "I can't find the eligibility checker")!;
    expect(a).toContain("Dashboard\n→ Check eligibility");
    expect(a).toContain("Check eligibility button");
  });
  it("sidebar items use the real labels and roles that lack them are told so", () => {
    expect(ask(hospital, "Where can I find reports?")).toContain("Sidebar\n→ Reports");
    expect(ask(hospital, "Where can I find policies?")).toContain("Sidebar\n→ Policies");
    expect(ask(hospital, "Where can I find the audit log?")).toContain("not available to your role");
  });
  it("creating a pre-authorization uses the real labels and is refused to payers", () => {
    const a = ask(hospital, "How do I create a pre-authorization?")!;
    for (const label of ["New pre-authorization", "Create draft", "Run checks", "Submit Pre-Authorization", "Upload"]) expect(a).toContain(label);
    expect(ask(payer, "How do I create a pre-authorization?")).toContain("created by hospital staff");
  });
  it("upload documents explains the workflow", () => {
    const a = ask(hospital, "How do I upload documents?")!;
    expect(a).toContain("Document type");
    expect(a).toContain("Upload");
  });
});

describe("statuses, roles and context", () => {
  it("explains Awaiting payer exactly as the application uses it", () => {
    expect(ask(hospital, "What does awaiting payer mean?")).toMatch(/waiting for the insurance\/payer team to review and decide/);
  });
  it("does not invent statuses", () => {
    expect(ask(hospital, "What does flibbertigibbet status mean?")).toBeNull();
  });
  it("hospital staff cannot approve; payer reviewers can", () => {
    expect(ask(hospital, "Why can't I approve this?")).toContain("payer/insurer-side action");
    const p = ask(payer, "How do I approve a claim?")!;
    expect(p).toContain("Decision");
    expect(p).toContain("Approve");
  });
  it("a missing submitted pre-auth gets a checklist, with the insurer context for testing accounts", () => {
    expect(ask(hospital, "I cannot find the pre-auth I submitted")).toContain("**All** tab");
    expect(ask(testing, "I cannot find the pre-auth I submitted")).toContain("Aarogya Shield General Insurance");
  });
  it("answers about another insurer from the current context", () => {
    const a = ask(testing, "Why can't I see this Navjeevan pre-auth?")!;
    expect(a).toContain("Aarogya Shield General Insurance");
    expect(a).toContain("Switch Context");
    expect(ask(payer, "Why can't I see this Navjeevan pre-auth?")).toContain("only sees requests addressed to its own organization");
    expect(ask(hospital, "Why can't I see this Navjeevan pre-auth?")).toContain("not for hospital staff");
  });
  it("explains the dashboard cards and where they lead", () => {
    const a = ask(hospital, "Explain my dashboard")!;
    expect(a).toContain("Awaiting payer");
    expect(a).toContain("Settled (paid)");
  });
  it("describes roles from the role catalog", () => {
    expect(ask(payer, "What can a Payer Reviewer do?")).toContain("Reviews pre-auths and claims");
  });
});

describe("model use", () => {
  it("falls back to an honest answer when the model is off", async () => {
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "false");
    const r = await guideChat(principal("hospital_staff", "hospital"), "Do you integrate with the quantum ledger module in Claimix?", []);
    expect(r.markdown).toContain("I don't have enough information to confirm that feature");
  });
  it("sends the knowledge base and history to OpenRouter and maps OUT_OF_SCOPE", async () => {
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OUT_OF_SCOPE" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await guideChat(principal("hospital_staff", "hospital"), "Tell me about the quantum ledger module in Claimix", []);
    expect(r.markdown).toBe(OUT_OF_SCOPE);
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.messages[0].content).toContain("APPLICATION KNOWLEDGE");
    expect(body.messages[0].content).toContain("Claims needing action");
    expect(JSON.stringify(r)).not.toContain("sk-or-test");
  });
});
