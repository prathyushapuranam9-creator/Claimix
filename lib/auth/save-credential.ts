/**
 * Offers to save a successful sign-in in the browser's own password manager via the
 * Credential Management API (Chromium: shows "Save password?"). Claimix never stores
 * passwords itself: the browser keeps them encrypted and later suggests them in its
 * native autocomplete dropdown on the email/password fields.
 *
 * Called only after the server has accepted the login, so wrong passwords are never offered.
 * Browsers without the API (e.g. Firefox, Safari) rely on their form-submission heuristics.
 */
type PasswordCredentialCtor = new (data: { id: string; password: string; name?: string }) => Credential;
type SavedPassword = Credential & { id: string; password?: string };

/**
 * Asks the browser's password manager for a saved login (Credential Management API).
 * The browser decides what to reveal and may ask the user to confirm the account; the
 * password goes straight into the masked field and is never stored by Claimix.
 * Returns null where unsupported, dismissed, or nothing is saved.
 */
export async function requestSavedLogin(): Promise<{ email: string; password: string } | null> {
  if (typeof window === "undefined" || !("PasswordCredential" in window) || !navigator.credentials?.get) return null;
  try {
    const credential = (await navigator.credentials.get({ password: true, mediation: "optional" } as CredentialRequestOptions)) as SavedPassword | null;
    return credential?.id && credential.password ? { email: credential.id, password: credential.password } : null;
  } catch {
    return null;
  }
}

export async function offerToSaveLogin(email: string, password: string, timeoutMs = 1500): Promise<void> {
  if (typeof window === "undefined" || !email || !password) return;
  const Ctor = (window as unknown as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;
  if (!Ctor || !navigator.credentials?.store) return;
  try {
    const credential = new Ctor({ id: email, password, name: email });
    // Never hold up navigation waiting on the browser's prompt.
    await Promise.race([navigator.credentials.store(credential), new Promise((r) => setTimeout(r, timeoutMs))]);
  } catch {
    // Unsupported, blocked by policy, or dismissed: sign-in continues normally.
  }
}
