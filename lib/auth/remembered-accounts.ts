/**
 * Accounts that signed in successfully on this device, for the sign-in suggestions.
 * Only email addresses are kept (never passwords): passwords stay in the browser's
 * password manager. Every access is guarded, since storage can be blocked or cleared.
 */
const KEY = "claimix.rememberedAccounts";
const MAX = 5;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export interface RememberedAccount {
  email: string;
  lastUsedAt: number;
}

export function readRememberedAccounts(): RememberedAccount[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a): a is RememberedAccount => typeof a?.email === "string" && EMAIL.test(a.email) && typeof a.lastUsedAt === "number")
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberAccount(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL.test(normalized)) return;
  try {
    const others = readRememberedAccounts().filter((a) => a.email !== normalized);
    localStorage.setItem(KEY, JSON.stringify([{ email: normalized, lastUsedAt: Date.now() }, ...others].slice(0, MAX)));
  } catch {
    // Storage unavailable (private mode, blocked): suggestions simply won't appear.
  }
}

export function forgetRememberedAccounts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
