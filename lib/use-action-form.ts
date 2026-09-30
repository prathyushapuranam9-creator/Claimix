"use client";

import { useState } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { ActionResult } from "@/lib/action-result";

/**
 * Applies a server action's result to a react-hook-form form: server-side field
 * errors land on the matching inputs, anything else shows as a form-level alert.
 * The server re-validates everything; client validation is only for fast feedback.
 */
export function useServerResult<T extends FieldValues>(setError: UseFormSetError<T>) {
  const [formError, setFormError] = useState<string | null>(null);

  function apply<R>(result: ActionResult<R>): result is { ok: true; data: R } {
    if (result.ok) {
      setFormError(null);
      return true;
    }
    for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (field === "_form" || !messages[0]) continue;
      setError(field as Path<T>, { type: "server", message: messages[0] });
    }
    setFormError(result.error);
    return false;
  }

  return { formError, setFormError, apply };
}
