import { z } from "zod";
import { zOptionalText } from "@/lib/validation";

export const DOCUMENT_REVIEW_STATUSES = ["verified", "rejected", "requires_reupload"] as const;

export const documentReviewSchema = z
  .object({
    status: z.enum(DOCUMENT_REVIEW_STATUSES, { message: "Choose an outcome." }),
    note: zOptionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.status !== "verified" && (!v.note || v.note.length < 5)) ctx.addIssue({ code: "custom", path: ["note"], message: "Tell the hospital what is wrong." });
  });

export type DocumentReviewInput = z.input<typeof documentReviewSchema>;
