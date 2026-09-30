import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { param } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { ReasonService } from "@/modules/reasons/reasons.service";
import { RejectionReasonCard } from "@/components/claims/RejectionReasonCard";
import { ButtonLink } from "@/components/ui/Button";
import { FilterBar } from "@/components/ui/DataTable";
import { Alert, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Tabs";
import styles from "./reasons.module.css";

export const metadata: Metadata = { title: "Query & rejection reasons · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ReasonsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("policy:read");
  const sp = await searchParams;
  const q = param(sp, "q")?.slice(0, 100);
  const kindParam = param(sp, "kind");
  const kind = kindParam === "query" || kindParam === "rejection" ? kindParam : undefined;
  const reasons = await ReasonService.list(ctx, { q, kind });
  const canEdit = can(ctx.principal, "policy:manage");
  const href = (k?: string) => `/rejection-reasons${k ? `?kind=${k}` : ""}`;

  return (
    <>
      <PageHeader title="Query & rejection reasons" description="What each common reason means, what to check, and what to do next." />
      <Stack>
        <Alert tone="info">
          This is general guidance. A claim or pre-auth is only rejected when the payer&apos;s recorded response says so — always read the payer&apos;s own remarks on the request.
        </Alert>
        <Segmented current={kind ?? "all"} items={[{ key: "all", label: "All", href: href() }, { key: "query", label: "Queries", href: href("query") }, { key: "rejection", label: "Rejections", href: href("rejection") }]} />
        <Card padded={false}>
          <FilterBar basePath="/rejection-reasons" q={q} searchLabel="Search reasons">
            {kind && <input type="hidden" name="kind" value={kind} />}
          </FilterBar>
        </Card>
        {reasons.length === 0 ? (
          <Card><EmptyState title="No reasons match" /></Card>
        ) : (
          <div className={styles.grid}>
            {reasons.map((r) => (
              <RejectionReasonCard
                key={r.id}
                title={r.title}
                kind={r.kind}
                meaning={r.meaning}
                whatToCheck={r.whatToCheck}
                requiredAction={r.requiredAction}
                actions={canEdit ? <ButtonLink size="sm" variant="ghost" href={`/rejection-reasons/${r.id}/edit`}>Edit</ButtonLink> : undefined}
              />
            ))}
          </div>
        )}
      </Stack>
    </>
  );
}
