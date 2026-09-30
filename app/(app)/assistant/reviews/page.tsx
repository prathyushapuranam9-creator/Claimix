import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/india";
import { param } from "@/lib/pagination";
import { AssistantService } from "@/modules/assistant/assistant.service";
import { SimpleMessageForm } from "@/components/preauth/SimpleMessageForm";
import { Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";
import { respondReviewAction } from "../actions";
import styles from "./reviews.module.css";

export const metadata: Metadata = { title: "Human review · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ReviewsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("assistant:review");
  const sp = await searchParams;
  const status = param(sp, "status") === "answered" ? "answered" : "open";
  const rows = await AssistantService.reviews(ctx, status);
  const href = (t: string | null, id: string | null) => (t === "claim" ? `/claims/${id}` : t === "preauth" ? `/pre-authorizations/${id}` : null);

  return (
    <>
      <PageHeader title="Human review" description="Questions the assistant couldn't answer from the records. A colleague — not the person who asked — responds." />
      <Segmented current={status} items={[{ key: "open", label: "Open", href: "/assistant/reviews" }, { key: "answered", label: "Answered", href: "/assistant/reviews?status=answered" }]} />
      <Stack>
        {rows.length === 0 && <Card><EmptyState title={status === "open" ? "Nothing waiting for review" : "No answered reviews yet"} icon="✓" /></Card>}
        {rows.map(({ review: r, requesterName }) => {
          const link = href(r.subjectType, r.subjectId);
          return (
            <Card key={r.id} title={`“${r.question}”`}>
              <div className={styles.body}>
                <p className={styles.meta}>
                  Asked by {requesterName} · {formatDateTime(r.createdAt)}
                  {link && <> · <Link href={link}>Open request</Link></>}
                </p>
                <p><strong>Why it needs a person:</strong> {r.reason}</p>
                {r.status === "answered" ? (
                  <p className={styles.response}><strong>Response:</strong> {r.response}</p>
                ) : r.requestedBy === ctx.principal.userId ? (
                  <p className={styles.meta}>Waiting for a colleague to respond.</p>
                ) : (
                  <SimpleMessageForm action={respondReviewAction.bind(null, r.id)} label="Your response" button="Send response" hint="Base the answer on the payer's policy wording or confirmation; note any reference." />
                )}
              </div>
            </Card>
          );
        })}
      </Stack>
    </>
  );
}
