import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

import type { ActionResult } from "@/lib/action-result";

export type { ActionResult };

/**
 * Runs a server action body and converts failures into a safe result.
 * Known AppErrors carry user-facing messages; anything else is logged and
 * replaced with a generic message so internals are never exposed.
 */
export async function runAction<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    if (e instanceof ValidationError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    if (e instanceof AppError) return { ok: false, error: e.message };
    logger.error("action_failed", { action: name, error: e });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
