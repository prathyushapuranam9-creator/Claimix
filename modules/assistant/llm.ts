import type { Answer } from "./answer";

/**
 * Optional language-model adapter. Disabled unless LLM_ASSISTANT_ENABLED=true
 * AND a provider is wired in. It may only rephrase an answer the rules engine has
 * already produced; the structured answer (headline, status, facts, sources) is
 * never replaced, so a model can't change or invent an insurance decision.
 */
export interface AssistantLlm {
  /** Returns plain-language wording for an existing answer, or null. */
  explain(answer: Answer): Promise<string | null>;
}

const disabled: AssistantLlm = { explain: async () => null };

export function getAssistantLlm(): AssistantLlm {
  if (process.env.LLM_ASSISTANT_ENABLED !== "true") return disabled;
  // No provider is configured in this deployment; the rules-based assistant is authoritative.
  return disabled;
}

export function llmEnabled(): boolean {
  return false;
}
