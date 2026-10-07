import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { ClaimService } from "@/modules/claims/claims.service";
import { CLAIM_STATUS_LABEL, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { PatientService } from "@/modules/patients/patients.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { STATUS_LABEL, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { loadContext } from "./records";

/**
 * Looks up application identifiers a user typed or pasted (patient numbers, pre-authorization and claim
 * references, or record ids) through the SAME scoped services the screens use, so the assistant can only
 * ever see what the signed-in user can see. A record outside the user's scope is indistinguishable from one
 * that does not exist. Nothing returned here contains a patient's name, date of birth or contact details:
 * the facts are passed to a language model, and the screens (linked from each result) show the rest.
 */
export type RecordKind = "patient" | "preauth" | "claim";

export interface RecordFacts {
  kind: RecordKind;
  /** What the user typed (normalized) and what the record is called in the app. */
  identifier: string;
  id: string;
  /** Where the user opens it. */
  href: string;
  /** Plain statements about the record. */
  facts: string[];
}

export interface LookupResult {
  found: RecordFacts[];
  /** Identifiers that match a Claimix format but no record the user can access. */
  missing: { identifier: string; kind: RecordKind | null }[];
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CODE = /\b[A-Za-z]{2,4}-[A-Za-z0-9]{2,}(?:-[A-Za-z0-9]{2,})*\b/g;
const PREFIX: Record<string, RecordKind> = { PT: "patient", PA: "preauth", CL: "claim" };

/** Identifier-looking tokens in a message (at most 4), uppercased, without duplicates. */
export function extractIdentifiers(text: string): { token: string; kind: RecordKind | null; uuid: boolean }[] {
  const out: { token: string; kind: RecordKind | null; uuid: boolean }[] = [];
  const seen = new Set<string>();
  for (const m of text.match(UUID) ?? []) {
    const t = m.toLowerCase();
    if (!seen.has(t)) { seen.add(t); out.push({ token: t, kind: null, uuid: true }); }
  }
  for (const m of text.match(CODE) ?? []) {
    const t = m.toUpperCase();
    const kind = PREFIX[t.split("-")[0]!] ?? null;
    // Only references in the app's own formats (PT-, PA-, CL-) are treated as identifiers.
    if (!kind || seen.has(t)) continue;
    seen.add(t);
    out.push({ token: t, kind, uuid: false });
  }
  return out.slice(0, 4);
}

const safe = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

const inr = (v: string | null | undefined) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : null);

async function describe(ctx: ServiceContext, kind: "preauth" | "claim", id: string): Promise<string[] | null> {
  const c = await safe(loadContext(ctx, kind, id));
  if (!c) return null;
  const facts = [
    `Status: ${c.statusLabel}`,
    `Type: ${c.claimType}`,
    `Policy: ${c.policyName} (${c.category})`,
    c.payerName ? `Addressed to: ${c.payerName}` : null,
    `Documents on file: ${c.documents.length}${c.documents.length ? ` (${c.documents.map((d) => `${d.docType}: ${d.status}`).join("; ")})` : ""}`,
    c.openQueries.length ? `Open payer queries: ${c.openQueries.map((q) => q.reasonTitle ?? q.message).join("; ")}` : null,
    c.decisions[0] ? `Latest payer decision: ${c.decisions[0].decision}${c.decisions[0].reasonTitle ? ` (${c.decisions[0].reasonTitle})` : ""}` : null,
    c.nextAction ? `Next step: ${c.nextAction}${c.nextTeam ? ` (responsible: ${c.nextTeam})` : ""}` : null,
  ];
  return facts.filter((f): f is string => !!f);
}

async function findPatient(ctx: ServiceContext, token: string): Promise<RecordFacts | null> {
  if (!can(ctx.principal, "patient:read")) return null;
  const r = await safe(PatientService.list(ctx, { q: token, page: 1, pageSize: 5 }));
  const row = r?.rows.find((x) => x.patientNo.toUpperCase() === token);
  if (!row) return null;
  const facts = [`Patient number ${row.patientNo}, registered at ${row.hospitalName}`, `Registered: ${row.createdAt.toISOString().slice(0, 10)}`];
  return { kind: "patient", identifier: row.patientNo, id: row.id, href: `/patients/${row.id}`, facts };
}

async function findPreauth(ctx: ServiceContext, token: string): Promise<RecordFacts | null> {
  if (!can(ctx.principal, "preauth:read")) return null;
  const r = await safe(PreauthService.list(ctx, { q: token, page: 1, pageSize: 5 }, {}));
  const row = r?.rows.find((x) => x.reference.toUpperCase() === token);
  if (!row) return null;
  const facts = (await describe(ctx, "preauth", row.id)) ?? [`Status: ${STATUS_LABEL[row.status as PreauthStatus]}`];
  return { kind: "preauth", identifier: row.reference, id: row.id, href: `/pre-authorizations/${row.id}`, facts };
}

async function findClaim(ctx: ServiceContext, token: string): Promise<RecordFacts | null> {
  if (!can(ctx.principal, "claim:read")) return null;
  const r = await safe(ClaimService.list(ctx, { q: token, page: 1, pageSize: 5 }, {}));
  const row = r?.rows.find((x) => x.reference.toUpperCase() === token);
  if (!row) return null;
  const facts = (await describe(ctx, "claim", row.id)) ?? [`Status: ${CLAIM_STATUS_LABEL[row.status as ClaimStatus]}`];
  const money = [row.claimedAmount && `claimed ${inr(row.claimedAmount)}`, row.approvedAmount && `approved ${inr(row.approvedAmount)}`].filter(Boolean).join(", ");
  if (money) facts.push(`Amounts: ${money}`);
  return { kind: "claim", identifier: row.reference, id: row.id, href: `/claims/${row.id}`, facts };
}

/** A record id (uuid): tried as a pre-authorization, a claim, then a patient, each through its scoped service. */
async function findById(ctx: ServiceContext, id: string): Promise<RecordFacts | null> {
  const pre = can(ctx.principal, "preauth:read") ? await safe(PreauthService.workspace(ctx, id)) : null;
  if (pre) return findPreauth(ctx, pre.preauth.reference.toUpperCase());
  const cl = can(ctx.principal, "claim:read") ? await safe(ClaimService.workspace(ctx, id)) : null;
  if (cl) return findClaim(ctx, cl.claim.reference.toUpperCase());
  const pt = can(ctx.principal, "patient:read") ? await safe(PatientService.get(ctx, id)) : null;
  return pt ? findPatient(ctx, pt.patient.patientNo.toUpperCase()) : null;
}

export async function lookupIdentifiers(ctx: ServiceContext, text: string): Promise<LookupResult> {
  const found: RecordFacts[] = [];
  const missing: LookupResult["missing"] = [];
  for (const t of extractIdentifiers(text)) {
    const hit = t.uuid
      ? await findById(ctx, t.token)
      : t.kind === "patient" ? await findPatient(ctx, t.token) : t.kind === "preauth" ? await findPreauth(ctx, t.token) : await findClaim(ctx, t.token);
    if (hit) found.push(hit);
    else missing.push({ identifier: t.token, kind: t.kind });
  }
  return { found, missing };
}

/** The user's most recent requests (references and statuses only), so "the request I submitted" can be resolved. */
export async function recentRequests(ctx: ServiceContext): Promise<string[]> {
  const q = { page: 1, pageSize: 5 };
  const [pre, cl] = await Promise.all([
    can(ctx.principal, "preauth:read") ? safe(PreauthService.list(ctx, q, {})) : null,
    can(ctx.principal, "claim:read") ? safe(ClaimService.list(ctx, q, {})) : null,
  ]);
  return [
    ...(pre?.rows ?? []).map((r) => `Pre-authorization ${r.reference}: ${STATUS_LABEL[r.status as PreauthStatus]}`),
    ...(cl?.rows ?? []).map((r) => `Claim ${r.reference}: ${CLAIM_STATUS_LABEL[r.status as ClaimStatus]}`),
  ];
}

export const KIND_LABEL: Record<RecordKind, string> = { patient: "patient number", preauth: "pre-authorization reference", claim: "claim reference" };
