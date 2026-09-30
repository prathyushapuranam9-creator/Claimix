/**
 * Insurance glossary (spec §10). General explanations only — the exact meaning
 * in any case is set by the policy wording or scheme rules.
 */
export interface GlossaryTerm {
  slug: string;
  term: string;
  simple: string;
  example: string;
  why: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  { slug: "insurer", term: "Insurer", simple: "The insurance company that issues the policy and pays admissible claims.", example: "A general or health insurance company that sold the family's health policy.", why: "The insurer's policy wording and decision are what finally count, not the hospital's or the platform's view." },
  { slug: "policy", term: "Policy", simple: "The contract between the insurer and the policyholder, setting out what is covered and on what conditions.", example: "A one-year family floater policy with a ₹5 lakh sum insured.", why: "Every check — waiting periods, exclusions, limits — comes from the policy wording." },
  { slug: "premium", term: "Premium", simple: "The amount paid to buy or renew the policy.", example: "₹18,000 paid each year to keep the policy in force.", why: "If the premium isn't paid on time the policy can lapse, and claims during a break in cover aren't payable." },
  { slug: "insured", term: "Insured", simple: "The person whose health is covered by the policy.", example: "The policyholder's mother, covered under a family policy.", why: "Only people named as insured members can claim." },
  { slug: "policyholder", term: "Policyholder", simple: "The person who owns the policy and pays the premium.", example: "An employee who buys a floater policy covering spouse and children.", why: "The policyholder is usually the person the insurer communicates with and pays in reimbursement cases." },
  { slug: "member-id", term: "Member ID", simple: "The unique ID printed on the health card that identifies an insured person.", example: "The ID on the insurance card that the hospital enters in the pre-authorization form.", why: "A wrong or mismatched member ID is a common reason for queries." },
  { slug: "sum-insured", term: "Sum insured", simple: "The maximum amount the policy will pay in a policy year.", example: "With ₹3 lakh sum insured and ₹1 lakh already claimed, about ₹2 lakh may remain.", why: "Costs above the available sum insured are paid by the patient." },
  { slug: "claim", term: "Claim", simple: "A request to the insurer or scheme to pay for treatment under the policy.", example: "The final bill and discharge summary submitted after an appendix operation.", why: "A claim is assessed against the policy; being insured doesn't mean every claim is paid in full." },
  { slug: "cashless", term: "Cashless", simple: "The insurer pays a network hospital directly for the approved amount.", example: "The hospital's insurance desk raises a pre-authorization; after approval the patient pays only what isn't covered.", why: "Cashless does not mean free — co-pay, non-payable items and amounts above limits are still paid by the patient." },
  { slug: "reimbursement", term: "Reimbursement", simple: "The patient pays the hospital first and claims the admissible amount back from the insurer.", example: "Treatment at a non-network hospital, with original bills submitted afterwards.", why: "Keep all original bills, reports and receipts — and check the claim deadline." },
  { slug: "network-hospital", term: "Network hospital", simple: "A hospital that has an agreement with an insurer or TPA for cashless treatment.", example: "A multispeciality hospital listed in the insurer's network directory.", why: "Network status changes, so it must be verified with the payer before admission." },
  { slug: "tpa", term: "TPA", simple: "A Third-Party Administrator that processes cashless requests and claims for an insurer.", example: "The TPA reviews the pre-authorization, raises a query, then approves it on the insurer's behalf.", why: "The TPA follows the insurer's policy terms; it does not change them." },
  { slug: "waiting-period", term: "Waiting period", simple: "A time after the policy starts during which some or all claims aren't payable.", example: "A 30-day initial waiting period, and two years for cataract surgery.", why: "Treatment inside a waiting period is usually not covered, except where the policy says otherwise (for example accidents)." },
  { slug: "ped", term: "PED (pre-existing disease)", simple: "A condition the person had before the policy started.", example: "Diabetes diagnosed before buying the policy, declared on the proposal form.", why: "Declared PEDs are usually covered only after a waiting period; undeclared ones can lead to rejection." },
  { slug: "co-pay", term: "Co-pay", simple: "A fixed percentage of each admissible claim that the patient pays.", example: "With 20% co-pay on a ₹1 lakh admissible claim, the patient pays ₹20,000.", why: "Co-pay applies even when the claim is approved." },
  { slug: "deductible", term: "Deductible", simple: "An amount the patient (or another policy) must bear before this policy pays.", example: "A super top-up with a ₹3 lakh deductible pays only admissible costs above ₹3 lakh.", why: "Top-up and super top-up policies rely on deductibles; a claim below it isn't payable by that policy." },
  { slug: "room-rent-limit", term: "Room rent limit", simple: "The maximum room charge per day the policy pays for.", example: "A limit of 1% of a ₹5 lakh sum insured is ₹5,000 per day.", why: "Choosing a costlier room can reduce other payable charges proportionately under some policies." },
  { slug: "sub-limit", term: "Sub-limit", simple: "A cap on what the policy pays for a particular treatment, even if more sum insured is available.", example: "Cataract surgery capped at ₹40,000 per eye.", why: "Anything above the sub-limit is paid by the patient." },
  { slug: "exclusion", term: "Exclusion", simple: "Treatment or conditions the policy does not cover at all.", example: "Cosmetic surgery done for appearance.", why: "Excluded treatment isn't payable regardless of sum insured or network status." },
  { slug: "pre-authorization", term: "Pre-authorization", simple: "Approval requested from the insurer/TPA or scheme before a cashless admission.", example: "The hospital sends diagnosis, reports and a cost estimate before surgery.", why: "Pre-authorization approval is an initial estimate — not the final settlement." },
  { slug: "admissible-amount", term: "Admissible amount", simple: "The part of the bill the payer accepts as payable under the policy.", example: "Of a ₹1.2 lakh bill, ₹1 lakh is admissible after removing non-payable items.", why: "Limits and co-pay are applied to the admissible amount, not the full bill." },
  { slug: "final-settlement", term: "Final settlement", simple: "The actual amount paid after the payer assesses the final bill.", example: "₹95,000 paid to the hospital after the final claim, against a ₹1 lakh pre-authorization.", why: "The final amount can differ from the initial estimate." },
  { slug: "empanelment", term: "Empanelment", simple: "A hospital's approval to treat patients under a government scheme.", example: "A hospital empanelled for cardiology under a state scheme.", why: "Scheme treatment is generally only available at empanelled hospitals, for the specialities they're empanelled for." },
  { slug: "package", term: "Package", simple: "A fixed rate a scheme or payer pays for a defined treatment.", example: "A cataract surgery package covering surgery, lens and stay at a set rate.", why: "Items outside the package are generally not paid by the scheme." },
  { slug: "beneficiary", term: "Beneficiary", simple: "A person entitled to benefits under a government scheme.", example: "A family member listed on the scheme's beneficiary record.", why: "Scheme eligibility is verified with the scheme itself — an insurance card isn't proof." },
];

/** Case-insensitive search over term and explanation; blank returns everything, alphabetically. */
export function searchGlossary(query: string): GlossaryTerm[] {
  const q = query.trim().toLowerCase();
  const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  if (!q) return sorted;
  const hits = sorted.filter((t) => `${t.term} ${t.slug} ${t.simple}`.toLowerCase().includes(q));
  // Term-name matches first.
  return hits.sort((a, b) => Number(!a.term.toLowerCase().includes(q)) - Number(!b.term.toLowerCase().includes(q)));
}
