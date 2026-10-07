import { inflateRawSync, inflateSync } from "node:zlib";
import { RELATIONSHIPS } from "@/modules/patients/coverage.validation";

/**
 * Reads insurance details out of an uploaded insurance card / policy document.
 *
 * Everything here is deterministic and offline: the text is taken from the file itself and each field
 * is matched from a labelled value in that text. Nothing is inferred, completed or guessed — a field
 * that is not clearly labelled in the document simply comes back absent, so the coverage form leaves
 * it blank for staff to type. The result is never treated as verified: hospital staff review and
 * submit the values, and only what they submit is saved (see `CoverageService.add`).
 *
 * Images (PNG / JPG photographs of a card) carry no text layer and this build has no OCR engine, so
 * they yield no fields; the document is still filed against the patient and the form stays manual.
 */

export type Relationship = (typeof RELATIONSHIPS)[number];

/** One value read from the document, with the label it was read from (shown to staff for checking). */
export interface ReadField {
  field: keyof ExtractedInsurance;
  label: string;
  /** The text as printed in the document. */
  raw: string;
}

export interface ExtractedInsurance {
  insurerName?: string;
  policyName?: string;
  schemeName?: string;
  policyNumber?: string;
  memberId?: string;
  policyHolderName?: string;
  patientName?: string;
  relationship?: Relationship;
  inceptionDate?: string;
  coverStart?: string;
  coverEnd?: string;
  sumInsured?: number;
  availableBalance?: number;
}

export interface ExtractionResult {
  details: ExtractedInsurance;
  read: ReadField[];
  /** Whether any text at all could be read from the file. */
  hasText: boolean;
}

// ---------------------------------------------------------------- PDF text

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

function isPdf(bytes: Uint8Array) {
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** Decodes one PDF string object: `(literal)` with escapes, or `<hex>` (UTF-16BE when it has a BOM). */
function literalAt(src: string, start: number): { text: string; next: number } | null {
  if (src[start] === "(") {
    let depth = 1;
    let out = "";
    let i = start + 1;
    while (i < src.length && depth > 0) {
      const c = src[i]!;
      if (c === "\\") {
        const n = src[i + 1] ?? "";
        const simple: Record<string, string> = { n: "\n", r: "\n", t: " ", b: "", f: "", "(": "(", ")": ")", "\\": "\\" };
        if (n in simple) {
          out += simple[n];
          i += 2;
          continue;
        }
        if (/[0-7]/.test(n)) {
          const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1))![0];
          out += String.fromCharCode(parseInt(oct, 8));
          i += 1 + oct.length;
          continue;
        }
        i += 2;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
      out += c;
      i++;
    }
    return { text: out, next: i + 1 };
  }
  if (src[start] === "<" && src[start + 1] !== "<") {
    const end = src.indexOf(">", start);
    if (end < 0) return null;
    const hex = src.slice(start + 1, end).replace(/[^0-9a-fA-F]/g, "");
    const bytes: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    const utf16 = bytes[0] === 0xfe && bytes[1] === 0xff;
    let out = "";
    if (utf16) for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    else out = String.fromCharCode(...bytes);
    return { text: out, next: end + 1 };
  }
  return null;
}

/** Pulls the shown text out of a decoded content stream, keeping one line per text-positioning operator. */
function textFromContent(content: string): string {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const lit = literalAt(content, i);
    if (lit) {
      out += lit.text;
      i = lit.next;
      continue;
    }
    const two = content.slice(i, i + 2);
    if (two === "Td" || two === "TD" || two === "T*" || two === "ET" || two === "TJ" || two === "Tj") {
      out += "\n";
      i += 2;
      continue;
    }
    i++;
  }
  return out;
}

function inflateMaybe(raw: Buffer): Buffer | null {
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      return fn(raw);
    } catch {
      /* not this encoding */
    }
  }
  return null;
}

/**
 * Text of a PDF, without a PDF library: every `stream … endstream` object is taken, inflated when it
 * is Flate-encoded, and its text-showing operators are collected. Scanned PDFs with no text layer
 * (image-only) return nothing, which is reported rather than filled in.
 */
export function pdfText(bytes: Uint8Array): string {
  const src = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  const re = /stream\r?\n?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const dictStart = src.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? src.slice(dictStart, m.index) : "";
    const end = src.indexOf("endstream", m.index);
    if (end < 0) break;
    const body = src.slice(m.index + m[0].length, end);
    // Past the whole "endstream" keyword: it ends in "stream" itself, which would otherwise match next.
    re.lastIndex = end + "endstream".length;
    if (/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)\b/.test(dict)) continue; // embedded image
    let content = body;
    if (/\/FlateDecode\b/.test(dict)) {
      const out = inflateMaybe(Buffer.from(body, "latin1"));
      if (!out) continue;
      content = out.toString("latin1");
    }
    parts.push(textFromContent(content));
  }
  return parts.join("\n");
}

/** Readable text of an uploaded file; empty when the file carries no text layer. */
export function documentText(bytes: Uint8Array): string {
  if (!isPdf(bytes)) return ""; // PNG / JPG: no text layer and no OCR engine in this build
  return pdfText(bytes);
}

// ---------------------------------------------------------------- values

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, mo: number, d: number): string | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return undefined;
  const s = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().startsWith(s) ? s : undefined;
}

const year4 = (y: number) => (y >= 100 ? y : y >= 70 ? 1900 + y : 2000 + y);

/**
 * A date as printed on Indian insurance documents: `15/06/2026`, `15-06-26`, `15 Jun 2026`,
 * `Jun 15, 2026` or an ISO `2026-06-15`. Numeric dates are read day-first (Indian convention);
 * `03/04/2026` is 3 April, never 4 March.
 */
export function parseDocumentDate(text: string): string | undefined {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})$/.exec(t);
  if (m) {
    const [d, mo] = [+m[1]!, +m[2]!];
    // A first number above 12 can only be the day; otherwise day-first.
    return mo > 12 && d <= 12 ? iso(year4(+m[3]!), d, mo) : iso(year4(+m[3]!), mo, d);
  }
  m = /^(\d{1,2})\s*[-\s/]\s*([A-Za-z]{3,9})\.?\s*[-,\s/]\s*(\d{2,4})$/.exec(t);
  if (m) {
    const mo = MONTHS[m[2]!.slice(0, 4).toLowerCase()] ?? MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    return mo ? iso(year4(+m[3]!), mo, +m[1]!) : undefined;
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s*(\d{2,4})$/.exec(t);
  if (m) {
    const mo = MONTHS[m[1]!.slice(0, 4).toLowerCase()] ?? MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    return mo ? iso(year4(+m[3]!), mo, +m[2]!) : undefined;
  }
  return undefined;
}

const DATE_RE = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}|\d{1,2}\s*[-\s/]\s*[A-Za-z]{3,9}\.?\s*[-,\s/]\s*\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}\s*,?\s*\d{2,4})\b/g;

/** Every date in a piece of text, in order. */
function datesIn(text: string): string[] {
  return [...text.matchAll(DATE_RE)].map((m) => parseDocumentDate(m[1]!)).filter((d): d is string => !!d);
}

/**
 * A rupee amount as printed: `₹10,00,000`, `Rs. 10,00,000/-`, `INR 1000000`, `10,00,000.00`,
 * `10 Lakh`, `1.5 Crore`. Returns undefined when the text holds no amount.
 */
export function parseDocumentAmount(text: string): number | undefined {
  const t = text.replace(/[₹]|(\bRs\.?\b)|(\bINR\b)/gi, " ").replace(/\/-/g, " ");
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr\b|l\b)?/i.exec(t);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2]?.toLowerCase() ?? "";
  const mult = /^(lakh|lac|l$)/.test(unit) ? 100_000 : /^(crore|cr)/.test(unit) ? 10_000_000 : 1;
  const v = n * mult;
  return v > 0 && v <= 1_000_000_000 ? Math.round(v * 100) / 100 : undefined;
}

const RELATIONSHIP_WORDS: [RegExp, Relationship][] = [
  [/\b(self|own|primary insured|policy ?holder)\b/i, "self"],
  [/\b(spouse|husband|wife)\b/i, "spouse"],
  [/\b(son|daughter|child|dependent child)\b/i, "child"],
  [/\b(father[-\s]?in[-\s]?law|mother[-\s]?in[-\s]?law|parent[-\s]?in[-\s]?law)\b/i, "parent_in_law"],
  [/\b(father|mother|parent)\b/i, "parent"],
  [/\b(brother|sister|sibling)\b/i, "sibling"],
];

function parseRelationship(text: string): Relationship | undefined {
  for (const [re, value] of RELATIONSHIP_WORDS) if (re.test(text)) return value;
  return undefined;
}

// ---------------------------------------------------------------- labels

type Kind = "id" | "name" | "date" | "money" | "relationship";

interface LabelDef {
  field: keyof ExtractedInsurance;
  label: string;
  kind: Kind;
  re: RegExp;
  /** Labels that look similar but mean a different field; they must not match first. */
  not?: RegExp;
}

/**
 * Labels as they are printed on Indian insurance cards, policy schedules and scheme records.
 * Order matters: the more specific label of a pair (available balance before sum insured) comes first.
 */
const LABELS: LabelDef[] = [
  { field: "availableBalance", label: "Available balance", kind: "money", re: /\b(available\s+(?:balance|sum\s+insured|cover(?:age)?)|balance\s+sum\s+insured|remaining\s+(?:balance|cover(?:age)?|sum\s+insured))\b/i },
  { field: "sumInsured", label: "Sum insured", kind: "money", re: /\b(sum\s+insured|sum\s+assured|cover(?:age)?\s+amount|total\s+cover(?:age)?|entitlement)\b/i, not: /\b(available|balance|remaining|utilis|utiliz)\b/i },
  { field: "inceptionDate", label: "First inception date", kind: "date", re: /\b(first\s+inception(?:\s+date)?|inception\s+date|date\s+of\s+inception|policy\s+inception|member\s+since|insured\s+since)\b/i },
  { field: "coverStart", label: "Cover start", kind: "date", re: /\b(cover(?:age)?\s+(?:start|from|begins?|commenc\w*)|valid\s+from|policy\s+start|period\s+of\s+insurance\s+from|effective\s+(?:from|date)|start\s+date)\b/i },
  { field: "coverEnd", label: "Cover end", kind: "date", re: /\b(cover(?:age)?\s+(?:end|to|upto|up\s+to|until|till|expir\w*)|valid\s+(?:upto|up\s+to|till|until|to)|policy\s+(?:end|expiry)|expiry(?:\s+date)?|end\s+date|renewal\s+due)\b/i },
  { field: "memberId", label: "Member / beneficiary ID", kind: "id", re: /\b(member(?:ship)?\s*(?:id|no\.?|number|code)|beneficiary\s*(?:id|no\.?|number)|health\s*(?:card|id)\s*(?:no\.?|number|id)?|uhid|card\s*(?:no\.?|number)|enrol\w*\s*(?:id|no\.?|number))\b/i },
  { field: "policyNumber", label: "Policy number", kind: "id", re: /\bpolicy\s*(?:no\.?|number|#|code)\b/i },
  { field: "policyName", label: "Policy / plan name", kind: "name", re: /\b(policy|plan|product|scheme)\s+name\b|\b(plan|product)\b\s*:/i },
  { field: "schemeName", label: "Scheme", kind: "name", re: /\bscheme\b\s*:/i, not: /\bname\b/i },
  { field: "insurerName", label: "Insurance company", kind: "name", re: /\b(insurer|insurance\s+compan(?:y|ies)|underwritten\s+by|issued\s+by)\b/i },
  { field: "policyHolderName", label: "Policyholder", kind: "name", re: /\b(policy\s*holder(?:'?s)?(?:\s+name)?|proposer(?:\s+name)?|primary\s+insured)\b/i },
  { field: "patientName", label: "Patient / member name", kind: "name", re: /\b((?:insured|patient|member|beneficiary)(?:'?s)?\s+name|name\s+of\s+(?:the\s+)?(?:insured|patient|member|beneficiary))\b/i },
  { field: "relationship", label: "Relationship to policyholder", kind: "relationship", re: /\brelationship\b/i },
];

const ID_RE = /\b[A-Z0-9][A-Z0-9/_-]{4,39}\b/;

function valueOfKind(kind: Kind, text: string): string | number | Relationship | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  if (kind === "date") return datesIn(t)[0];
  if (kind === "money") return parseDocumentAmount(t);
  if (kind === "relationship") return parseRelationship(t);
  if (kind === "id") {
    const m = ID_RE.exec(t.toUpperCase());
    return m ? m[0] : undefined;
  }
  // A printed name or product title: stop at the next label on the same line.
  const name = t.split(/\s{2,}|\s*[|·•]\s*/)[0]!.trim();
  return name.length >= 3 && name.length <= 200 && /[A-Za-z]/.test(name) ? name : undefined;
}

/** Splits the document text into trimmed, non-empty lines. */
function lines(text: string): string[] {
  return text
    .split(/[\r\n]+/)
    .map((l) => l.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Finds the labelled values in the document text. A label is matched on a line and its value read
 * from the rest of that line, or, when the line holds only the label, from the following line (the
 * usual two-column card layout). Unlabelled text is never used as a value.
 */
export function parseInsuranceDetails(text: string): ExtractionResult {
  const ls = lines(text);
  const details: ExtractedInsurance = {};
  const read: ReadField[] = [];

  const take = (def: LabelDef, raw: string) => {
    if (details[def.field] !== undefined) return;
    const value = valueOfKind(def.kind, raw);
    if (value === undefined) return;
    (details as Record<string, unknown>)[def.field] = value;
    read.push({ field: def.field, label: def.label, raw: raw.replace(/\s+/g, " ").trim().slice(0, 120) });
  };

  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]!;
    for (const def of LABELS) {
      if (details[def.field] !== undefined) continue;
      const m = def.re.exec(line);
      if (!m) continue;
      if (def.not?.test(line)) continue;
      const after = line.slice(m.index + m[0].length).replace(/^\s*[:\-–—]?\s*/, "");
      if (after) take(def, after);
      // "Member ID" on its own line with the value underneath.
      if (details[def.field] === undefined && ls[i + 1] && !LABELS.some((d) => d.re.test(ls[i + 1]!))) take(def, ls[i + 1]!);
    }
  }

  // "Coverage: 15 Jun 2026 - 14 Jun 2027" and "Valid 15/06/2026 to 14/06/2027" print both dates
  // against one label; fill whichever end is still missing from such a range.
  if (details.coverStart === undefined || details.coverEnd === undefined) {
    for (const line of ls) {
      if (!/\b(cover(?:age)?|valid|period\s+of\s+insurance|policy\s+period)\b/i.test(line)) continue;
      const found = datesIn(line);
      if (found.length < 2) continue;
      const [start, end] = [found[0]!, found[found.length - 1]!];
      if (end < start) continue;
      if (details.coverStart === undefined) {
        details.coverStart = start;
        read.push({ field: "coverStart", label: "Cover start", raw: line.slice(0, 120) });
      }
      if (details.coverEnd === undefined) {
        details.coverEnd = end;
        read.push({ field: "coverEnd", label: "Cover end", raw: line.slice(0, 120) });
      }
      break;
    }
  }

  // A cover that ends before it starts was misread; drop both rather than offer a wrong period.
  if (details.coverStart && details.coverEnd && details.coverEnd < details.coverStart) {
    delete details.coverStart;
    delete details.coverEnd;
  }
  if (details.inceptionDate && details.coverStart && details.inceptionDate > details.coverStart) delete details.inceptionDate;
  if (details.sumInsured !== undefined && details.availableBalance !== undefined && details.availableBalance > details.sumInsured) {
    delete details.availableBalance;
  }
  const kept = new Set(Object.keys(details));
  return { details, read: read.filter((r) => kept.has(r.field)), hasText: ls.length > 0 };
}

// ---------------------------------------------------------------- policy matching

export interface PolicyOption {
  id: string;
  name: string;
  category: "private" | "government";
  insurerName?: string | null;
  schemeName?: string | null;
}

const STOP = new Set(["demo", "data", "health", "plan", "policy", "cover", "insurance", "india", "limited", "ltd", "the", "and", "for", "with", "general", "care"]);

function tokens(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/\(demo data\)/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 3 && !STOP.has(t)))];
}

/**
 * The policy or scheme in Claimix that the document is for, matched on the distinctive words of its
 * name (and its insurer's / scheme's name). Only a single clear winner is returned: when nothing
 * matches well, or two products match equally, the form leaves the policy unselected so staff choose
 * it — the policy decides which payer receives the request, so a guess is never acceptable.
 */
export function matchPolicy(text: string, options: PolicyOption[]): { policy: PolicyOption; score: number } | null {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const scored = options
    .map((p) => {
      const nameTokens = tokens(p.name);
      if (!nameTokens.length) return { p, score: 0 };
      const hits = nameTokens.filter((t) => haystack.includes(` ${t} `) || haystack.includes(` ${t}s `)).length;
      const payer = p.category === "government" ? p.schemeName : p.insurerName;
      const payerTokens = payer ? tokens(payer) : [];
      const payerHits = payerTokens.filter((t) => haystack.includes(` ${t} `)).length;
      // Share of the product's own distinctive words that appear, plus a smaller credit for the payer's.
      const score = hits / nameTokens.length + (payerTokens.length ? (payerHits / payerTokens.length) * 0.25 : 0);
      return { p, score: hits >= 2 || (hits === 1 && nameTokens.length === 1) ? score : 0 };
    })
    .filter((s) => s.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1]!.score >= scored[0]!.score - 0.001) return null; // ambiguous
  return { policy: scored[0]!.p, score: scored[0]!.score };
}
