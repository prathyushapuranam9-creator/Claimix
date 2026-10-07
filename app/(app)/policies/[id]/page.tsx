import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { PolicyService } from "@/modules/policies/policies.service";
import { POLICY_TABS, PolicyDisclaimer, policySections, type PolicyTabKey } from "@/components/policies/PolicySections";
import { ButtonLink } from "@/components/ui/Button";
import { Badge, PageHeader, Stack } from "@/components/ui/Surface";
import { LinkTabs } from "@/components/ui/Tabs";

export const metadata: Metadata = { title: "Policy · Claimix" };

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext("policy:read");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: PolicyTabKey = POLICY_TABS.some((t) => t.key === rawTab) ? (rawTab as PolicyTabKey) : "overview";
  const p = await orNotFound(PolicyService.get(ctx, id));
  const policy = p.policy;
  const isScheme = policy.category === "government";
  const content = policySections(p);

  return (
    <>
      <PageHeader
        title={policy.name}
        description={
          <>
            {/* Category as a pill; the insurer (or scheme) as quieter secondary text. */}
            {isScheme ? <Badge tone="neutral">Government scheme</Badge> : <Badge tone="info">Private insurance</Badge>} {isScheme ? p.schemeName : p.insurerName}{" "}
            {!policy.isActive && <Badge tone="danger">Withdrawn</Badge>}
          </>
        }
        actions={
          can(ctx.principal, "policy:manage") && (
            <>
              <ButtonLink href={`/policies/${policy.id}/edit`} variant="secondary">Edit details</ButtonLink>
              <ButtonLink href={`/policies/${policy.id}/rules`}>Manage rules</ButtonLink>
            </>
          )
        }
      />
      <LinkTabs basePath={`/policies/${policy.id}`} tabs={[...POLICY_TABS]} current={tab} label="Policy sections" />
      <Stack>
        {content[tab]}
        <PolicyDisclaimer />
      </Stack>
    </>
  );
}
