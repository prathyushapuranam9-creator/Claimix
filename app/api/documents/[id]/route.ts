import { getDb } from "@/db/client";
import { getCurrentUser, requestMeta } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { DocumentService } from "@/modules/documents/documents.service";

export const dynamic = "force-dynamic";

/** Private document download. Every request is authenticated, scoped and audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await params;
  try {
    const file = await DocumentService.download({ db: getDb(), principal: user.principal, meta: await requestMeta() }, id);
    const asciiName = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    // Out-of-scope and missing documents look the same (404) so existence isn't revealed.
    if (e instanceof AppError) return new Response(e.status === 403 ? "Not available." : "Not found.", { status: e.status === 403 ? 403 : e.status === 401 ? 401 : 404 });
    logger.error("document_download_failed", { error: e });
    return new Response("Something went wrong.", { status: 500 });
  }
}
