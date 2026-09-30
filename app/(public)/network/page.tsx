import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { parsePublicPayer, PublicNetworkService } from "@/modules/public/public-network.service";
import { Button } from "@/components/ui/Button";
import { CellText, DataTable, Pagination } from "@/components/ui/DataTable";
import { SelectField, TextField } from "@/components/ui/Field";
import { Alert, Badge, EmptyState } from "@/components/ui/Surface";
import s from "../content.module.css";

export const metadata: Metadata = { title: "Hospital network search · Claimix" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PublicNetworkPage({ searchParams }: { searchParams: SP }) {
  const db = getDb();
  const sp = await searchParams;
  const payer = parsePublicPayer(param(sp, "payer"));
  const q = parseListQuery({ ...sp, pageSize: "20" });
  const [payers, cities] = await Promise.all([
    PublicNetworkService.payers(db),
    payer ? PublicNetworkService.cities(db, payer) : Promise.resolve([]),
  ]);
  const cityParam = param(sp, "city");
  const city = cities.some((c) => c.city === cityParam) ? cityParam : undefined;
  const data = payer ? await PublicNetworkService.search(db, payer, q, city) : undefined;
  const payerValue = payer ? `${payer.kind}:${payer.id}` : "";
  const isScheme = payer?.kind === "scheme";

  return (
    <>
      <section className={s.hero}>
        <h1>Find a network hospital</h1>
        <p className={s.lead}>Choose an insurer or a government scheme, then a city.</p>
        <form role="search" method="get" action="/network" className={s.searchRow}>
          <SelectField label="Insurance or scheme" name="payer" defaultValue={payerValue} required>
            <option value="">Choose…</option>
            <optgroup label="Private insurers">
              {payers.insurers.map((p) => <option key={p.id} value={`insurer:${p.id}`}>{p.name}</option>)}
            </optgroup>
            <optgroup label="Government schemes">
              {payers.schemes.map((p) => <option key={p.id} value={`scheme:${p.id}`}>{p.name}</option>)}
            </optgroup>
          </SelectField>
          <SelectField label="City" name="city" defaultValue={city ?? ""} disabled={!payer} hint={payer ? undefined : "Choose a payer first"}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={`${c.city}|${c.state}`} value={c.city}>{c.city}, {c.state}</option>)}
          </SelectField>
          <TextField label="Hospital name" name="q" type="search" defaultValue={q.q} maxLength={100} disabled={!payer} />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </section>

      <Alert tone="info" title="Always confirm before admission">
        Network status changes. Confirm cashless availability with the insurer, TPA or scheme before admission. Listings here are fictional DEMO DATA.
      </Alert>

      <section className={s.section} aria-labelledby="results-heading">
        <h2 id="results-heading">{isScheme ? "Empanelled hospitals" : "Network hospitals"}</h2>
        {!data ? (
          <EmptyState title="Choose an insurer or scheme to see hospitals" />
        ) : (
          <>
            <DataTable
              caption={isScheme ? "Empanelled hospitals" : "Network hospitals"}
              rows={data.rows}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No hospitals found">Try another city or clear the name search.</EmptyState>}
              columns={[
                { key: "name", header: "Hospital", cell: (r) => r.name },
                { key: "loc", header: "Location", cell: (r) => <CellText sub={r.state}>{r.city}</CellText> },
                {
                  key: "status",
                  header: "Status",
                  cell: (r) => (
                    <>
                      <Badge tone="success">{r.status === "empanelled" ? "Empanelled" : "In network"}</Badge>{" "}
                      {r.cashlessAvailable ? <Badge tone="info">Cashless</Badge> : <Badge tone="neutral">Cashless not recorded</Badge>}
                    </>
                  ),
                },
                { key: "ver", header: "Last verified", nowrap: true, cell: (r) => (r.lastVerifiedAt ? formatDate(r.lastVerifiedAt) : "Not verified") },
              ]}
            />
            <Pagination basePath="/network" params={{ payer: payerValue, city, q: q.q }} page={data.page} pageSize={data.pageSize} total={data.total} />
          </>
        )}
      </section>
    </>
  );
}
