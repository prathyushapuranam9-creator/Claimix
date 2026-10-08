import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions/principal";
import { ClaimService } from "@/modules/claims/claims.service";
import { InsurerService } from "@/modules/insurers/insurers.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { OrgActiveToggle } from "@/components/admin/OrgActiveToggle";
import { ButtonLink } from "@/components/ui/Button";
import { Badge, Card, PageHeader, Stack } from "@/components/ui/Surface";
import { setOrganizationActiveAction } from "../../admin/actions";
import styles from "../insurers.module.css";

export const metadata: Metadata = { title: "Insurer · Claimix" };

/** "Aarogya Shield General Insurance (DEMO DATA)" → "AS": first letters of the first two words of the name. */
function initials(name: string) {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

const icon = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const PHONE = icon(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />);
const MAIL = icon(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>);
const GLOBE = icon(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></>);
const ARROW = icon(<path d="M5 12h14M13 6l6 6-6 6" />);

export default async function InsurerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("insurer:read");
  const { id } = await params;
  const x = await orNotFound(InsurerService.get(ctx, id));
  const insurerId = x.insurer.id;
  const canPolicies = can(ctx.principal, "policy:read");
  const canPreauths = can(ctx.principal, "preauth:read");
  const canClaims = can(ctx.principal, "claim:read");
  const one = { page: 1, pageSize: 5 };

  // Real figures, each within what this viewer may see (a payer only counts its own products and cases).
  const [policies, activePolicies, networkHospitals, preauths, claims] = await Promise.all([
    canPolicies ? PolicyService.list(ctx, one, { insurerId }).then((r) => r.total) : null,
    canPolicies ? PolicyService.list(ctx, one, { insurerId, activeOnly: true }).then((r) => r.total) : null,
    InsurerService.networkHospitalCount(ctx, insurerId),
    canPreauths ? PreauthService.list(ctx, one, { insurerId }).then((r) => r.total) : null,
    canClaims ? ClaimService.list(ctx, one, { insurerId }).then((r) => r.total) : null,
  ]);

  const metrics: { label: string; value: number; href?: string }[] = [
    ...(policies !== null ? [{ label: "Policies", value: policies, href: `/policies?insurer=${insurerId}` }] : []),
    ...(activePolicies !== null ? [{ label: "Active policies", value: activePolicies, href: `/policies?insurer=${insurerId}` }] : []),
    { label: "Network hospitals", value: networkHospitals, href: `/hospitals?insurer=${insurerId}` },
    ...(preauths !== null ? [{ label: "Pre-authorizations", value: preauths, href: `/pre-authorizations?view=all&insurer=${insurerId}` }] : []),
    ...(claims !== null ? [{ label: "Claims", value: claims, href: `/claims?view=all&insurer=${insurerId}` }] : []),
  ];

  const { claimsPhone, claimsEmail, website } = x.insurer;
  return (
    <>
      <PageHeader
        leading={<span className={styles.avatar} aria-hidden="true">{initials(x.name)}</span>}
        title={x.name}
        description={<>Insurance company · <span className="mono">{x.insurer.code}</span> {x.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>}</>}
        actions={
          <>
            {can(ctx.principal, "insurer:manage") && <ButtonLink href={`/insurers/${insurerId}/edit`} variant="secondary">Edit</ButtonLink>}
            {can(ctx.principal, "organization:manage") && (
              <OrgActiveToggle active={x.isActive} name={x.name} action={setOrganizationActiveAction.bind(null, insurerId, !x.isActive, `/insurers/${insurerId}`)} />
            )}
          </>
        }
      />
      <Stack>
        <Card title="Contact">
          <dl className={styles.contacts}>
            <div className={styles.contact}>
              <span className={styles.contactIcon}>{PHONE}</span>
              <div>
                <dt>Claims helpline</dt>
                <dd>{claimsPhone ? <a href={`tel:${claimsPhone.replace(/[^\d+]/g, "")}`}>{claimsPhone}</a> : "—"}</dd>
              </div>
            </div>
            <div className={styles.contact}>
              <span className={styles.contactIcon}>{MAIL}</span>
              <div>
                <dt>Email</dt>
                <dd>{claimsEmail ? <a href={`mailto:${claimsEmail}`}>{claimsEmail}</a> : "—"}</dd>
              </div>
            </div>
            <div className={styles.contact}>
              <span className={styles.contactIcon}>{GLOBE}</span>
              <div>
                <dt>Website</dt>
                <dd>{website ? <a href={website} target="_blank" rel="noopener noreferrer">{website.replace(/^https?:\/\//, "")}</a> : "—"}</dd>
              </div>
            </div>
          </dl>
        </Card>

        <Card title="Summary">
          <div className={styles.metrics}>
            {metrics.map((m) =>
              m.href ? (
                <Link key={m.label} href={m.href} className={styles.metric}>
                  <span className={styles.metricValue}>{m.value.toLocaleString("en-IN")}</span>
                  <span className={styles.metricLabel}>{m.label}</span>
                </Link>
              ) : (
                <div key={m.label} className={styles.metric}>
                  <span className={styles.metricValue}>{m.value.toLocaleString("en-IN")}</span>
                  <span className={styles.metricLabel}>{m.label}</span>
                </div>
              ),
            )}
          </div>
        </Card>

        <Card title="Quick navigation">
          <div className={styles.actions}>
            <ButtonLink href={`/hospitals?insurer=${insurerId}`}>
              <span className={styles.actionIcon} aria-hidden="true">{ARROW}</span>
              View network hospitals
            </ButtonLink>
            {canPolicies && (
              <ButtonLink href={`/policies?insurer=${insurerId}`} variant="secondary">
                Associated policies
              </ButtonLink>
            )}
            {canClaims && (
              <ButtonLink href={`/claims?view=all&insurer=${insurerId}`} variant="secondary">
                Claims
              </ButtonLink>
            )}
          </div>
        </Card>
      </Stack>
    </>
  );
}
