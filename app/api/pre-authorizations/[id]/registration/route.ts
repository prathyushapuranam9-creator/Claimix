import { getDb } from "@/db/client";
import { getCurrentUser, requestMeta } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { RegistrationService } from "@/modules/preauth/registration.service";

export const dynamic = "force-dynamic";

/** New Claim → Register Case → Download PDF: the case registration form, under the same access rules as the page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await params;
  try {
    const ctx = { db: getDb(), principal: user.principal, meta: await requestMeta() };
    const { pdf, reference } = await RegistrationService.pdf(ctx, id);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="case-registration-${reference.replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    logger.error("registration_pdf_failed", { error: e });
    return new Response("Something went wrong.", { status: 500 });
  }
}
