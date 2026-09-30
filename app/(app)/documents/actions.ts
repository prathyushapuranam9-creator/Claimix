"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { DocumentService } from "@/modules/documents/documents.service";
import type { DocumentReviewInput } from "@/modules/documents/documents.validation";

export async function reviewDocumentAction(docId: string, input: DocumentReviewInput): Promise<ActionResult> {
  const r = await runAction("document.review", async () => {
    await DocumentService.review(await actionContext(), docId, input);
    return undefined;
  });
  // The document can sit on a pre-auth or claim page; refresh all views.
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
