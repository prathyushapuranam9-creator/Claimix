/**
 * The questions the Insurance Assistant can answer from records (spec §24).
 * Classification is deterministic keyword matching — no free-form generation.
 */
export const INTENTS = {
  policy_active: "Is the policy active?",
  patient_eligible: "Is the patient eligible?",
  hospital_eligible: "Is the hospital eligible?",
  cashless_available: "Is cashless available?",
  documents_required: "What documents are required?",
  preauth_required: "Is pre-auth required?",
  what_to_check: "What should be checked?",
  why_query: "Why was the request queried?",
  why_rejected: "Why was it rejected?",
  missing_documents: "What document is missing?",
  next_step: "What should happen next?",
} as const;

export type Intent = keyof typeof INTENTS;

/** Ordered: more specific patterns first (e.g. "missing documents" before "documents"). */
const PATTERNS: [Intent, RegExp][] = [
  ["missing_documents", /\b(missing|not uploaded|re-?upload|lacking)\b/i],
  ["why_rejected", /\b(reject(ed|ion)?|denied|declined|repudiat)/i],
  ["why_query", /\b(quer(y|ied|ies)|why .*asked)\b/i],
  ["preauth_required", /\bpre-?auth(ori[sz]ation)?\b.*\b(required|needed|need|necessary)\b|\b(need|require)s?\b.*\bpre-?auth/i],
  ["cashless_available", /\bcashless\b/i],
  ["hospital_eligible", /\b(hospital|network|empanel)/i],
  ["documents_required", /\b(documents?|papers?|paperwork)\b/i],
  ["patient_eligible", /\b(patient|member)\b.*\b(eligib|covered)|\beligib/i],
  ["policy_active", /\b(policy|scheme|cover(age)?)\b.*\b(active|valid|expired?|lapsed|in force|running)\b|\bactive\b/i],
  ["what_to_check", /\b(check(ed|s|ing|list)?|verif(y|ied|ication)|review)\b/i],
  ["next_step", /\b(next|now what|what (should|do|to do)|happen)\b/i],
];

export function classify(question: string): Intent | null {
  const q = question.trim();
  if (!q) return null;
  for (const [intent, re] of PATTERNS) if (re.test(q)) return intent;
  return null;
}
