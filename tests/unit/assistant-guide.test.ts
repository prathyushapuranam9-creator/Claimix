import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLES, type PermissionKey } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { guideChat, isOutOfScope, ruleAnswer } from "@/modules/assistant/guide";
import { OUT_OF_SCOPE, whoIs } from "@/modules/assistant/knowledge";
import type { ServiceContext } from "@/lib/auth/context";

// Record lookups need the database (covered by the integration tests); here no identifiers are found.
vi.mock("@/modules/assistant/lookup", async (orig) => ({ ...(await orig<typeof import("@/modules/assistant/lookup")>()), lookupIdentifiers: async () => ({ found: [], missing: [] }), recentRequests: async () => [] }));
const serviceCtx = (p: Principal) => ({ db: {}, principal: p, meta: {} }) as unknown as ServiceContext;

const principal = (roleKey: string, orgType: Principal["orgType"], acting?: Principal["acting"]): Principal => ({
  userId: "u", organizationId: "o", orgType, roleKey, patientId: null, sessionId: "s", acting,
  permissions: new Map(Object.entries(ROLES.find((r) => r.key === roleKey)!.grants) as [PermissionKey, "own" | "organization" | "all"][]),
});
const frontDesk = whoIs(principal("hospital_staff", "hospital"));
const payer = whoIs(principal("payer_reviewer", "insurer"));
const testing = whoIs(principal("payer_reviewer", "insurer", { organizationName: "Aarogya Shield General Insurance", roleName: "Payer Reviewer" }));
const ask = (w: typeof payer, q: string) => ruleAnswer(w, q)?.markdown ?? null;

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("scope control", () => {
  it.each(["What is the capital of India?", "Write Python code.", "What is today's weather?", "Who is Elon Musk?", "Give me a recipe.", "Explain Java.", "Write an email for me."])("refuses %s", async (q) => {
    expect(isOutOfScope(q, false)).toBe(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const r = await guideChat(serviceCtx(principal("payer_reviewer", "insurer")), q, []);
    expect(r.markdown).toBe(OUT_OF_SCOPE);
    expect(fetchSpy).not.toHaveBeenCalled(); // never sent to the model
  });
  it("keeps Claimix questions in scope", () => {
    for (const q of ["How do I create a pre-authorization?", "Where can I find claims?", "What does awaiting payer mean?"]) expect(isOutOfScope(q, false)).toBe(false);
  });
});

describe("navigation matches the application", () => {
  it("payer reviewers reach the decision list from their own dashboard cards", () => {
    expect(ask(payer, "Where can I find pre-authorizations?")).toContain("Dashboard\n\u2192 Pre-auths awaiting decision\n\u2192 View");
  });

  it("sidebar items use the real labels, and a role that lacks one is told so", () => {
    expect(ask(payer, "Where can I find reports?")).toContain("Sidebar\n\u2192 Reports");
    expect(ask(payer, "Where can I find the audit log?")).toContain("not available to your role");
  });

  it("creating a pre-authorization is refused to payers, who review instead", () => {
    const a = ask(payer, "How do I create a pre-authorization?")!;
    expect(a).toContain("created by hospital staff");
    expect(a).toContain("you review and decide");
  });

  it("tells the front desk that the insurance side is not theirs", () => {
    // Hospital Staff is registration only: the assistant must not point them at screens they cannot open.
    for (const q of ["How do I create a pre-authorization?", "Where do I add coverage?", "How do I check eligibility?", "How do I upload documents?"]) {
      expect(ask(frontDesk, q)).toMatch(/cannot|not available|hospital staff|payer\/insurer-side/i);
    }
  });
});

describe("statuses, roles and context", () => {
  it("explains Awaiting payer exactly as the application uses it", () => {
    expect(ask(payer, "What does awaiting payer mean?")).toMatch(/waiting for the insurance\/payer team to review and decide/);
  });

  it("does not invent statuses", () => {
    expect(ask(payer, "What does flibbertigibbet status mean?")).toBeNull();
  });

  it("payer reviewers can approve; the answer names the Decision card", () => {
    const p = ask(payer, "How do I approve a claim?")!;
    expect(p).toContain("Decision");
    expect(p).toContain("Approve");
  });

  it("answers about another insurer from the current context", () => {
    const a = ask(testing, "Why can't I see this Navjeevan pre-auth?")!;
    expect(a).toContain("Aarogya Shield General Insurance");
    expect(a).toContain("Switch Context");
    expect(ask(payer, "Why can't I see this Navjeevan pre-auth?")).toContain("only sees requests addressed to its own organization");
  });

  it("explains the payer dashboard and where it leads", () => {
    const a = ask(payer, "Explain my dashboard")!;
    expect(a).toContain("Pre-auths awaiting decision");
    expect(a).toContain("Claims awaiting decision");
  });

  it("describes roles from the role catalog", () => {
    expect(ask(payer, "What can a Payer Reviewer do?")).toContain("Reviews pre-auths and claims");
    expect(ask(payer, "What can Hospital Staff do?")).toContain("Registers patients");
  });
});

describe("model use", () => {
  it("falls back to an honest answer when the model is off", async () => {
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "false");
    const r = await guideChat(serviceCtx(principal("payer_reviewer", "insurer")), "Do you integrate with the quantum ledger module in Claimix?", []);
    expect(r.markdown).toContain("I don't have enough information to confirm that feature");
  });
  it("sends the knowledge base and history to OpenRouter and maps OUT_OF_SCOPE", async () => {
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OUT_OF_SCOPE" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await guideChat(serviceCtx(principal("payer_reviewer", "insurer")), "Tell me about the quantum ledger module in Claimix", []);
    expect(r.markdown).toBe(OUT_OF_SCOPE);
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.messages[0].content).toContain("APPLICATION KNOWLEDGE");
    expect(body.messages[0].content).toContain("Claims awaiting decision");
    expect(JSON.stringify(r)).not.toContain("sk-or-test");
  });
});
