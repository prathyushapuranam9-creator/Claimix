import "server-only";
import { ROLES } from "@/lib/permissions/catalog";
import { completeWithOpenRouter, llmEnabled } from "./llm";
import { knowledgeText, NOT_SURE, OUT_OF_SCOPE, pathBlock, reach, STATUS_HELP, whoIs, type Link, type Who } from "./knowledge";
import type { Principal } from "@/lib/permissions/principal";

/**
 * The Claimix application guide: answers questions about the application itself (where things are, what they mean,
 * what a role may do). It is not a general chatbot — out-of-scope questions get one fixed reply and are never sent
 * to the model. Navigation, status and role answers are produced here from the application's own definitions, so
 * they stay correct without a model; the model (OpenRouter, server-side) is used for other in-scope questions and is
 * given the same knowledge and told not to invent anything.
 */
export interface GuideReply {
  markdown: string;
  links: Link[];
  source: "guide" | "model" | "scope";
  /** Why the model was not used, when it was expected to be. */
  notice: string | null;
}

export type Turn = { role: "user" | "assistant"; content: string };

const CLAIMIX_TERMS = /\b(claimix|pre-?auth\w*|claims?|patients?|policy|policies|insur\w*|payer|tpa|eligib\w*|documents?|reports?|dashboard|hospital|assistant|status|quer(?:y|ies)|approv\w*|reject\w*|settle\w*|schemes?|roles?|permissions?|log ?in|sign ?in|reviewers?|staff|admin\w*|navigat\w*|screens?|pages?|menu|sidebar|buttons?|workflow|upload\w*|notifications?|profile|audit|cover(?:age)?|reimburse\w*|cashless|discharge|admission|aarogya|navjeevan|suraksha|context|submitted|draft|awaiting|decision|checklist|rejection|users?)\b/i;
const STRONG_TERMS = /\b(claimix|pre-?auth\w*|claims?|patients?|policy|policies|insur\w*|payer|eligib\w*|hospital)\b/i;
const ALWAYS_OFF_TOPIC = /\b(python|javascript|typescript|java|c\+\+|golang|rust|sql query|html|css|write (?:me )?(?:an? )?(?:code|program|script|function)|(?:write|draft|compose)\b.{0,40}\b(?:email|letter|essay|poem|story|song|speech)|recipe|weather|joke|poem|capital of|prime minister|president of|who is (?:elon|the )|stock price|bitcoin|crypto|movie|cricket score|horoscope|translate)\b/i;

const NAV_WORDS = /\b(where|find|locate|open|go to|get to|navigate|access|see|show|reach|located|can'?t find|cannot find|don'?t see|do not see|not visible|missing)\b/i;

export function isOutOfScope(q: string, hasHistory: boolean): boolean {
  if (ALWAYS_OFF_TOPIC.test(q) && !STRONG_TERMS.test(q)) return true;
  if (/\b(write|draft|compose)\b.{0,40}\b(email|letter|essay|poem|story|code|program|script)\b/i.test(q)) return true;
  if (CLAIMIX_TERMS.test(q)) return false;
  // Short follow-ups ("what next?", "and then?") only make sense inside an existing Claimix conversation.
  return !(hasHistory && q.trim().split(/\s+/).length <= 6);
}

const scope = (): GuideReply => ({ markdown: OUT_OF_SCOPE, links: [], source: "scope", notice: null });
const guide = (markdown: string, links: Link[] = []): GuideReply => ({ markdown, links, source: "guide", notice: null });

function featureAnswer(f: { label: string; steps: string[]; href: string; what: string; note?: string }): GuideReply {
  const lines = [`**${f.label}** — ${f.what}`, "", "Path:", pathBlock(...f.steps)];
  if (f.note) lines.push(f.note);
  return guide(lines.join("\n"), [{ label: `Open ${f.label}`, href: f.href }]);
}

type Feature = { re: RegExp; label: string; what: string; href: string; permission: Parameters<Who["can"]>[0]; steps?: (w: Who) => string[]; note?: (w: Who) => string };

const side = (label: string) => ["Sidebar", label];

const FEATURES: Feature[] = [
  { re: /\bpre-?auth\w*|authori[sz]ations?\b/i, label: "Pre-authorizations", what: "cashless requests raised by hospitals and decided by the payer.", href: "/pre-authorizations", permission: "preauth:read", steps: (w) => reach(w, "preauth").steps, note: () => "It is not a sidebar item. Use the tabs Open, Needs action, Awaiting payer, Approved, Decided or All, then select the pre-authorization." },
  { re: /\bclaims?\b/i, label: "Claims", what: "claims raised after treatment and assessed by the payer.", href: "/claims", permission: "claim:read", steps: (w) => reach(w, "claim").steps, note: () => "It is not a sidebar item. Use the tabs Open, Needs action, Under assessment, Approved, Rejected, Settled or All." },
  { re: /\beligib\w*/i, label: "Eligibility checker", what: "checks a patient's case against the selected policy's published rules.", href: "/eligibility", permission: "eligibility:check", steps: (w) => reach(w, "eligibility").steps, note: (w) => (w.hospital ? "You can also use the Check eligibility button on the dashboard." : "") },
  { re: /\bpolic(?:y|ies)\b/i, label: "Policies", what: "insurance products and their rules.", href: "/policies", permission: "policy:read", steps: () => side("Policies") },
  { re: /\breports?\b/i, label: "Reports", what: "case and turnaround-time reports for your organization.", href: "/reports", permission: "report:view", steps: () => side("Reports") },
  { re: /\bpatients?\b/i, label: "Patients", what: "registered patients and their coverage.", href: "/patients", permission: "patient:read", steps: () => side("Patients") },
  { re: /\bdocuments?\b/i, label: "Documents", what: "uploaded documents and requests that are still missing mandatory documents.", href: "/documents", permission: "document:read", steps: () => side("Documents") },
  { re: /\bnotifications?\b/i, label: "Notifications", what: "your inbox of updates.", href: "/notifications", permission: "notification:read", steps: () => ["Header", "Notifications"], note: () => "It is not a sidebar item; open it from the notifications control in the page header." },
  { re: /\bschemes?\b/i, label: "Government schemes", what: "government health schemes.", href: "/schemes", permission: "policy:read", steps: () => side("Government schemes") },
  { re: /\b(?:rejection|query) reasons?\b/i, label: "Query & rejection reasons", what: "the standard reasons payers use when raising a query or rejecting.", href: "/rejection-reasons", permission: "policy:read", steps: () => side("Query & rejection reasons") },
  { re: /\bhospitals?\b|\bnetwork\b/i, label: "Hospitals & network", what: "hospitals and network status.", href: "/hospitals", permission: "hospital:read", steps: () => side("Hospitals & network") },
  { re: /\binsurance compan\w+|\binsurers\b/i, label: "Insurance companies", what: "insurers on the platform.", href: "/insurers", permission: "insurer:read", steps: () => side("Insurance companies") },
  { re: /\btpas?\b/i, label: "TPAs", what: "third-party administrators.", href: "/tpas", permission: "insurer:read", steps: () => side("TPAs") },
  { re: /\bassistant\b/i, label: "Insurance Assistant", what: "this assistant.", href: "/assistant", permission: "assistant:use", steps: () => side("Insurance Assistant") },
  { re: /\baudit\b/i, label: "Audit log", what: "the record of actions taken in Claimix.", href: "/audit", permission: "audit:read", steps: () => side("Audit log") },
  { re: /\busers\b|\bmanage users\b/i, label: "Users", what: "user administration.", href: "/admin/users", permission: "user:manage", steps: () => ["Sidebar", "Administration", "Users"] },
  { re: /\bprofile\b/i, label: "Profile Settings", what: "your own details.", href: "/profile", permission: "dashboard:view", steps: () => ["Header", "Profile Settings"], note: () => "It opens from your account control in the page header." },
];

const featureReply = (w: Who, f: Feature): GuideReply => {
  if (!w.can(f.permission)) {
    return guide(`**${f.label}** is not available to your role (${w.roleName}), so it will not appear for you. If you need it, ask an administrator of your organization.`);
  }
  return featureAnswer({ label: f.label, what: f.what, href: f.href, steps: f.steps?.(w) ?? [], note: f.note?.(w) });
};

function statusReply(q: string): GuideReply | null {
  const text = q.toLowerCase();
  const keys = Object.keys(STATUS_HELP).sort((a, b) => b.length - a.length);
  const key = keys.find((k) => new RegExp(`\\b${k.replace(" ", "[ -]")}\\b`).test(text));
  if (!key || !/\b(mean|means|meaning|what is|what's|what does|explain|status|why)\b/.test(text)) return null;
  const s = STATUS_HELP[key]!;
  return guide(`**${s.label}** — ${s.meaning}`);
}

function createPreauth(w: Who): GuideReply {
  if (!w.can("preauth:create")) {
    return guide(`Pre-authorizations are created by hospital staff. Your role (${w.roleName}) cannot create them${w.payer ? "; as a payer you review and decide the ones hospitals submit" : ""}.`, w.can("preauth:read") ? [{ label: "Open Pre-authorizations", href: "/pre-authorizations" }] : []);
  }
  return guide(
    [
      "Path:",
      pathBlock("Dashboard", "New pre-authorization"),
      "",
      "1. Make sure the patient is registered (**Patients → Register patient**) and has coverage (open the patient → **Add coverage**).",
      "2. Optionally run **Check eligibility** first.",
      "3. Choose **New pre-authorization**, pick the patient's coverage and fill the three steps: **Medical**, **Financial**, **Clinical notes**. Select **Create draft**.",
      "4. On the request, upload the required documents in the **Documents** card (Document type → File → **Upload**).",
      "5. Select **Run checks**, then **Confirm** each checklist item that needs your confirmation.",
      "6. Select **Submit Pre-Authorization**. The status becomes **Submitted** and the request waits for the payer.",
    ].join("\n"),
    [{ label: "New pre-authorization", href: "/pre-authorizations/new" }],
  );
}

function createClaim(w: Who): GuideReply {
  if (!w.can("claim:create")) return guide(`Claims are raised by hospital staff. Your role (${w.roleName}) cannot create them.`);
  return guide(
    [
      "Path:",
      pathBlock("Dashboard", "New claim"),
      "",
      "1. **Cashless:** choose an approved pre-authorization that is waiting for a claim. **Reimbursement:** choose the patient's coverage.",
      "2. Enter the treatment and claim details and save.",
      "3. Upload the documents the claim needs, then submit.",
      "4. The claim goes to **Under assessment** until the payer records a decision (Approved, Partially approved, Rejected or a Query). The insurer records **Settled** when it pays.",
    ].join("\n"),
    [{ label: "New claim", href: "/claims/new" }],
  );
}

function uploadDocs(w: Who): GuideReply {
  if (!w.can("document:upload")) {
    return guide(`Uploading documents is done by hospital staff. Your role (${w.roleName}) can ${w.can("document:read") ? "view documents" : "not upload documents"}${w.can("document:verify") ? " and record verification of them" : ""}.`);
  }
  return guide(
    ["Path:", pathBlock(...reach(w, "preauth").steps, "Select the pre-authorization", "Documents"), "", "1. In the **Documents** card choose the **Document type**.", "2. Choose the **File** (PDF) and select **Upload**.", "3. Repeat for each required document. Requests that still miss mandatory documents are also listed under **Sidebar → Documents**.", "", "Claims work the same way on the claim's page."].join("\n"),
    [{ label: "Open Documents", href: "/documents" }],
  );
}

function decisionReply(w: Who, q: string): GuideReply {
  const verb = /reject|decline/i.test(q) ? "reject" : /quer/i.test(q) ? "raise a query on" : "approve";
  if (w.can("preauth:review") || w.can("claim:review")) {
    return guide(
      [
        `You can ${verb} requests addressed to your organization.`,
        "",
        "Path:",
        pathBlock(...reach(w, "preauth").steps, "Select the pre-authorization", "Decision"),
        "",
        "1. Review **Patient & policy**, **Case details**, **Medical & financial** and **Documents** (use **Record verification** for each document).",
        "2. In the **Decision** card choose **Approve**, **Partially approve**, **Reject**, **Raise a query** or **Mark as under review**, add the reason or amount asked for, and submit.",
        "",
        "Rejections and queries need a reason. If the Decision card is missing, the request is not in a state you can decide yet (for example it is still a Draft).",
      ].join("\n"),
    );
  }
  return guide(
    `Approving, rejecting or raising a query on a request is a payer/insurer-side action. Your role (${w.roleName}) cannot do it${w.hospital ? ". As Hospital Staff you submit the request and answer any query; a Payer Reviewer must review it and make the decision" : ""}.`,
  );
}

function missingSubmitted(w: Who): GuideReply {
  const pa = reach(w, "preauth");
  const insurerNote = w.p.acting
    ? `You are testing as **${w.p.acting.organizationName}** (${w.p.acting.roleName}); requests addressed to another insurer will not appear. Change it under Dashboard → Insurance portal testing → **Switch Context**.`
    : w.payer
      ? "You only see requests addressed to your own insurer or TPA. A request for a different insurer will not appear."
      : "A hospital only sees its own hospital's requests.";
  return guide(
    [
      "Check these in order:",
      "",
      "1. Open the list:",
      pathBlock(...pa.steps),
      "2. Select the **All** tab. The default tab (**Open**) hides decided requests, and **Awaiting payer** shows only Submitted or Under review ones.",
      "3. A **Draft** is not sent yet. Open it and select **Submit Pre-Authorization**.",
      `4. ${insurerNote}`,
      "5. If the status is **Query raised**, look under the **Needs action** tab.",
    ].join("\n"),
    [{ label: "Open Pre-authorizations", href: "/pre-authorizations?view=all" }],
  );
}

function contextReply(w: Who): GuideReply {
  if (w.p.acting) {
    return guide(
      [
        `You are testing as **${w.p.acting.organizationName}** with the role **${w.p.acting.roleName}**. You see only that insurer's requests, with that role's permissions.`,
        "",
        "To see another insurer's requests, switch context:",
        pathBlock("Dashboard", "Insurance portal testing", "Choose Insurance Company and Role", "Switch Context"),
        "Use **Exit** in the banner to return to your own account.",
      ].join("\n"),
      [{ label: "Open Dashboard", href: "/dashboard#context" }],
    );
  }
  if (w.payer) {
    return guide(
      "Each insurer or TPA only sees requests addressed to its own organization; for example a Payer Reviewer for Aarogya Shield does not see Navjeevan's requests. Only designated testing accounts get the **Insurance portal testing** selector (Insurance Company + Role → **Switch Context**) on the Dashboard. If you don't see it, your account is not one of them.",
    );
  }
  return guide("Insurer data is isolated: an insurer or TPA user sees only their own organization's requests. The testing context switcher exists only for designated insurance-portal testing accounts, not for hospital staff.");
}

function roleReply(w: Who, q: string): GuideReply {
  const named = ROLES.find((r) => q.toLowerCase().includes(r.name.toLowerCase()) || (r.key === "payer_reviewer" && /payer|insurer reviewer|reviewer/i.test(q)) || (r.key === "hospital_staff" && /hospital staff|staff/i.test(q)));
  const r = named ?? ROLES.find((x) => x.key === w.p.roleKey);
  if (!r) return guide(NOT_SURE);
  return guide(`**${r.name}** — ${r.description}${named && named.key !== w.p.roleKey ? "" : `\n\nYou are signed in as **${w.roleName}**.`}`);
}

function dashboardReply(w: Who): GuideReply {
  if (!w.dashboard) return guide(`Your role (${w.roleName}) has no dashboard; you start on ${w.p.patientId ? "Patients" : "Hospitals & network"}.`);
  if (w.hospital) {
    return guide(
      [
        "The Hospital Staff dashboard has these shortcuts:",
        "",
        "- **Check eligibility**, **New pre-authorization** and **New claim** buttons.",
        "- **Awaiting payer** card → Pre-authorizations → **Awaiting payer** tab.",
        "- **Pre-auths approved** card → Pre-authorizations → **Approved** tab (no rejections).",
        "- **Settled (paid)** card → Claims → **Settled** tab.",
        "- **Queries to answer** and **Drafts** show what needs your action (information only).",
        "- **Pre-authorizations needing action** and **Claims needing action** panels open the lists.",
      ].join("\n"),
    );
  }
  return guide("The payer dashboard shows **Pre-auths awaiting decision**, **Claims awaiting decision** and **Queries with hospitals**; each **View** link opens the matching list. Use it as the starting point for review.");
}

function workflowReply(w: Who, q: string): GuideReply {
  if (/claim/i.test(q) && !/pre-?auth/i.test(q)) {
    return guide(["**Claims workflow**", "", "1. Hospital Staff: **New claim** (cashless from an approved pre-authorization, or reimbursement from the patient's coverage).", "2. Enter details, upload documents, submit → **Submitted**.", "3. Payer: **Under assessment** → **Approved**, **Partially approved**, **Rejected** or **Query raised**.", "4. If queried, the hospital responds and the payer reviews again.", "5. The insurer records settlement → **Settled**."].join("\n"));
  }
  if (w.payer && !w.hospital) {
    return guide(["**Payer review workflow**", "", "1. Dashboard → **Pre-auths awaiting decision** → **View**.", "2. Open the request and review patient/policy, medical/financial information and documents.", "3. Decide in the **Decision** card: **Approve**, **Partially approve**, **Reject** or **Raise a query**.", "4. If you raised a query, the hospital responds and the request returns to you for another review.", "5. For claims, the insurer later records **Settled**."].join("\n"));
  }
  return guide(
    [
      "**Hospital Staff workflow**",
      "",
      "1. Sign in → Dashboard.",
      "2. **Patients → Register patient**, then **Add coverage** on the patient.",
      "3. **Check eligibility**.",
      "4. **New pre-authorization** → enter details → upload documents → **Run checks** → **Submit Pre-Authorization**.",
      "5. Status **Submitted** → **Awaiting payer** → the payer approves, rejects or raises a query.",
      "6. If **Query raised**, open the request → **Respond to query** → **Send response**; the payer reviews again.",
      "7. After discharge, **New claim**; the payer assesses it and the insurer records **Settled**.",
    ].join("\n"),
  );
}

function nextReply(w: Who): GuideReply {
  if (w.hospital) {
    return guide(["Check what needs you first:", pathBlock("Dashboard", "Pre-authorizations needing action"), "Open the **Needs action** tab: **Draft** requests need to be completed and submitted, and **Query raised** requests need your response (**Respond to query**). Requests in **Awaiting payer** need nothing from you; the payer is working on them.", "", "For a specific request, use the **About a request** tab of this assistant to see its next step."].join("\n"), [{ label: "Needs action", href: "/pre-authorizations?view=action" }]);
  }
  if (w.payer) {
    return guide(["Start with:", pathBlock(...reach(w, "preauth").steps), "Open requests in the **Awaiting payer** tab, review them and record a decision. Then check **Claims awaiting decision**."].join("\n"), [{ label: "Awaiting payer", href: "/pre-authorizations?view=review" }]);
  }
  return guide("Tell me what you are trying to do (for example create a pre-authorization, find claims or understand a status) and I will give you the exact path.");
}

function helloReply(w: Who): GuideReply {
  return guide(`Hi! I'm the Claimix Insurance Assistant. I can show you where things are in Claimix, explain statuses and workflows, and tell you what your role (**${w.roleName}**) can do. Try one of the suggestions below.`);
}

function queryReply(w: Who): GuideReply {
  if (w.hospital) return guide(["A **query** means the payer needs more information.", "", "1. Open the request from the **Needs action** tab:", pathBlock(...reach(w, "preauth").steps, "Needs action", "Select the request"), "2. Read the **Query from the payer** message and the documents asked for.", "3. Use **Respond to query** → **Send response** (upload any requested documents first).", "4. The payer reviews it again."].join("\n"), [{ label: "Needs action", href: "/pre-authorizations?view=action" }]);
  return decisionReply(w, "raise a query");
}

/** Deterministic answer for questions Claimix itself can answer, or null. */
export function ruleAnswer(w: Who, q: string): GuideReply | null {
  const t = q.trim();
  if (/^(hi|hello|hey|help|what can you do\??|what do you do\??)[!. ]*$/i.test(t)) return helloReply(w);
  if (/\b(navjeevan|aarogya|suraksha|another insurer|other insurer|different insurer|testing context|switch context|insurance context|insurer'?s? (?:requests|data))\b/i.test(t) || (/\b(can'?t|cannot|don'?t|not)\b.*\b(see|find)\b.*\b(insurer|insurance compan)/i.test(t))) return contextReply(w);
  const st = statusReply(t);
  if (st) return st;
  if (/\b(approve|reject|decline|raise a query|decision)\b/i.test(t) && /\b(how|why|can'?t|cannot|can i|able|allowed|unable)\b/i.test(t)) return decisionReply(w, t);
  if (/\bquer(y|ies)\b/i.test(t) && /\b(respond|answer|reply|handle|how)\b/i.test(t)) return queryReply(w);
  if (/\b(can'?t|cannot|unable|don'?t|not)\b.*\b(find|see|locate)\b.*\b(pre-?auth\w*|submitted|request)\b|\bwhere\b.*\b(my|the)\b.*\b(submitted|pre-?auth)/i.test(t) && !/\bwhere (?:can i|do i|is|are)\b.*\bfind\b.*\bpre-?auth\w*\s*\??$/i.test(t)) return missingSubmitted(w);
  if (/\b(create|raise|start|make|file|submit|new)\b.*\bpre-?auth/i.test(t) && /\b(how|steps|process|do i|can i)\b/i.test(t)) return createPreauth(w);
  if (/\b(create|raise|start|make|file|new)\b.*\bclaim/i.test(t) && /\b(how|steps|process|do i|can i)\b/i.test(t)) return createClaim(w);
  if (/\b(upload|attach|add)\b.*\b(documents?|files?|reports?|pdf)\b/i.test(t)) return uploadDocs(w);
  if (/\bdocuments?\b/i.test(t) && /\b(see|view|download|where|find|located)\b/i.test(t) && /\b(pre-?auth|claim|this|request)\b/i.test(t)) {
    return guide(["Path:", pathBlock(...reach(w, "preauth").steps, "Select the pre-authorization", "Documents"), "The **Documents** card on the request page lists every uploaded document with its status. Claims have the same card. All documents, and requests missing mandatory ones, are also under **Sidebar → Documents**."].join("\n"), w.can("document:read") ? [{ label: "Open Documents", href: "/documents" }] : []);
  }
  if (/\b(check|my|status of)\b.*\b(pre-?auth|claim)\b.*\bstatus\b|\bcheck my (pre-?auth|claim)/i.test(t)) {
    const pa = reach(w, "preauth");
    return guide(["Every request shows its status in the list and at the top of its page.", "", "Path:", pathBlock(...pa.steps, "All tab", "Select the pre-authorization"), "Tabs group them: **Awaiting payer** (Submitted or Under review), **Needs action** (Draft or Query raised), **Approved** and **Decided**. For the next step on one request, use the **About a request** tab of this assistant."].join("\n"), [{ label: "Open Pre-authorizations", href: "/pre-authorizations?view=all" }]);
  }
  if (/\b(what can|what are|permissions?|allowed to|my role|role)\b/i.test(t) && /\b(role|reviewer|staff|admin\w*|permissions?|i do|can i do)\b/i.test(t)) return roleReply(w, t);
  if (/\b(dashboard|card|cards)\b/i.test(t) && /\b(explain|mean|what|where|lead|open|show)\b/i.test(t)) return dashboardReply(w);
  if (/\b(workflow|process|end to end|how does .* work|overall flow|steps)\b/i.test(t) && /\b(claimix|pre-?auth\w*|claims?|hospital|payer|workflow|process|app\w*)\b/i.test(t)) return workflowReply(w, t);
  if (/\bnext\b|\bwhat (?:now|should i do)\b/i.test(t) && !/\b(pre-?auth\w*|claims?)\b.*\bwhere\b/i.test(t)) return nextReply(w);
  const feature = FEATURES.find((f) => f.re.test(t));
  if (feature && (NAV_WORDS.test(t) || /\bhow (?:do|can) i\b.*\b(open|get|access|check|view)\b/i.test(t) || t.split(/\s+/).length <= 4)) return featureReply(w, feature);
  return null;
}

const SYSTEM_RULES = [
  "You are the Claimix Insurance Assistant, an application-specific assistant. You answer ONLY questions about the Claimix application: its screens, navigation, buttons, workflows, roles, permissions, statuses, pre-authorizations, claims, eligibility, policies, documents, reports and the insurance portal context.",
  "If the question is not about Claimix, reply with exactly: OUT_OF_SCOPE. Never write code, emails, essays or general knowledge answers, and never give medical, legal or financial advice.",
  "Use ONLY the APPLICATION KNOWLEDGE below. Never invent screens, buttons, URLs, roles, permissions, statuses, workflows, insurers or policies. If it is not covered there, reply: " + NOT_SURE,
  "Respect the current user's role: never suggest actions their role cannot perform. For navigation, give the exact path using the real labels, formatted as a fenced block with the language 'path' and one step per line separated by '→'.",
  "Be concise. Use short numbered steps for workflows. You do not see any patient or request records in this chat; for a specific request, tell the user to use the 'About a request' tab.",
].join("\n");

export async function guideChat(principal: Principal, question: string, history: Turn[]): Promise<GuideReply> {
  const w = whoIs(principal);
  if (isOutOfScope(question, history.length > 0)) return scope();
  const rule = ruleAnswer(w, question);
  if (rule) return rule;

  const fallback = (notice: string | null): GuideReply => ({
    markdown: `${NOT_SURE}\n\nI can help with: where to find screens, how to create a pre-authorization or claim, what a status means, uploading documents, and what your role can do.`,
    links: [],
    source: "guide",
    notice,
  });
  if (!llmEnabled()) return fallback(null);

  const r = await completeWithOpenRouter(
    [{ role: "system", content: `${SYSTEM_RULES}\n\nAPPLICATION KNOWLEDGE\n${knowledgeText(w)}` }, ...history.slice(-6), { role: "user", content: question }],
    500,
  );
  if (!r.ok) return fallback(r.message.replace(/ The answer below comes from the records\.$/, ""));
  if (/^\s*OUT_OF_SCOPE\b/i.test(r.text)) return scope();
  return { markdown: r.text, links: [], source: "model", notice: null };
}
