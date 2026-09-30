import type { CaseFacts } from "./types";

/** Human-readable names for facts, used in "missing information" lists. */
export const FACT_LABEL = {
  dob: "Patient date of birth",
  relationship: "Relationship to policyholder",
  coverStart: "Policy start date",
  coverEnd: "Policy end date",
  inception: "Policy inception date (first continuous cover)",
  sumInsured: "Sum insured",
  availableBalance: "Available sum insured balance",
  admissionDate: "Expected admission date",
  dischargeDate: "Discharge date",
  submissionDate: "Claim submission date",
  claimType: "Cashless or reimbursement",
  networkStatus: "Hospital network / empanelment status for this payer",
  diagnosisCode: "Diagnosis (ICD code)",
  procedureCode: "Treatment / procedure",
  isAccident: "Whether the admission is due to an accident",
  pedDeclared: "Whether a pre-existing disease was declared",
  pedRelated: "Whether this treatment is related to a declared pre-existing disease",
  estimatedCost: "Estimated treatment cost",
  roomRentPerDay: "Room rent per day",
  uploadedDocuments: "Uploaded documents",
} as const;

export type FactKey = keyof typeof FACT_LABEL;

/** Reads a fact by key; undefined/null/"" all count as missing. */
export function fact(f: CaseFacts, key: FactKey): unknown {
  const v = (() => {
    switch (key) {
      case "dob": return f.patient?.dob;
      case "relationship": return f.patient?.relationship;
      case "coverStart": return f.cover?.start;
      case "coverEnd": return f.cover?.end;
      case "inception": return f.cover?.inceptionDate ?? f.cover?.start;
      case "sumInsured": return f.cover?.sumInsured;
      case "availableBalance": return f.cover?.availableBalance;
      case "admissionDate": return f.admissionDate;
      case "dischargeDate": return f.dischargeDate;
      case "submissionDate": return f.submissionDate;
      case "claimType": return f.claimType;
      case "networkStatus": return f.hospital?.networkStatus;
      case "diagnosisCode": return f.diagnosisCode;
      case "procedureCode": return f.procedureCode;
      case "isAccident": return f.isAccident;
      case "pedDeclared": return f.ped?.declared;
      case "pedRelated": return f.ped?.related;
      case "estimatedCost": return f.estimatedCost;
      case "roomRentPerDay": return f.roomRentPerDay;
      case "uploadedDocuments": return f.uploadedDocuments;
    }
  })();
  if (v === null || v === "" || (typeof v === "number" && !Number.isFinite(v))) return undefined;
  return v;
}

/** Labels of the listed facts that are missing. */
export function missing(f: CaseFacts, ...keys: FactKey[]): string[] {
  return keys.filter((k) => fact(f, k) === undefined).map((k) => FACT_LABEL[k]);
}

const DAY = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY);
}

export function ageOn(dob: string, on: string): number {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/**
 * ICD-style match, case-insensitive: "H25" matches "H25" and "H25.1";
 * "Z41.1" matches "Z41.1" and "Z41.10"; "K80" does NOT match "K801" or "K8".
 */
export function codeMatches(code: string, patterns: string[]): boolean {
  const c = code.trim().toUpperCase();
  return patterns.some((p) => {
    const q = p.trim().toUpperCase();
    if (!q) return false;
    return c === q || c.startsWith(`${q}.`) || (q.includes(".") && c.startsWith(q));
  });
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
