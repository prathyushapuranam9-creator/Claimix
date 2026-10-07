import { PERMISSIONS, ROLES, type PermissionKey } from "@/lib/permissions/catalog";
import { can, type Principal } from "@/lib/permissions/principal";
import { hasDashboard, visibleNav } from "@/lib/navigation";
import { CLAIM_STATUS_LABEL } from "@/modules/claims/claims.workflow";
import { STATUS_LABEL } from "@/modules/preauth/preauth.workflow";

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
export function reach(w: Who, page: "preauth" | "claim" | "eligibility"): { steps: string[]; href: string; label: string } {
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
  decided: { label: "Decided", meaning: "'Decided' is a tab on Pre-authorizations, not a status. It lists requests the payer has decided: Approved, Partially approved, Final approved, Rejected and Settled." },
};

/** The names of the statuses that really exist, for the model's prompt. */
export const STATUS_NAMES = {
  preauth: Object.values(STATUS_LABEL),
  claim: Object.values(CLAIM_STATUS_LABEL),
};

export const OUT_OF_SCOPE =
  "I'm the Claimix Insurance Assistant. I can only help with the Claimix application, its features, workflows, navigation, and insurance-related actions available in Claimix.";

export const NOT_SURE = "I don't have enough information to confirm that feature in the current Claimix application.";

export const QUICK_PROMPTS = (w: Who): string[] => {
  if (w.payer)
    return ["How do I review a pre-authorization?", "Where are the pre-authorizations awaiting decision?", "How do I raise a query?", "Where can I find reports?", "Explain my dashboard", "What should I do next?"];
  if (w.hospital)
    return ["How do I create a pre-authorization?", "Where can I find my claims?", "Check my pre-auth status", "How do I upload documents?", "Where can I find policies?", "How do I check eligibility?", "Explain my dashboard", "What should I do next?"];
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
    "HOSPITAL STAFF WORKFLOW: Patients → Register patient; open the patient and use Add coverage; Check eligibility; New pre-authorization (steps Medical, Financial, Clinical notes, then Create draft); on the request upload documents (Document type, File, Upload), Run checks, Confirm each checklist item, Submit Pre-Authorization; it becomes Submitted and waits for the payer; the payer approves, rejects or raises a query; the hospital answers a query with Respond to query → Send response; after discharge a claim is raised with New claim (cashless claims start from an approved pre-authorization; reimbursement claims from the patient's coverage); the insurer records settlement (Record settlement).",
  );
  lines.push(
    "PAYER REVIEWER WORKFLOW: Dashboard → Pre-auths awaiting decision → View → open the request → review Patient & policy, Case details, Medical & financial, Documents (Record verification) and the checklist → in the Decision card choose Mark as under review, Raise a query, Approve, Partially approve or Reject. Claims work the same way and the insurer records settlement. A payer only sees requests addressed to their own insurer or TPA.",
  );
  lines.push("INSURER ISOLATION: an insurer/TPA user only sees their own organization's requests. A designated testing account can switch insurer and role on the Dashboard (Insurance portal testing → Insurance Company + Role → Switch Context) and then sees that insurer's data; a banner shows the active context and Exit returns to the real account.");
  lines.push("DASHBOARD (hospital): cards Awaiting payer → Pre-authorizations → Awaiting payer tab; Pre-auths approved → Pre-authorizations → Approved tab; Settled (paid) → Claims → Settled tab. Drafts and Queries to answer are information only.");
  return lines.join(nl);
}
