import { getDb } from "@/db/client";
import { getCurrentUser, requestMeta } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { ageOn, formatDate, formatDateTime, formatINR } from "@/lib/india";
import { logger } from "@/lib/logging/logger";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import { CoverageService } from "@/modules/patients/coverage.service";
import { RELATIONSHIP_LABEL } from "@/modules/patients/coverage.validation";
import { buildPatientSheet } from "@/modules/patients/patient-pdf";
import { departmentLabel, GENDER_LABEL, NO_VISIT_REASON } from "@/modules/patients/patients.validation";
import { PatientService } from "@/modules/patients/patients.service";

export const dynamic = "force-dynamic";

/** The patient's details sheet as a PDF: the same fields, under the same access rules, as the patient page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await params;
  try {
    const ctx = { db: getDb(), principal: user.principal, meta: await requestMeta() };
    const { patient: p, hospitalName } = await PatientService.get(ctx, id);
    const coverage = await CoverageService.forPatient(ctx, p.id);
    // Letterhead: the registering hospital's address and contact details (where the caller may read them).
    const hospital = await HospitalService.get(ctx, p.hospitalId).catch(() => null);
    // Contact details are shown to the registering hospital and the patient only (as on the patient page).
    const showContact = ctx.principal.orgType === "hospital" || ctx.principal.orgType === "platform";
    const pdf = await buildPatientSheet({
      hospital: { name: hospitalName, registrationNo: hospital?.hospital.registrationNo, address: hospital?.hospital.address, city: hospital?.hospital.city, state: hospital?.hospital.state, phone: hospital?.hospital.phone, email: hospital?.hospital.email },
      details: [
        ["Patient number", p.patientNo],
        ["Name", p.fullName],
        ["Department", departmentLabel(p.department)],
        ["Reason for Visit", p.visitReason ?? NO_VISIT_REASON],
        ["Date of birth", `${formatDate(p.dob)} (${ageOn(p.dob)} years)`],
        ["Gender", GENDER_LABEL[p.gender]],
        ["Registered", formatDateTime(p.createdAt)],
        ...(showContact ? ([["Mobile", p.phone], ["Email", p.email]] as [string, string | null][]) : []),
      ],
      coverage: coverage.map((c) => ({
        policy: c.policyName,
        payer: c.category === "government" ? c.schemeName : c.insurerName,
        memberId: c.memberId,
        relationship: RELATIONSHIP_LABEL[c.relationship as keyof typeof RELATIONSHIP_LABEL] ?? c.relationship,
        period: `${formatDate(c.coverStart)} - ${formatDate(c.coverEnd)}`,
        sumInsured: formatINR(c.sumInsured),
        available: formatINR(c.sumInsuredAvailable),
      })),
      generatedAt: formatDateTime(new Date()),
      generatedBy: user.fullName,
    });
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="patient-${p.patientNo.replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    logger.error("patient_export_failed", { error: e });
    return new Response("Something went wrong.", { status: 500 });
  }
}
