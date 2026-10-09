import "server-only";
import { eq } from "drizzle-orm";
import { roles, users } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { ageOn, formatDate, formatDateTime, formatINR } from "@/lib/india";
import { sha256Hex } from "@/lib/security/crypto";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { DocumentService } from "@/modules/documents/documents.service";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { PreauthRepository } from "./preauth.repository";
import { PreauthService } from "./preauth.service";
import { buildRegistrationPdf, type RegistrationSheet } from "./registration-pdf";

/** The registration as kept with the case (the signature as PNG base64; scoped with the case). */
export interface StoredRegistration {
  signaturePng: string;
  signerUserId: string;
  signerName: string;
  signerRole: string;
  signedAt: string;
  submittedAt: string;
  documentId: string;
  /** Hash of the details and signature the PDF was made from (same content → no second copy). */
  contentHash: string;
  detailsHash: string;
}

/** What the Register Case page and the PDF show. */
export interface RegistrationData {
  caseId: string;
  reference: string;
  patientId: string;
  patientName: string;
  hospital: string;
  editable: boolean;
  clinicalComplete: boolean;
  clinicalIssues: string[];
  sections: { title: string; rows: [string, string][] }[];
  cost: { head: string; covers: string; perDay: string; days: string; amount: string }[];
  costTotal: string;
  registration: (Omit<StoredRegistration, "signaturePng" | "contentHash" | "detailsHash" | "signerUserId"> & { signatureDataUrl: string; current: boolean }) | null;
}

const TITLE = "Pre-authorization request - case registration form";
const MAX_SIGNATURE_BYTES = 300 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type Wizard = Awaited<ReturnType<typeof PreauthService.wizard>>;

const blank = (v: unknown) => (v === undefined || v === null || v === "" ? "" : Array.isArray(v) ? v.join(", ") : String(v));
const at = (date: unknown, time: unknown) => (date ? `${formatDate(String(date))}${time ? ` ${String(time)}` : ""}` : "");

function storedRegistration(w: Wizard): StoredRegistration | null {
  const r = (w.preauth.clinical as Record<string, unknown>).registration;
  return r && typeof r === "object" ? (r as StoredRegistration) : null;
}

const detailsHashOf = (w: Wizard) => sha256Hex(JSON.stringify({ d: w.details, k: w.kyc }));

/** The form's content, from the stored case only. */
function sheetOf(w: Wizard) {
  const d = w.details as Record<string, unknown>;
  const k = w.kyc;
  const items = (d.costItems ?? []) as { head: string; description?: string; perDay: number | string; days: number | string }[];
  const sections: RegistrationData["sections"] = [
    {
      title: "Patient and policy",
      rows: [
        ["Patient name", k?.patientName ?? w.patient.fullName],
        ["UHID / IP number", k?.uhid ? String(k.uhid) : w.patient.patientNo],
        ["Gender / age", `${k?.gender ?? w.patient.gender} · ${ageOn(k?.dob ?? w.patient.dob)} years`],
        ["Date of birth", formatDate(k?.dob ?? w.patient.dob)],
        ["Mobile", blank(k?.mobile)],
        ["Insurer / TPA", [w.insurerName, w.tpaName].filter(Boolean).join(" · ")],
        ["Policy", w.policy.name],
        ["Policy number", blank(k?.policyNumber)],
        ["Policy period", k ? `${formatDate(k.policyFrom)} – ${formatDate(k.policyTo)}` : `${formatDate(w.beneficiary.coverStart)} – ${formatDate(w.beneficiary.coverEnd)}`],
        ["TPA card / member ID", k?.memberId ? String(k.memberId) : w.beneficiary.memberId],
        ["Relationship to proposer", RELATIONSHIP_LABEL[w.beneficiary.relationship as keyof typeof RELATIONSHIP_LABEL] ?? w.beneficiary.relationship],
        ["Hospital", w.hospitalName ?? ""],
      ],
    },
    {
      title: "Clinical details and package",
      rows: [
        ["Treating doctor", blank(d.doctorName)],
        ["Registration number", blank(d.doctorRegistrationNo)],
        ["Department", blank(d.department)],
        ["Presenting complaint", blank(d.symptoms)],
        ["Diagnoses (ICD-10)", w.diagnoses.map((x) => `${x.code} — ${x.name}`).join("; ")],
        ["Line of treatment", blank(d.treatmentType)],
        ["Treatment / package", w.procedureName ?? ""],
        ["Past history of chronic illness", blank(d.chronicIllness)],
        ["Relevant critical findings", blank(d.criticalFindings)],
        ["Due to an accident", blank(d.isAccident)],
      ],
    },
    {
      title: "The stay",
      rows: [
        ["Admission type", blank(d.admissionType)],
        ["Stay starts", at(d.admissionDate, d.admissionTime)],
        ["Stay ends (expected)", at(d.dischargeDate, d.dischargeTime)],
        ["Expected length of stay (days)", blank(w.preauth.expectedStayDays)],
        ["Days in ICU", blank(d.icuDays)],
        ["Room category", blank(d.roomCategory)],
      ],
    },
  ];
  const cost = items.map((i) => ({
    head: i.head,
    covers: blank(i.description),
    perDay: formatINR(Number(i.perDay)),
    days: String(i.days),
    amount: formatINR(Number(i.perDay) * Number(i.days)),
  }));
  if (d.packageAmount !== undefined && d.packageAmount !== "") cost.push({ head: "All-inclusive package", covers: "", perDay: "", days: "", amount: formatINR(Number(d.packageAmount)) });
  return { sections, cost, costTotal: formatINR(w.preauth.estimatedCost) };
}

async function signer(ctx: ServiceContext) {
  const [u] = await ctx.db
    .select({ name: users.fullName, role: roles.name })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, ctx.principal.userId))
    .limit(1);
  return { name: u?.name ?? "Unknown user", role: ctx.principal.acting?.roleName ?? u?.role ?? ctx.principal.roleKey };
}

function signaturePng(dataUrl: unknown): Uint8Array {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new ValidationError("Sign in the signature box before submitting.", { signature: ["Sign the form."] });
  }
  const bytes = new Uint8Array(Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
  if (bytes.length > MAX_SIGNATURE_BYTES || !PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new ValidationError("The signature couldn't be read. Clear it and sign again.", { signature: ["Sign again."] });
  }
  return bytes;
}

async function pdfFor(ctx: ServiceContext, w: Wizard, signature: RegistrationSheet["signature"]) {
  const me = await signer(ctx);
  const { sections, cost, costTotal } = sheetOf(w);
  return buildRegistrationPdf({
    title: TITLE,
    reference: w.preauth.reference,
    hospital: w.hospitalName ?? "",
    sections,
    cost,
    costTotal,
    signature,
    generatedAt: formatDateTime(new Date()),
    generatedBy: me.name,
  });
}

/**
 * New Claim → Register Case: the case registration form for a draft the caller's organization raised. Read from the
 * stored case; signed electronically (a drawn signature with signer identity and time — not a certified DSC / eSign);
 * submitted as a PDF filed with the case's documents, so it shows on the patient's page.
 */
export const RegistrationService = {
  /** Who signs: the signed-in user and the role they act in. */
  signer,

  async data(ctx: ServiceContext, id: string): Promise<RegistrationData> {
    const w = await PreauthService.wizard(ctx, id);
    const reg = storedRegistration(w);
    const { sections, cost, costTotal } = sheetOf(w);
    return {
      caseId: w.preauth.id,
      reference: w.preauth.reference,
      patientId: w.patient.id,
      patientName: w.patient.fullName,
      hospital: w.hospitalName ?? "",
      editable: w.editable,
      clinicalComplete: w.clinicalComplete,
      clinicalIssues: w.scrutiny.findings.filter((f) => f.key.startsWith("clinical:")).map((f) => f.explanation),
      sections,
      cost,
      costTotal,
      registration: reg
        ? {
            signatureDataUrl: `data:image/png;base64,${reg.signaturePng}`,
            signerName: reg.signerName,
            signerRole: reg.signerRole,
            signedAt: reg.signedAt,
            submittedAt: reg.submittedAt,
            documentId: reg.documentId,
            // Details changed after it was submitted: submit again for an up-to-date copy.
            current: reg.detailsHash === detailsHashOf(w),
          }
        : null,
    };
  },

  /** The form as a PDF (with the submitted signature, if any). Audited. */
  async pdf(ctx: ServiceContext, id: string) {
    const w = await PreauthService.wizard(ctx, id);
    const reg = storedRegistration(w);
    const pdf = await pdfFor(
      ctx,
      w,
      reg ? { png: new Uint8Array(Buffer.from(reg.signaturePng, "base64")), signerName: reg.signerName, signerRole: reg.signerRole, signedAt: formatDateTime(reg.signedAt) } : null,
    );
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "preauth.registration_downloaded", resourceType: "preauth", resourceId: w.preauth.id });
    return { pdf, reference: w.preauth.reference };
  },

  /** Print / Download / Save → Save: a copy of the form (signed with the given signature, if any) filed with the case. */
  async saveCopy(ctx: ServiceContext, id: string, input: { signature?: string | null }) {
    const w = await PreauthService.wizard(ctx, id);
    if (!w.editable) throw new ConflictError("This case has been submitted; its form can no longer be saved here.");
    const me = await signer(ctx);
    const png = input.signature ? signaturePng(input.signature) : null;
    const pdf = await pdfFor(ctx, w, png ? { png, signerName: me.name, signerRole: me.role, signedAt: formatDateTime(new Date()) } : null);
    const doc = await DocumentService.upload(ctx, {
      subjectType: "preauth",
      subjectId: w.preauth.id,
      docType: "case_registration_form",
      file: { name: `case-registration-${w.preauth.reference}${png ? "" : "-unsigned"}.pdf`, size: pdf.length, bytes: pdf },
    });
    return { documentId: doc.id };
  },

  /**
   * Register Case → Submit: the required details must be complete and the form signed. The signed PDF is filed with the
   * case (and so on the patient's page) and the registration is recorded. Submitting the same content again returns
   * the existing copy instead of filing a duplicate.
   */
  async submit(ctx: ServiceContext, id: string, input: { signature?: unknown }) {
    const w = await PreauthService.wizard(ctx, id);
    if (!w.editable) throw new ConflictError("This case has been submitted; its form can no longer be changed here.");
    if (w.preauth.raisedByOrgId !== ctx.principal.organizationId) throw new ForbiddenError();
    if (!w.clinicalComplete) {
      const issues = w.scrutiny.findings.filter((f) => f.key.startsWith("clinical:")).map((f) => f.explanation);
      throw new ValidationError(`Complete the form first: ${issues.join(" ")}`);
    }
    const png = signaturePng(input.signature);
    const detailsHash = detailsHashOf(w);
    const contentHash = sha256Hex(`${detailsHash}:${sha256Hex(Buffer.from(png))}`);
    const prev = storedRegistration(w);
    if (prev && prev.contentHash === contentHash) return { documentId: prev.documentId, duplicate: true };

    const me = await signer(ctx);
    const signedAt = new Date().toISOString();
    const pdf = await pdfFor(ctx, w, { png, signerName: me.name, signerRole: me.role, signedAt: formatDateTime(signedAt) });
    const doc = await DocumentService.upload(ctx, {
      subjectType: "preauth",
      subjectId: w.preauth.id,
      docType: "case_registration_form",
      file: { name: `case-registration-${w.preauth.reference}.pdf`, size: pdf.length, bytes: pdf },
    });
    const registration: StoredRegistration = {
      signaturePng: Buffer.from(png).toString("base64"),
      signerUserId: ctx.principal.userId,
      signerName: me.name,
      signerRole: me.role,
      signedAt,
      submittedAt: signedAt,
      documentId: doc.id,
      contentHash,
      detailsHash,
    };
    // Re-read the stored clinical record (the upload above cleared the last engine run on the same row).
    const fresh = await PreauthRepository.findScoped(ctx.db, ctx.principal, "organization", w.preauth.id);
    const clinical = (fresh?.preauth.clinical ?? w.preauth.clinical) as Record<string, unknown>;
    await PreauthRepository.update(ctx.db, w.preauth.id, { clinical: { ...clinical, registration } });
    await AuditService.record(ctx.db, {
      ...actorOf(ctx),
      action: "preauth.case_registered",
      resourceType: "preauth",
      resourceId: w.preauth.id,
      newState: { documentId: doc.id, signerName: me.name, signerRole: me.role, signedAt, patientId: w.patient.id },
    });
    return { documentId: doc.id, duplicate: false };
  },
};
