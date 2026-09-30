import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate, formatDateTime } from "@/lib/india";
import { todayIso } from "@/lib/validation";
import { RuleService } from "@/modules/rules/rules.service";
import { RuleEditor } from "@/components/policies/RuleEditor";
import { RuleList } from "@/components/policies/RuleList";
import { StartDraftButton } from "@/components/policies/StartDraftButton";
import { ButtonLink } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge, Card, PageHeader, Stack, type Tone } from "@/components/ui/Surface";
import { createDraftAction, deleteRuleAction, discardDraftAction, publishDraftAction, saveRuleAction } from "../../actions";

export const metadata: Metadata = { title: "Policy rules · Claimix" };

const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", retired: "neutral" };

export default async function PolicyRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("policy:manage");
  const { id } = await params;
  const o = await orNotFound(RuleService.overview(ctx, id));
  const p = o.policy.policy;

  return (
    <>
      <PageHeader
        title="Rules"
        description={<>{p.name} · rules are versioned; published versions are immutable.</>}
        actions={<ButtonLink href={`/policies/${p.id}`} variant="secondary">Back to policy</ButtonLink>}
      />
      <Stack>
        <Card title="Versions" padded={false}>
          <DataTable
            caption="Rule versions"
            rows={o.versions}
            rowKey={(v) => v.id}
            columns={[
              { key: "v", header: "Version", cell: (v) => `v${v.version}` },
              { key: "s", header: "Status", cell: (v) => <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge> },
              { key: "n", header: "Rules", align: "right", cell: (v) => v.ruleCount },
              { key: "e", header: "Effective from", nowrap: true, cell: (v) => formatDate(v.effectiveFrom) },
              { key: "u", header: "Last changed", nowrap: true, cell: (v) => formatDateTime(v.updatedAt) },
            ]}
          />
        </Card>
        {o.draft ? (
          <Card title={`Draft v${o.draft.version}`}>
            <RuleEditor
              rules={o.draft.rules}
              save={saveRuleAction.bind(null, p.id, o.draft.id)}
              remove={deleteRuleAction.bind(null, p.id)}
              publish={publishDraftAction.bind(null, p.id, o.draft.id)}
              discard={discardDraftAction.bind(null, p.id, o.draft.id)}
              today={todayIso()}
            />
          </Card>
        ) : (
          <Card title={o.active ? `Active v${o.active.version}` : "No rules yet"} actions={<StartDraftButton action={createDraftAction.bind(null, p.id)} hasActive={!!o.active} />}>
            <RuleList rules={o.active?.rules ?? []} empty="No published rules" />
          </Card>
        )}
      </Stack>
    </>
  );
}
