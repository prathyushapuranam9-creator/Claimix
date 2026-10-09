import { PERMISSIONS, ROLES, type PermissionKey } from "@/lib/permissions/catalog";
import { can, type Principal } from "@/lib/permissions/principal";
import { hasDashboard, visibleNav } from "@/lib/navigation";
import { CLAIM_STATUS_LABEL } from "@/modules/claims/claims.workflow";
import { allowedTransitions, PREAUTH_STATUSES, STATUS_LABEL } from "@/modules/preauth/preauth.workflow";
import { allowedClaimTransitions, CLAIM_STATUSES } from "@/modules/claims/claims.workflow";

/**
 * What the Claimix Insurance Assistant knows about the application. Navigation, roles, permissions and status names
 * are read from the same modules the app itself uses (NAV_ITEMS, ROLES, PERMISSIONS, the workflow label tables), so
 * the answers follow the application. Only the step-by-step wording below is written by hand, and it uses the
 * labels of the real screens.
 */
export interface Who {
  p: Principal;
  roleName: string;
  dashboard: boolean;
  /** Raises pre-auths and claims for a hospital. */
  hospital: boolean;
  /** Reviews pre-auths and claims for an insurer / TPA. */
  payer: boolean;
  admin: boolean;
  can: (k: PermissionKey) => boolean;
}

export function whoIs(p: Principal): Who {
  const role = ROLES.find((r) => r.key === p.roleKey);
  return {
    p,
    roleName: p.acting?.roleName ?? role?.name ?? p.roleKey,
    dashboard: hasDashboard(p),
    hospital: can(p, "preauth:create") || can(p, "claim:create"),
    payer: can(p, "preauth:review") || can(p, "claim:review"),
    admin: p.roleKey === "admin",
    can: (k) => can(p, k),
  };
}

/** A navigation path rendered as a block (see the chat's renderer): each step on its own line. */
export const pathBlock = (...steps: string[]) => "```path\n" + steps.join("\n→ ") + "\n```";

export type Link = { label: string; href: string };

/** Pages that are not in the sidebar, and how a user of this role reaches them from the dashboard. */
export function reach(w: Who, page: "preauth" | "claim" | "eligibility" | "patient" | "coverage" | "insurance_document"): { steps: string[]; href: string; label: string } {
  if (page === "patient") return { label: "Patients", href: "/patients", steps: ["Sidebar", "Patients"] };
  // Coverage and the insurance documents are sections of one patient's page, not screens of their own.
  if (page === "coverage")
    return { label: "Insurance & scheme coverage", href: "/patients", steps: ["Sidebar", "Patients", "Select the patient", "Insurance & scheme coverage", "Add coverage"] };
  if (page === "insurance_document")
    return { label: "Insurance documents", href: "/patients", steps: ["Sidebar", "Patients", "Select the patient", "Insurance documents", "Upload insurance document"] };
  if (page === "eligibility")
    return { label: "Eligibility checker", href: "/eligibility", steps: w.dashboard ? ["Dashboard", "Check eligibility"] : ["Patients", "Select the patient", "Check eligibility beside the coverage"] };
  if (page === "preauth")
    return {
      label: "Pre-authorizations",
      href: "/pre-authorizations",
      steps: !w.dashboard ? ["Pre-authorizations"] : w.hospital ? ["Dashboard", "Pre-authorizations needing action"] : ["Dashboard", "Pre-auths awaiting decision", "View"],
    };
  return {
    label: "Claims",
    href: "/claims",
    steps: !w.dashboard ? ["Claims"] : w.hospital ? ["Dashboard", "Claims needing action"] : ["Dashboard", "Claims awaiting decision", "View"],
  };
}

/** Sidebar entries this user actually sees. */
export function sidebar(w: Who) {
  // The same entries and labels the user's own sidebar shows (e.g. "Insurer/Provider" for insurer reviewers).
  return visibleNav(w.p).filter((i) => !i.hidden && i.href !== "/knowledge" && (i.href !== "/dashboard" || w.dashboard));
}

export const STATUS_HELP: Record<string, { label: string; meaning: string }> = {
  draft: { label: "Draft", meaning: "The request is saved but has not been sent to the payer yet. The hospital can still edit it, upload documents and run checks." },
  submitted: { label: "Submitted", meaning: "The hospital has sent the request and it is waiting for the insurance/payer team to pick it up." },
  "awaiting payer": { label: "Awaiting payer", meaning: "The hospital has submitted the request and it is waiting for the insurance/payer team to review and decide. It covers requests that are Submitted or under review (Under review for pre-authorizations, Under assessment for claims)." },
  "under review": { label: "Under review", meaning: "The payer has started reviewing the pre-authorization (called Under assessment for claims). A decision has not been recorded yet." },
  "under assessment": { label: "Under assessment", meaning: "The payer is assessing the claim. A decision has not been recorded yet." },
  pending: { label: "Under review", meaning: "Internally 'pending' is shown as Under review (pre-authorizations) or Under assessment (claims): the payer is working on it." },
  query: { label: "Query raised", meaning: "The payer needs more information or documents. The hospital answers it on the request (Respond to query), and the payer then reviews again." },
  approved: { label: "Approved", meaning: "The payer approved the request. A pre-authorization that is approved can be followed by a claim after discharge." },
  "partially approved": { label: "Partially approved", meaning: "The payer approved only part of the requested amount." },
  rejected: { label: "Rejected", meaning: "The payer rejected the request and recorded a reason. Claimix only shows a rejection the payer has actually recorded." },
  cancelled: { label: "Cancelled", meaning: "The request was cancelled and is closed." },
  "final approved": { label: "Final approved", meaning: "The payer gave the final approval after discharge, so the claim can be settled." },
  settled: { label: "Settled", meaning: "The insurer has recorded the payment. On the dashboard this is the 'Settled (paid)' card, which opens Claims → Settled." },
  "requires verification": {
    label: "Requires verification",
    meaning:
      "Coverage recorded without the insurance card or policy document to check it against. It does not block anything - eligibility checks, pre-authorizations and claims all work - it only marks the record as still unconfirmed. Upload the insurance document on the patient's page and use Edit on the coverage to confirm the details; the coverage then shows Verified.",
  },
  "coverage verification": {
    label: "Coverage verification",
    meaning:
      "Each recorded coverage shows either Verified (the details were checked against the patient's insurance card or policy document) or Requires verification (recorded without the document). It is a note on the coverage record, not a payer decision, and it blocks nothing.",
  },
  "in force": { label: "In force", meaning: "Today falls inside the recorded cover period, so a pre-authorization or claim can be raised on this coverage." },
  expired: { label: "Expired", meaning: "The recorded cover period has ended. Eligibility can still be checked, but a pre-authorization cannot be raised on it - record the cover the patient is insured under today." },
  "not started": { label: "Not started", meaning: "The recorded cover period begins in the future, so a pre-authorization cannot be raised on it yet." },
  decided: { label: "Decided", meaning: "'Decided' is a tab on Pre-authorizations, not a status. It lists requests the payer has decided: Approved, Partially approved, Final approved, Rejected and Settled." },
};

/** The names of the statuses that really exist, for the model's prompt. */
export const STATUS_NAMES = {
  preauth: Object.values(STATUS_LABEL),
  claim: Object.values(CLAIM_STATUS_LABEL),
};

export const OUT_OF_SCOPE = "I can help only with the Claimix application, its workflows, navigation, statuses, records, and available actions.";

export const NOT_SURE = "I don't have enough information to confirm that feature in the current Claimix application.";

export const QUICK_PROMPTS = (w: Who): string[] => {
  if (w.payer)
    return ["How do I review a pre-authorization?", "Where are the pre-authorizations awaiting decision?", "How do I raise a query?", "Where can I find reports?", "Explain my dashboard", "What should I do next?"];
  if (w.hospital)
    return [
      "I registered a new patient. What do I do next?",
      "Where do I add coverage?",
      "Do I have to upload the insurance card?",
      "How do I check eligibility?",
      "How do I create a pre-authorization?",
      "Where can I find my claims?",
      "How do I upload documents?",
      "Explain my dashboard",
    ];
  return ["What can I do in Claimix?", "Where can I find reports?", "Where can I find policies?", "Explain my dashboard"];
};

/** Plain-text knowledge for the language model, built for this user. */
export function knowledgeText(w: Who): string {
  const nl = String.fromCharCode(10);
  const lines: string[] = [];
  const org = w.p.acting ? `Testing context: ${w.p.acting.organizationName}, role ${w.p.acting.roleName}` : `Role: ${w.roleName}`;
  lines.push(`CURRENT USER: ${org} (organization type: ${w.p.orgType}).`);
  lines.push(`This user can: ${[...w.p.permissions.keys()].map((k) => PERMISSIONS[k] ?? k).join("; ")}.`);
  lines.push(`SIDEBAR (exact labels): ${sidebar(w).map((i) => i.label).join(", ")}.`);
  const pa = reach(w, "preauth");
  const cl = reach(w, "claim");
  lines.push(`Pre-authorizations is not in the sidebar. Path: ${pa.steps.join(" → ")}. Tabs: Open, Needs action, Awaiting payer, Approved, Decided, All.`);
  lines.push(`Claims is not in the sidebar. Path: ${cl.steps.join(" → ")}. Tabs: Open, Needs action, Under assessment, Approved, Rejected, Settled, All.`);
  lines.push(`Eligibility checker path: ${reach(w, "eligibility").steps.join(" → ")}.`);
  lines.push(`Pre-authorization statuses: ${STATUS_NAMES.preauth.join(", ")}. Claim statuses: ${STATUS_NAMES.claim.join(", ")}. 'Awaiting payer' and 'Decided' are list tabs, not statuses.`);
  lines.push(
    "HOSPITAL STAFF WORKFLOW (front-desk registration only): Sidebar -> Patients -> Register patient, then three steps - (1) Identify & details: search by name, patient number or mobile and select the existing patient, or register a new one with 'Register New ABHA' (ABHA number and address are recorded as presented, not verified or created) or 'Register Without ABHA ID' (no ABHA needed), and choose the visit type (OPD consultation; IP admission, which opens an inpatient stay with ward, bed and expected stay and ends with Record discharge; or Pre-auth, a planned treatment the payer is asked to approve before admission - recorded as a visit, while sending it to the payer is an insurance-side action); (2) Doctor & slot: department, doctor, then the doctor's consultation fee is shown (it is configured, never typed), booking date, available slot; (3) Payment & register: the summary, payment (Cash; UPI with a demo QR area; Card with a demo form that keeps only the last four digits; or collect later - no gateway settles anything in this build), the Patient Rights & Responsibilities acknowledgement, then Register patient. The patient is registered only when that last step completes. Hospital Staff hold no insurance capability at all: coverage, eligibility, pre-authorizations, claims, their documents, the case reports and this assistant are not available to that role.",
  );
  lines.push(
    "RECORDING COVERAGE - TWO WAYS, BOTH ON THE PATIENT'S PAGE. The insurance document is NEVER required to save coverage. (A) With the document: Insurance documents card → choose the document type (Insurance / health card, Policy copy / member ID, Scheme beneficiary ID / enrolment, Other insurance document) → choose the File → Upload insurance document → 'Review extracted details' on that document → the Add coverage form opens pre-filled with what could be read and the message 'Details extracted from the uploaded document. Please verify before saving.' → every value can be edited, anything the document did not state is listed as still to enter → Save coverage. (B) Without the document: Insurance & scheme coverage → Add coverage manually → fill Policy / scheme, Member / beneficiary ID, Policy number, Policyholder, Relationship to policyholder, First inception date, Cover start, Cover end, Sum insured, Available balance and Verification (Policy number and Policyholder are optional - leave Policyholder blank when the patient holds the policy) → Save coverage. Verification has two values: 'Verified against the insurance document' and 'Requires verification'; 'Requires verification' is a note on the record and blocks nothing. The document can be uploaded later and the coverage confirmed with Edit beside it.",
  );
  lines.push(
    "DOCUMENTS - TWO SEPARATE STAGES. Insurance / coverage documents (insurance card, policy copy, scheme enrolment) belong to the PATIENT and live in the 'Insurance documents' card on the patient's page; they establish or confirm the cover. Treatment / supporting documents (treatment estimate, clinical notes, investigation reports, medical reports, signed pre-authorization form, and after discharge the final bill and discharge summary) belong to ONE pre-authorization or claim and live in the 'Treatment & supporting documents' card on that request. They are never mixed: uploading an insurance card on a patient does not attach it to a request, and a request's documents do not change the recorded coverage.",
  );
  lines.push(
    "COVER PERIOD RULE: a pre-authorization can only be raised on coverage whose cover period includes today (shown as 'In force'). On expired or not-yet-started cover Claimix refuses it and offers 'Review / edit coverage', 'Open patient' and 'Add another coverage' instead. Eligibility can still be checked on such coverage, and reimbursement claims are judged on the admission date.",
  );
  lines.push(
    "PAYER REVIEWER WORKFLOW: Dashboard → Pre-auths awaiting decision → View → open the request → review Patient & policy, Case details, Medical & financial, Documents (Record verification) and the checklist → in the Decision card choose Mark as under review, Raise a query, Approve, Partially approve or Reject. Claims work the same way and the insurer records settlement. A payer only sees requests addressed to their own insurer or TPA.",
  );
  lines.push("INSURER ISOLATION: an insurer/TPA user only sees their own organization's requests. A designated testing account can switch insurer and role on the Dashboard (Insurance portal testing → Insurance Company + Role → Switch Context) and then sees that insurer's data; a banner shows the active context and Exit returns to the real account.");
  lines.push(workflowText());
  lines.push(
    "PATIENT PAGE SECTIONS (exact card titles): Insurance workflow (the step tracker: Patient registered, Insurance document, Coverage recorded, Eligibility checked, Pre-authorization / claim), Details, Eligibility Result (opens from the 'Eligibility Check' button in the page header), Insurance documents, Insurance & scheme coverage (with Check eligibility and Edit beside each coverage), Treatment request, Policy check, Add coverage. Registering a patient never creates coverage.",
  );
  lines.push(
    "DUPLICATE PATIENTS: Register patient warns 'This patient may already be registered' when the same name and date of birth exist at this hospital, links the existing patient number, and offers 'Register as a new patient anyway'. An existing patient is reused for new visits, new coverage, new pre-authorizations and new claims - that is not the same thing as an existing pre-authorization.",
  );
  lines.push("DASHBOARD (hospital): cards Awaiting payer → Pre-authorizations → Awaiting payer tab; Pre-auths approved → Pre-authorizations → Approved tab; Settled (paid) → Claims → Settled tab. Drafts and Queries to answer are information only.");
  return lines.join(nl);
}

/** The real status machines, who may make each change, written out for the model. Generated from the workflow definitions. */
export function workflowText(): string {
  const NL = String.fromCharCode(10);
  const side = (s: "hospital" | "payer", from: string, claim: boolean) =>
    claim
      ? allowedClaimTransitions(from as never, s).map((t) => CLAIM_STATUS_LABEL[t])
      : allowedTransitions(from as never, s).map((t) => STATUS_LABEL[t]);
  const rows = (claim: boolean) =>
    (claim ? CLAIM_STATUSES : PREAUTH_STATUSES)
      .map((st) => {
        const label = claim ? CLAIM_STATUS_LABEL[st as keyof typeof CLAIM_STATUS_LABEL] : STATUS_LABEL[st as keyof typeof STATUS_LABEL];
        const h = side("hospital", st, claim);
        const p = side("payer", st, claim);
        return `- ${label}: hospital can move it to ${h.join(", ") || "nothing"}; payer can move it to ${p.join(", ") || "nothing"}.`;
      })
      .join(NL);
  return [`PRE-AUTHORIZATION STATUS CHANGES (from the application's workflow):`, rows(false), `CLAIM STATUS CHANGES:`, rows(true)].join(NL);
}
