import type { Metadata } from "next";
import type { ReactNode } from "react";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { formatDate, formatINR } from "@/lib/india";
import { can } from "@/lib/permissions/principal";
import { PolicyService } from "@/modules/policies/policies.service";
import { POLICY_INFO_FIELDS, PRODUCT_TYPE_LABEL, type PolicyInfo, type PolicyInfoKey } from "@/modules/policies/policies.validation";
import type { RuleCategory } from "@/modules/rules/engine/types";
import { RuleList } from "@/components/policies/RuleList";
import { ButtonLink } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Details } from "@/components/ui/Form";
import { Alert, Badge, Card, PageHeader, Stack } from "@/components/ui/Surface";
import { LinkTabs } from "@/components/ui/Tabs";
import styles from "./policy.module.css";

export const metadata: Metadata = { title: "Policy · Claimix" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "eligibility", label: "Eligibility" },
  { key: "coverage", label: "Coverage" },
  { key: "waiting", label: "Waiting period" },
  { key: "ped", label: "PED" },
  { key: "exclusions", label: "Exclusions" },
  { key: "limits", label: "Limits" },
  { key: "hospitals", label: "Hospitals" },
  { key: "documents", label: "Documents" },
  { key: "preauth", label: "Pre-auth" },
  { key: "claims", label: "Claims" },
  { key: "renewal", label: "Renewal" },
  { key: "contact", label: "Contact" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext("policy:read");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "overview";
  const p = await orNotFound(PolicyService.get(ctx, id));
  const policy = p.policy;
  const info = policy.info as PolicyInfo;
  const rules = p.active?.rules ?? [];
  const byCat = (...cats: RuleCategory[]) => rules.filter((r) => cats.includes(r.category));
  const isScheme = policy.category === "government";

  const infoBlock = (...keys: PolicyInfoKey[]) =>
    keys
      .filter((k) => info[k])
      .map((k) => (
        <div key={k} className={styles.info}>
          <h3>{POLICY_INFO_FIELDS[k]}</h3>
          <p>{info[k]}</p>
        </div>
      ));

  const section = (title: string, body: ReactNode) => <Card title={title}>{body}</Card>;

  const content: Record<TabKey, ReactNode> = {
    overview: (
      <Stack>
        <Card title="At a glance">
          <Details
            columns={3}
            items={[
              ["Type", PRODUCT_TYPE_LABEL[policy.productType] ?? policy.productType],
              [isScheme ? "Scheme" : "Insurer", isScheme ? p.schemeName : p.insurerName],
              [isScheme ? "Authority" : "TPA", isScheme ? p.schemeAuthority : (p.tpaName ?? "None (insurer handles claims)")],
              ["Sum insured", policy.sumInsuredMax ? (policy.sumInsuredMin === policy.sumInsuredMax ? formatINR(policy.sumInsuredMax) : `${formatINR(policy.sumInsuredMin)} – ${formatINR(policy.sumInsuredMax)}`) : "As per scheme"],
              ["Rules in force", p.active ? `Version ${p.active.version.version} from ${formatDate(p.active.version.effectiveFrom)}` : "None published"],
              ["Rule checks", `${rules.length} configured`],
            ]}
          />
          {policy.summary && <p className={styles.summary}>{policy.summary}</p>}
        </Card>
        {!p.active && <Alert tone="warning" title="No published rules">Eligibility checks for this policy will always need manual verification until rules are published.</Alert>}
        <Alert tone="info" title="Remember">
          An active policy or an insurance card does not mean the whole bill will be paid. Cashless does not mean zero payment by the patient, and a pre-authorization approval is not the final settlement.
        </Alert>
      </Stack>
    ),
    eligibility: (
      <Stack>
        {section("Eligibility rules", <RuleList rules={byCat("eligibility").filter((r) => (r.config as { kind?: string }).kind !== "hospital_network")} empty="No eligibility rules published" />)}
        {infoBlock("eligibilityNotes", "beneficiaryVerification").length > 0 && section("Notes", infoBlock("eligibilityNotes", "beneficiaryVerification"))}
      </Stack>
    ),
    coverage: (
      <Stack>
        {section("Covered treatments", <RuleList rules={byCat("coverage")} empty="No coverage rules published" />)}
        {p.packages.length > 0 &&
          section(
            "Packages",
            <DataTable
              caption="Packages"
              rows={p.packages}
              rowKey={(x) => x.id}
              columns={[
                { key: "code", header: "Code", cell: (x) => <span className="mono">{x.code}</span> },
                { key: "name", header: "Package", cell: (x) => x.name },
                { key: "rate", header: "Package rate", align: "right", cell: (x) => formatINR(x.rate) },
              ]}
            />,
          )}
        {infoBlock("packageRules").length > 0 && section("Package rules", infoBlock("packageRules"))}
      </Stack>
    ),
    waiting: section("Waiting periods", <RuleList rules={byCat("waiting_period")} empty="No waiting-period rules published" />),
    ped: (
      <Stack>
        {section("Pre-existing diseases (PED)", <RuleList rules={byCat("ped")} empty="No PED rules published" />)}
        <Alert tone="warning">A condition that existed before the policy started but was not declared can lead to rejection even after waiting periods.</Alert>
      </Stack>
    ),
    exclusions: section("Exclusions", <RuleList rules={byCat("exclusion")} empty="No exclusion rules published" />),
    limits: section("Limits, co-pay and deductibles", <RuleList rules={byCat("limit")} empty="No limit rules published" />),
    hospitals: (
      <Stack>
        {section("Hospital requirement", <RuleList rules={byCat("eligibility").filter((r) => (r.config as { kind?: string }).kind === "hospital_network")} empty="No hospital rule published" />)}
        <Card title="Find hospitals">
          <ButtonLink href={isScheme ? `/hospitals?scheme=${policy.schemeId}` : `/hospitals?insurer=${policy.insurerId}`} variant="secondary">
            {isScheme ? "Empanelled hospitals for this scheme" : "Network hospitals for this insurer"}
          </ButtonLink>
        </Card>
      </Stack>
    ),
    documents: section("Required documents", <RuleList rules={byCat("document")} empty="No document rules published" />),
    preauth: (
      <Stack>
        {section("Pre-authorization", <RuleList rules={byCat("preauth")} empty="No pre-authorization rules published" />)}
        {infoBlock("preauthProcess", "cashless").length > 0 && section("Process", infoBlock("preauthProcess", "cashless"))}
      </Stack>
    ),
    claims: (
      <Stack>
        {section("Claim rules", <RuleList rules={byCat("claim")} empty="No claim rules published" />)}
        {infoBlock("claimProcess", "reimbursement", "patientResponsibilities").length > 0 && section("Process", infoBlock("claimProcess", "reimbursement", "patientResponsibilities"))}
        <Card title="Common query and rejection reasons">
          <ButtonLink href="/rejection-reasons" variant="secondary">What each reason means and what to do</ButtonLink>
        </Card>
      </Stack>
    ),
    renewal: section("Renewal", infoBlock("renewal").length ? infoBlock("renewal") : <p>No renewal information recorded.</p>),
    contact: section("Contact", infoBlock("contact").length ? infoBlock("contact") : <p>No contact information recorded.</p>),
  };

  return (
    <>
      <PageHeader
        title={policy.name}
        description={
          <>
            {isScheme ? <Badge tone="info">Government scheme</Badge> : <Badge tone="neutral">Private insurance</Badge>} {isScheme ? p.schemeName : p.insurerName}{" "}
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
      <LinkTabs basePath={`/policies/${policy.id}`} tabs={[...TABS]} current={tab} label="Policy sections" />
      <Stack>
        {content[tab]}
        <Disclaimer compact />
      </Stack>
    </>
  );
}
