import "server-only";
import { env } from "@/lib/config/env";
import { aadhaarDigits } from "@/lib/india";
import { hmacHex } from "@/lib/security/crypto";

/**
 * Aadhaar is never stored or logged in full. A keyed hash (HMAC-SHA256 with the server secret) allows exact lookups,
 * and the last 4 digits allow the masked display and a last-4 partial search; the full number can't be recovered.
 */
export function aadhaarHash(v: string): string {
  return hmacHex(`aadhaar:${aadhaarDigits(v)}`, env().SESSION_SECRET);
}

export function aadhaarColumns(v: string | undefined): { aadhaarHash: string; aadhaarLast4: string } | null {
  if (!v) return null;
  const d = aadhaarDigits(v);
  return { aadhaarHash: aadhaarHash(d), aadhaarLast4: d.slice(-4) };
}
