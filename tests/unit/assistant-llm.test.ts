import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Answer } from "@/modules/assistant/answer";
import { getAssistantLlm } from "@/modules/assistant/llm";

const answer: Answer = { intent: null, question: "Why is it pending?", headline: "Waiting for the payer", status: "answered", facts: [{ text: "Status: Submitted", source: "record" }], askFor: [], nextSteps: [], sequence: [] };
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("OpenRouter assistant adapter", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
    vi.stubEnv("OPENROUTER_MODEL", "test/model");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("is off unless enabled", async () => {
    vi.stubEnv("LLM_ASSISTANT_ENABLED", "false");
    expect(await getAssistantLlm().explain(answer)).toBeNull();
  });

  it("calls OpenRouter server-side with the configured key and model, and returns the text", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { choices: [{ message: { content: " It is waiting for the payer. " } }] }));
    vi.stubGlobal("fetch", f);
    expect(await getAssistantLlm().explain(answer)).toEqual({ ok: true, text: "It is waiting for the payer." });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-or-test-key");
    expect(JSON.parse(init.body).model).toBe("test/model");
  });

  it("reports a missing key without calling out", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await getAssistantLlm().explain(answer)).toMatchObject({ ok: false, reason: "missing_key" });
    expect(f).not.toHaveBeenCalled();
  });

  it.each([[401, "invalid_key"], [403, "invalid_key"], [404, "model_unavailable"], [429, "rate_limited"], [500, "failed"]])("maps HTTP %i to %s, never echoing the key", async (status, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(status)));
    const r = await getAssistantLlm().explain(answer);
    expect(r).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(r)).not.toContain("sk-or-test-key");
  });

  it("maps a timeout and a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })));
    expect(await getAssistantLlm().explain(answer)).toMatchObject({ ok: false, reason: "timeout" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getAssistantLlm().explain(answer)).toMatchObject({ ok: false, reason: "failed" });
  });
});
