"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import type { Answer } from "@/modules/assistant/answer";
import { AssistantService } from "@/modules/assistant/assistant.service";
import type { Focus, GuideReply } from "@/modules/assistant/guide";
import type { Intent } from "@/modules/assistant/intents";

export async function askAction(input: { subjectType: "preauth" | "claim"; subjectId: string; question: string; intent?: Intent }): Promise<ActionResult<Answer & { interactionId: string; explanation: string | null; llmNotice: string | null }>> {
  return runAction("assistant.ask", async () => AssistantService.ask(await actionContext(), input));
}

export async function guideAction(input: { question: string; history: { role: "user" | "assistant"; content: string }[]; focusId?: string | null }): Promise<ActionResult<GuideReply & { focus: Focus | null }>> {
  return runAction("assistant.guide", async () => AssistantService.guide(await actionContext(), input));
}

export async function requestReviewAction(input: { interactionId: string; note?: string }): Promise<ActionResult> {
  return runAction("assistant.request_review", async () => {
    await AssistantService.requestReview(await actionContext(), input);
    return undefined;
  });
}

export async function respondReviewAction(id: string, input: { message: string }): Promise<ActionResult> {
  const r = await runAction("assistant.respond_review", async () => {
    await AssistantService.respond(await actionContext(), id, { response: input.message });
    return undefined;
  });
  if (r.ok) revalidatePath("/assistant/reviews");
  return r;
}
