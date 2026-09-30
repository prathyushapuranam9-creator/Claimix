import "server-only";
import { notFound, redirect } from "next/navigation";
import { getDb, type Db } from "@/db/client";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import type { PermissionKey } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import type { RequestMeta } from "@/modules/audit/audit.service";
import { getCurrentUser, requestMeta, requirePagePermission } from "./session";

/** Everything an application service needs about the caller. */
export interface ServiceContext {
  db: Db;
  principal: Principal;
  meta: RequestMeta;
}

/** For server actions: throws UnauthorizedError (surfaced as a message) when signed out. */
export async function actionContext(): Promise<ServiceContext> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError("Your session has ended. Please sign in again.");
  return { db: getDb(), principal: user.principal, meta: await requestMeta() };
}

/** For pages: redirects to login / forbidden as needed. */
export async function pageContext(permission: PermissionKey) {
  const user = await requirePagePermission(permission);
  return { db: getDb(), principal: user.principal, meta: await requestMeta(), user };
}

/** Maps service errors to Next.js navigation (404 page / 403 page) inside server components. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) redirect("/forbidden");
    throw e;
  }
}
