/**
 * Knowledge Center (spec §23). Plain-language, general guidance with examples.
 * It never states a specific insurer's or regulator's terms; policy wording and
 * payer decisions always take precedence.
 */
export interface Article {
  slug: string;
  title: string;
  summary: string;
  sections: { heading: string; body: string[] }[];
  example?: string;
  related?: string[];
}

export const ARTICLES: Article[] = [
  {
    slug: "what-is-health-insurance",
    title: "What is health insurance?",
    summary: "A contract that pays for covered treatment, on the policy's conditions, up to its limits.",
    sections: [
      { heading: "How it works", body: ["You pay a premium; the insurer agrees to pay for covered hospital treatment during the policy period.", "What is covered, and how much, is set by the policy wording: sum insured, waiting periods, exclusions, limits, co-pay and deductibles."] },
      { heading: "What it doesn't mean", body: ["Having a policy or an insurance card does not mean the whole hospital bill will be paid.", "Every claim is assessed by the insurer or TPA against the policy."] },
    ],
    example: "A ₹5 lakh policy won't pay for a treatment that is excluded, or for the part of a bill above a sub-limit.",
    related: ["sum-insured", "exclusion", "claim"],
  },
  {
    slug: "how-cashless-works",
    title: "How cashless insurance works",
    summary: "The insurer pays a network hospital directly — after approving a pre-authorization.",
    sections: [
      { heading: "The steps", body: ["Check the hospital is in the payer's network.", "The hospital's insurance desk sends a pre-authorization with diagnosis, reports and a cost estimate.", "The payer approves, partially approves, queries or rejects it.", "After discharge, the hospital sends the final bill and documents for final settlement."] },
      { heading: "What the patient may still pay", body: ["Co-pay, deductibles, non-payable items, amounts above room-rent or sub-limits, and anything beyond the available sum insured."] },
    ],
    example: "An approved ₹80,000 pre-authorization for a ₹90,000 bill leaves ₹10,000 for the patient, plus any items the final assessment disallows.",
    related: ["cashless", "pre-authorization", "network-hospital"],
  },
  {
    slug: "how-reimbursement-works",
    title: "How reimbursement works",
    summary: "Pay the hospital first, then claim the admissible amount back.",
    sections: [
      { heading: "The steps", body: ["Pay the hospital and collect all original bills, reports, prescriptions and the discharge summary.", "Submit the claim to the insurer or TPA within the policy's deadline.", "The payer assesses what is admissible and pays it to the policyholder."] },
      { heading: "Tips", body: ["Keep originals and itemised bills — summary bills often cause queries.", "Inform the insurer of the admission as the policy requires."] },
    ],
    example: "Treatment at a non-network hospital is often claimed by reimbursement, if the policy allows it.",
    related: ["reimbursement", "admissible-amount"],
  },
  {
    slug: "what-is-a-tpa",
    title: "What is a TPA?",
    summary: "A Third-Party Administrator processes cashless requests and claims for the insurer.",
    sections: [
      { heading: "What a TPA does", body: ["Receives pre-authorizations and claims, checks documents, raises queries, and records decisions on the insurer's behalf."] },
      { heading: "What a TPA doesn't do", body: ["It doesn't change the policy terms. The insurer's policy wording still applies."] },
    ],
    related: ["tpa", "insurer"],
  },
  {
    slug: "what-is-ped",
    title: "What is a pre-existing disease (PED)?",
    summary: "A condition you had before the policy started — covered, if declared, usually only after a waiting period.",
    sections: [
      { heading: "Why it matters", body: ["Most policies cover declared PEDs only after a PED waiting period of continuous cover.", "A condition that existed but wasn't declared on the proposal can lead to rejection."] },
      { heading: "What the hospital checks", body: ["Whether a PED was declared, and whether the current treatment is related to it."] },
    ],
    example: "Heart treatment for a patient with a declared heart condition, one year into a policy with a three-year PED waiting period, is usually not payable.",
    related: ["ped", "waiting-period"],
  },
  {
    slug: "what-is-waiting-period",
    title: "What is a waiting period?",
    summary: "Time after the policy starts during which some claims aren't payable.",
    sections: [
      { heading: "Types", body: ["Initial waiting period (often a few weeks, commonly excluding accidents).", "Specific-illness waiting periods for named conditions or procedures.", "PED waiting period for declared pre-existing diseases."] },
      { heading: "Continuity", body: ["Waiting periods run from the first inception with continuous renewals. A break in cover can restart them."] },
    ],
    related: ["waiting-period", "ped"],
  },
  {
    slug: "what-is-co-pay",
    title: "What is co-pay?",
    summary: "A share of each admissible claim that the patient pays.",
    sections: [{ heading: "How it works", body: ["Co-pay is a percentage of the admissible amount, applied even when the claim is approved.", "Some policies apply it only above a certain age or in certain cases."] }],
    example: "20% co-pay on an admissible ₹50,000 means the patient pays ₹10,000.",
    related: ["co-pay", "admissible-amount"],
  },
  {
    slug: "what-is-deductible",
    title: "What is a deductible?",
    summary: "The amount borne before the policy pays — common in top-up and super top-up policies.",
    sections: [{ heading: "How it works", body: ["Admissible costs up to the deductible are paid by the patient or another policy; the policy pays above it, up to its sum insured."] }],
    example: "A ₹3 lakh deductible on a ₹4.5 lakh admissible claim leaves ₹1.5 lakh payable by the top-up.",
    related: ["deductible", "sum-insured"],
  },
  {
    slug: "what-is-sub-limit",
    title: "What is a sub-limit?",
    summary: "A cap for a particular treatment, even if more sum insured is available.",
    sections: [{ heading: "Why it matters", body: ["The amount above the sub-limit is paid by the patient. Check sub-limits before agreeing a treatment estimate."] }],
    example: "A ₹40,000 cataract sub-limit on a ₹60,000 bill leaves ₹20,000 for the patient.",
    related: ["sub-limit"],
  },
  {
    slug: "what-is-room-rent-limit",
    title: "What is a room rent limit?",
    summary: "The maximum room charge per day the policy pays for.",
    sections: [{ heading: "Proportionate deduction", body: ["Under some policies, a room above the limit reduces other payable charges in proportion — not just the room rent.", "Choosing an eligible room category avoids this."] }],
    example: "With a ₹5,000/day limit, choosing a ₹8,000/day room can reduce several other charges proportionately.",
    related: ["room-rent-limit"],
  },
  {
    slug: "what-is-pre-authorization",
    title: "What is pre-authorization?",
    summary: "Approval requested before a cashless admission — an estimate, not the final payment.",
    sections: [
      { heading: "What to send", body: ["Patient and policy details, diagnosis, clinical notes and reports, proposed treatment, and a cost estimate."] },
      { heading: "Possible outcomes", body: ["Approved, partially approved, query (more information needed), pending, or rejected."] },
    ],
    related: ["pre-authorization", "final-settlement"],
  },
  {
    slug: "why-claims-get-rejected",
    title: "Why claims get rejected",
    summary: "Most rejections trace back to cover, eligibility, exclusions, waiting periods or documents.",
    sections: [
      { heading: "Common reasons", body: ["Policy inactive, patient not covered, hospital not eligible, treatment not covered, waiting period or PED, exclusion, insufficient sum insured, missing or mismatched documents."] },
      { heading: "Only the payer rejects", body: ["A claim is rejected only when the payer's recorded decision says so. Failed checks in advance are warnings, not rejections."] },
    ],
    related: ["claim", "exclusion"],
  },
  {
    slug: "how-to-reduce-claim-queries",
    title: "How to reduce claim queries",
    summary: "Complete, consistent, legible documents are the biggest factor.",
    sections: [{ heading: "Checklist", body: ["Match name, date of birth and member ID across the ID, card and hospital records.", "Send detailed clinical notes and reports supporting the diagnosis.", "Use itemised bills; explain non-payable items to the patient.", "Check waiting periods, PED, exclusions and limits before submitting."] }],
    related: ["member-id", "pre-authorization"],
  },
  {
    slug: "documents-hospitals-need",
    title: "Documents hospitals need",
    summary: "What is typically asked for at pre-authorization and at the final claim.",
    sections: [
      { heading: "Pre-authorization", body: ["Photo ID, insurance or scheme card, doctor's consultation notes, investigation reports and a treatment cost estimate."] },
      { heading: "Final claim", body: ["Final itemised bill, discharge summary, investigation reports, pharmacy bills, and — where applicable — operation notes and implant invoices."] },
      { heading: "Always check", body: ["Each policy or scheme can require different documents. The payer may ask for more."] },
    ],
    related: ["pre-authorization", "claim"],
  },
  {
    slug: "pre-auth-vs-final-settlement",
    title: "Pre-authorization vs final settlement",
    summary: "The pre-auth is an estimate before treatment; settlement is what's actually paid after the final bill.",
    sections: [{ heading: "Why they differ", body: ["The actual treatment, stay and bill can differ from the estimate.", "The final assessment removes non-payable items and applies limits and co-pay."] }],
    example: "₹1 lakh pre-authorized; final admissible amount ₹92,000 after non-payable items.",
    related: ["pre-authorization", "final-settlement"],
  },
  {
    slug: "private-insurance-vs-government-schemes",
    title: "Private insurance vs government schemes",
    summary: "Different eligibility, different rules, different processes — they are checked separately.",
    sections: [
      { heading: "Private insurance", body: ["Bought from an insurer; terms set by the policy wording; cashless at network hospitals or reimbursement."] },
      { heading: "Government schemes", body: ["Eligibility decided by the scheme's own beneficiary records; treatment at empanelled hospitals, often as fixed packages."] },
      { heading: "ABDM / ABHA", body: ["The Ayushman Bharat Digital Mission and ABHA numbers are digital-health infrastructure for health records and identity. They are not an insurance scheme and don't provide cover by themselves."] },
    ],
    related: ["empanelment", "package", "beneficiary"],
  },
];

export function article(slug: string) {
  return ARTICLES.find((a) => a.slug === slug);
}
