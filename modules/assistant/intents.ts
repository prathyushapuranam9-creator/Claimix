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

/**
 * Ordered: more specific patterns first (e.g. "missing documents" before "documents").
 *
 * A generic word on its own ("next", "check", "review", "active", "year") never selects a topic: those words only
 * count inside a phrase that is clearly about the request ("what should happen next", "is the policy active",
 * "what should be checked"). Anything that doesn't match falls through to human review.
 */
const PATTERNS: [Intent, RegExp][] = [
  ["missing_documents", /\bwhat(?:'s|\s+is|\s+are)?\b.*\bmissing\b|\b(?:documents?|papers?|reports?|files?|uploads?)\b.*\bmissing\b|\bmissing\b.*\b(?:documents?|papers?|reports?|files?|uploads?)\b|\banything missing\b|\b(?:not uploaded|re-?upload|lacking)\b/i],
  ["why_rejected", /\b(?:reject(?:ed|ion)?|repudiat\w*)|\b(?:denied|declined)\b.*\b(?:claim|request|pre-?auth\w*|authori[sz]ation|it|this)\b/i],
  ["why_query", /\bquer(?:y|ied|ies)\b|\bwhy\b.*\b(?:asked|questioned)\b.*\b(?:more|information|documents?|details|clarif\w*)/i],
  ["preauth_required", /\bpre-?auth(?:ori[sz]ation)?\b.*\b(?:required|needed|need|necessary)\b|\b(?:need|require)s?\b.*\bpre-?auth/i],
  ["cashless_available", /\bcashless\b/i],
  ["hospital_eligible", /\b(?:hospital|network|empanel)/i],
  ["documents_required", /\b(?:documents?|papers?|paperwork)\b/i],
  ["patient_eligible", /\b(?:patient|member)\b.*\b(?:eligib|covered)|\beligib/i],
  ["policy_active", /\b(?:policy|scheme|cover(?:age)?|insurance|plan|enrol?ment)\b.*\b(?:active|valid|expired?|lapsed|in force|running)\b|\b(?:active|valid|in force|lapsed|expired)\b.*\b(?:policy|scheme|cover(?:age)?|insurance)\b/i],
  ["what_to_check", /\b(?:what|which)\b.*\b(?:check(?:ed)?|verif(?:y|ied)|review(?:ed)?)\b|\bcheck ?list\b|\bto (?:check|verify)\b/i],
  ["next_step", /\bnext (?:steps?|actions?|stage)\b|\bwhat(?:'s|\s+is)\s+next\b|\bnow what\b|\bwhat now\b|\bwhat (?:happens|should happen|will happen) (?:next|now|after|then)\b|\bwhat (?:should|do|can|must) (?:we|i|they|the hospital|staff)\b.*\b(?:do|next|now)\b|\bwhat to do\b/i],
];

export function classify(question: string): Intent | null {
  const q = question.trim();
  if (!q) return null;
  for (const [intent, re] of PATTERNS) if (re.test(q)) return intent;
  return null;
}
