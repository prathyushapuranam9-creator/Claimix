import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { param, parseListQuery } from "@/lib/pagination";
import { InboxService } from "@/modules/notifications/inbox.service";
import { NotificationList } from "@/components/notifications/NotificationList";
import { Pagination } from "@/components/ui/DataTable";
import { Card, PageHeader } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";
import { markReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function NotificationsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("notification:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const unreadOnly = param(sp, "show") === "unread";
  const data = await InboxService.list(ctx, q, unreadOnly);
  return (
    <>
      <PageHeader title="Notifications" description="Decisions, queries, document requests and reminders for you." />
      <Segmented current={unreadOnly ? "unread" : "all"} items={[{ key: "all", label: "All", href: "/notifications" }, { key: "unread", label: "Unread", href: "/notifications?show=unread" }]} />
      <Card padded={false}>
        <NotificationList items={data.rows} markRead={markReadAction} />
        {data.total > q.pageSize && <Pagination basePath="/notifications" params={{ show: unreadOnly ? "unread" : undefined }} page={q.page} pageSize={q.pageSize} total={data.total} />}
      </Card>
    </>
  );
}
