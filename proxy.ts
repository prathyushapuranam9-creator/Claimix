import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["claimix_session", "__Host-claimix_session"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Edge-level concerns only: request ids, an optimistic redirect for visitors with
 * no session cookie, and an Origin check for mutating API routes (CSRF).
 * Real authentication and authorization happen server-side in every page/action.
 */
export function proxy(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/") && MUTATING.has(req.method) && !sameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const isAppRoute = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isAppRoute && !SESSION_COOKIES.some((c) => req.cookies.has(c))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Authenticated areas (kept in sync with app/(app)). */
const APP_PREFIXES = [
  "/dashboard", "/patients", "/hospitals", "/eligibility", "/policies", "/insurers", "/tpas", "/schemes", "/pre-authorizations", "/claims",
  "/documents", "/rejection-reasons", "/notifications", "/assistant", "/reports", "/audit", "/admin", "/review",
];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
