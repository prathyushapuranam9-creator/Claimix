import { getDb } from "@/db/client";
import { getCurrentUser, requestMeta } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { csvCell } from "@/lib/csv";
import { CLAIM_STATUS_LABEL, type ClaimStatus } from "@/modules/claims/claims.workflow";
import { STATUS_LABEL, type PreauthStatus } from "@/modules/preauth/preauth.workflow";
import { parseRange, ReportService } from "@/modules/reports/reports.service";

export const dynamic = "force-dynamic";

/** CSV of the reports overview (aggregates only — no patient-level rows), scoped exactly like the page. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const range = parseRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  try {
    const d = await ReportService.overview({ db: getDb(), principal: user.principal, meta: await requestMeta() }, range);
    const rows: unknown[][] = [["Section", "Item", "Measure", "Value"]];
    for (const [s, n] of Object.entries(d.preauthStatus ?? {})) rows.push(["Pre-authorizations by status", STATUS_LABEL[s as PreauthStatus] ?? s, "Count", n]);
    for (const [s, n] of Object.entries(d.claimStatus ?? {})) rows.push(["Claims by status", CLAIM_STATUS_LABEL[s as ClaimStatus] ?? s, "Count", n]);
    for (const f of d.financials) {
      for (const [k, label] of [["claims", "Claims"], ["claimed", "Claimed (INR)"], ["approved", "Approved (INR)"], ["patient", "Patient share (INR)"], ["settled", "Settled paid (INR)"]] as const) {
        rows.push(["Financial summary", f.claimType, label, f[k]]);
      }
    }
    for (const m of d.monthly) {
      rows.push(["Claims per month", m.month, "Submitted", m.n], ["Claims per month", m.month, "Claimed (INR)", m.claimed], ["Claims per month", m.month, "Approved (INR)", m.approved]);
    }
    for (const [label, t] of [["Pre-authorizations", d.preauthTat], ["Claims", d.claimTat]] as const) {
      if (!t) continue;
      rows.push(["Turnaround", label, "Median hours", t.medianHours?.toFixed(1) ?? ""], ["Turnaround", label, "Average hours", t.avgHours?.toFixed(1) ?? ""], ["Turnaround", label, "Decided", t.decided], ["Turnaround", label, "Awaiting", t.awaiting]);
    }
    for (const x of d.reasons) rows.push(["Top reasons", x.title, "Queries", x.queries], ["Top reasons", x.title, "Rejections", x.rejections]);
    const body = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="claimix-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    logger.error("report_export_failed", { error: e });
    return new Response("Something went wrong.", { status: 500 });
  }
}
