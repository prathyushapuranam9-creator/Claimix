import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";

/** Parses input with a schema or throws a ValidationError carrying per-field messages. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown, message = "Please fix the highlighted fields."): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ValidationError(message, fieldErrors);
  }
  return r.data;
}

/** Empty strings from HTML forms become undefined so optional fields stay optional. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const zUuid = z.string({ message: "Select an option." }).uuid("Select a valid option.");
export const zOptionalUuid = z.preprocess(blankToUndefined, z.string().uuid("Select a valid option.").optional());

export const zName = z
  .string()
  .trim()
  .min(2, "Enter at least 2 characters.")
  .max(200, "Keep this under 200 characters.")
  .regex(/^[\p{L}\p{M} .'()&,-]+$/u, "Use letters, spaces and basic punctuation only.");

export const zOptionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, `Keep this under ${max} characters.`).optional());

export const zOptionalEmail = z.preprocess(
  blankToUndefined,
  z.string().trim().toLowerCase().email("Enter a valid email address.").max(320).optional(),
);

/** Indian and international phone numbers: digits with optional +, spaces and hyphens. */
export const zOptionalPhone = z.preprocess(
  blankToUndefined,
  z.string().trim().regex(/^\+?[0-9][0-9 -]{7,18}[0-9]$/, "Enter a valid phone number, e.g. +91 98765 43210.").optional(),
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date as YYYY-MM-DD that actually exists. */
export const zDate = z
  .string()
  .regex(ISO_DATE, "Enter a date as YYYY-MM-DD.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Enter a real calendar date.");

export const zOptionalDate = z.preprocess(blankToUndefined, zDate.optional());

export const zPastDate = (label: string, maxYears = 120) =>
  zDate.refine((v) => v <= todayIso(), `${label} cannot be in the future.`).refine((v) => {
    const min = new Date();
    min.setUTCFullYear(min.getUTCFullYear() - maxYears);
    return v >= min.toISOString().slice(0, 10);
  }, `${label} is too far in the past.`);

/** Rupee amount, non-negative, max 2 decimals, below ₹100 crore. */
export const zMoney = z.coerce
  .number({ message: "Enter an amount in rupees." })
  .nonnegative("Amount cannot be negative.")
  .max(1_000_000_000, "Amount is too large.")
  .refine((n) => Math.round(n * 100) === n * 100, "Use at most 2 decimal places.");

export const zOptionalMoney = z.preprocess(blankToUndefined, zMoney.optional());

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route/record ids: anything that isn't a UUID is simply "not found" (never a DB error). */
export function requireId(id: unknown, what = "Record"): string {
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new NotFoundError(`${what} not found.`);
  return id;
}
