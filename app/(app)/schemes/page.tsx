import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/auth/context";
import { SchemeService } from "@/modules/schemes/schemes.service";
import { Alert, Card, PageHeader, Stack } from "@/components/ui/Surface";
import styles from "./schemes.module.css";

export const metadata: Metadata = { title: "Government schemes · Claimix" };

export default async function SchemesPage() {
  const ctx = await pageContext("policy:read");
  const schemes = await SchemeService.list(ctx);
  return (
    <>
      <PageHeader title="Government health schemes" description="Scheme eligibility is verified with the scheme itself and is separate from private insurance." />
      <Stack>
        <div className={styles.grid}>
          {schemes.map((s) => (
            <Card key={s.id}>
              <Link href={`/schemes/${s.id}`} className={styles.title}>{s.name}</Link>
              <p className={styles.authority}>{s.authority}</p>
              {s.description && <p className={styles.desc}>{s.description}</p>}
            </Card>
          ))}
        </div>
        <Alert tone="info" title="About ABDM / ABHA">
          The Ayushman Bharat Digital Mission (ABDM) and ABHA numbers are digital-health infrastructure for health records and identity. They are not an insurance scheme and do not by themselves provide any cover.
        </Alert>
      </Stack>
    </>
  );
}
