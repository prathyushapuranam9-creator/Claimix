import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { env } from "@/lib/config/env";
import { requirePermission } from "@/lib/permissions/principal";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { createAuthService, type SessionUser } from "@/modules/auth/auth.service";
import type { RequestMeta } from "@/modules/audit/audit.service";
import { clientIp } from "@/lib/security/client-ip";

/** Next.js adapter around AuthService: cookie handling and per-request caching only. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-claimix_session" : "claimix_session";

export function authService() {
  const e = env();
  return createAuthService(getDb(), { secret: e.SESSION_SECRET, appUrl: e.APP_URL });
}

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    // Only proxy-appended entries are trusted (see TRUSTED_PROXY_HOPS); client-set values are ignored.
    ipAddress: clientIp(h.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS),
    userAgent: h.get("user-agent"),
    requestId: h.get("x-request-id"),
  };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * The insurance-portal testing context (signed, tied to this session, re-validated on every request). It only has an
 * effect for the one kind of account that holds `insurance:context`; for everyone else the cookie is simply ignored.
 */
export const CONTEXT_COOKIE = process.env.NODE_ENV === "production" ? "__Host-claimix_context" : "claimix_context";

export async function contextToken(): Promise<string | undefined> {
  return (await cookies()).get(CONTEXT_COOKIE)?.value;
}

export async function setContextCookie(value: string) {
  (await cookies()).set(CONTEXT_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
}

export async function clearContextCookie() {
  // `__Host-` cookies are only changed by a response that carries the same attributes (incl. Secure), so expire it explicitly.
  (await cookies()).set(CONTEXT_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

/** The current user for this request (memoized per request), or null. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // Read the cookie first: it marks the render as dynamic (never prerendered at build,
  // where no configuration exists) and lets signed-out requests skip the database.
  const token = await sessionToken();
  if (!token) return null;
  return authService().resolve(token, await contextToken());
});

/** For pages: redirects to login when there is no valid session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirects to /forbidden when the permission is missing. */
export async function requirePagePermission(key: PermissionKey): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.principal.permissions.has(key)) redirect("/forbidden");
  requirePermission(user.principal, key);
  return user;
}
