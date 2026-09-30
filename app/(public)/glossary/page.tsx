import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Surface";
import { searchGlossary } from "@/modules/knowledge/glossary";
import s from "../content.module.css";

export const metadata: Metadata = { title: "Glossary · Claimix" };

export default async function GlossaryPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = ((Array.isArray(raw) ? raw[0] : raw) ?? "").slice(0, 100);
  const terms = searchGlossary(q);

  return (
    <>
      <section className={s.hero}>
        <h1>Insurance glossary</h1>
        <p className={s.lead}>Each term explained simply, with an example and why it matters.</p>
        <form role="search" className={s.searchRow} action="/glossary">
          <TextField label="Search terms" name="q" defaultValue={q} maxLength={100} placeholder="e.g. co-pay" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </section>
      {terms.length === 0 ? (
        <EmptyState title="No matching terms">Try a shorter word, or browse the Knowledge Center.</EmptyState>
      ) : (
        <div className={s.grid}>
          {terms.map((t) => (
            <section key={t.slug} id={t.slug} className={s.term} aria-labelledby={`${t.slug}-h`}>
              <h2 id={`${t.slug}-h`} className={s.tileHeading}>{t.term}</h2>
              <dl>
                <dt>Simple explanation</dt>
                <dd>{t.simple}</dd>
                <dt>Example</dt>
                <dd>{t.example}</dd>
                <dt>Why it matters</dt>
                <dd>{t.why}</dd>
              </dl>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
