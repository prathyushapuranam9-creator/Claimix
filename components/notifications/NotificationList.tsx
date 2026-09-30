"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/india";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Surface";
import styles from "./NotificationList.module.css";

interface Item {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  createdAt: Date;
  readAt: Date | null;
  href: string | null;
}

/** Notification panel: read/unread state, open (marks read), mark all read. */
export function NotificationList({ items, markRead }: { items: Item[]; markRead: (ids: string[] | "all") => Promise<ActionResult<number>> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = items.filter((i) => !i.readAt).length;
  if (!items.length) return <EmptyState title="You're all caught up" icon="✓">New decisions, queries and reminders will appear here.</EmptyState>;

  const open = (i: Item) =>
    start(async () => {
      if (!i.readAt) await markRead([i.id]);
      if (i.href) router.push(i.href);
      else router.refresh();
    });

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span>{unread} unread</span>
        <Button size="sm" variant="secondary" disabled={!unread} loading={pending} onClick={() => start(async () => { await markRead("all"); router.refresh(); })}>Mark all as read</Button>
      </div>
      <ul className={styles.list}>
        {items.map((i) => (
          <li key={i.id} className={styles.item} data-unread={!i.readAt}>
            <span className={styles.dot} aria-hidden="true" />
            <div className={styles.body}>
              {i.href ? (
                <Link href={i.href} className={styles.title} onClick={(e) => { e.preventDefault(); open(i); }}>
                  {i.title}
                  {!i.readAt && <span className="visually-hidden"> (unread)</span>}
                </Link>
              ) : (
                <p className={styles.title}>{i.title}{!i.readAt && <span className="visually-hidden"> (unread)</span>}</p>
              )}
              {i.body && <p className={styles.text}>{i.body}</p>}
              <time className={styles.time}>{formatDateTime(i.createdAt)}</time>
            </div>
            {!i.readAt && !i.href && (
              <Button size="sm" variant="ghost" onClick={() => open(i)}>Mark read</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
