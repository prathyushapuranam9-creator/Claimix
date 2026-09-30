import { getDb } from "@/db/client";
import { getCurrentUser, requestMeta } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { csvCell } from "@/lib/csv";
import { logger } from "@/lib/logging/logger";
import { ClaimService } from "@/modules/claims/claims.service";
import { parseClaimFilters } from "@/modules/claims/claims.filters";
import { CLAIM_STATUS_LABEL } from "@/modules/claims/claims.workflow";

export const dynamic = "force-dynamic";

/** CSV of the caller's scoped claims, using exactly the list page's filters. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { filters } = parseClaimFilters(sp);
  try {
    const { rows, truncated } = await ClaimService.exportRows({ db: getDb(), principal: user.principal, meta: await requestMeta() }, { q: sp.q?.slice(0, 100) }, filters);
    const header = ["Claim ID", "Type", "Status", "Patient", "Policy", "Insurer", "TPA", "Scheme", "Hospital", "Diagnosis", "Treatment", "Admission", "Discharge", "Claim amount", "Approved", "Patient amount", "Query/rejection reason", "Documents", "Last updated"];
    const lines = rows.map((r) =>
      [r.reference, r.claimType, CLAIM_STATUS_LABEL[r.status], r.patientName, r.policyName, r.insurerName, r.tpaName, r.schemeName, r.hospitalName, r.diagnosisCode, r.procedureName, r.admissionDate, r.dischargeDate, r.claimedAmount, r.approvedAmount, r.patientAmount, r.lastReason, r.documentCount, r.updatedAt.toISOString()]
        .map(csvCell)
        .join(","),
    );
    if (truncated) lines.push(csvCell("Export limited to 5,000 rows — narrow the filters for the rest."));
    const body = "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n");
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="claims-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    logger.error("claims_export_failed", { error: e });
    return new Response("Something went wrong.", { status: 500 });
  }
}
