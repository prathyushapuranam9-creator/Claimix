import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { notifications } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { offsetOf, type ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";

/** Where a notification leads. Only known resource types become links. */
export function notificationHref(resourceType: string | null, resourceId: string | null): string | null {
  if (!resourceType || !resourceId) return null;
  switch (resourceType) {
    case "preauth": return `/pre-authorizations/${resourceId}`;
    case "claim": return `/claims/${resourceId}`;
    case "patient": return `/patients/${resourceId}`;
    case "review": return "/assistant/reviews";
    default: return null;
  }
}

/** Rows kept per request when viewing an organization's notifications in the testing context. */
const ORG_VIEW_LIMIT = 200;

/**
 * The signed-in user's own notifications. Every query is filtered by the
 * caller's user id — ids sent by the client are only used within that set.
 *
 * While an account is testing the insurance portal as an insurer / role (`principal.acting`), the inbox is instead a
 * READ-ONLY view of that organization's notifications (one entry per event, however many reviewers received it);
 * marking as read does nothing, so real reviewers' unread state is never changed from a test context.
 */
export const InboxService = {
  async list(ctx: ServiceContext, q: Pick<ListQuery, "page" | "pageSize">, unreadOnly: boolean) {
    requirePermission(ctx.principal, "notification:read");
    if (ctx.principal.acting) {
      const all = await orgNotifications(ctx, unreadOnly);
      const rows = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      return { rows: rows.map((r) => ({ ...r, href: notificationHref(r.resourceType, r.resourceId) })), total: all.length };
    }
    const where = and(eq(notifications.userId, ctx.principal.userId), unreadOnly ? isNull(notifications.readAt) : undefined);
    const [rows, [total]] = await Promise.all([
      ctx.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.pageSize).offset(offsetOf(q)),
      ctx.db.select({ n: count() }).from(notifications).where(where),
    ]);
    return { rows: rows.map((r) => ({ ...r, href: notificationHref(r.resourceType, r.resourceId) })), total: total?.n ?? 0 };
  },

  async unreadCount(ctx: ServiceContext) {
    if (!ctx.principal.permissions.has("notification:read")) return 0;
    if (ctx.principal.acting) return (await orgNotifications(ctx, true)).length;
    const [row] = await ctx.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, ctx.principal.userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  },

  /** Marks the given ids (or all) as read — only among the caller's own notifications. */
  async markRead(ctx: ServiceContext, ids: string[] | "all") {
    requirePermission(ctx.principal, "notification:read");
    if (ctx.principal.acting) return 0; // testing context: view only
    const valid = ids === "all" ? "all" : ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 200);
    if (valid !== "all" && valid.length === 0) return 0;
    const rows = await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.principal.userId), isNull(notifications.readAt), valid === "all" ? undefined : inArray(notifications.id, valid)))
      .returning({ id: notifications.id });
    return rows.length;
  },
};

/** The acting organization's notifications, newest first, one per event (each reviewer receives their own copy). */
async function orgNotifications(ctx: ServiceContext, unreadOnly: boolean) {
  const rows = await ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, ctx.principal.organizationId), unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(ORG_VIEW_LIMIT * 4);
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const key = `${r.kind}|${r.resourceType}|${r.resourceId}|${r.title}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .slice(0, ORG_VIEW_LIMIT);
}
