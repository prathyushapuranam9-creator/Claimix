import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ARTICLES, article } from "@/modules/knowledge/articles";
import { GLOSSARY } from "@/modules/knowledge/glossary";
import s from "../../content.module.css";

// Prerendered; unknown slugs 404 via notFound() below. (Not dynamicParams = false: after a
// global revalidatePath("/", "layout") that setting made valid articles 404.)
export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = article((await params).slug);
  return { title: a ? `${a.title} · Claimix` : "Knowledge Center · Claimix", description: a?.summary };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const a = article((await params).slug);
  if (!a) notFound();
  const related = (a.related ?? []).map((slug) => GLOSSARY.find((g) => g.slug === slug)).filter((g) => g !== undefined);

  return (
    <article className={s.prose}>
      <p><Link href="/knowledge">← Knowledge Center</Link></p>
      <h1>{a.title}</h1>
      <p className={s.lead}>{a.summary}</p>
      {a.sections.map((sec) => (
        <section key={sec.heading}>
          <h2>{sec.heading}</h2>
          {sec.body.length > 1 ? (
            <ul>{sec.body.map((b) => <li key={b}>{b}</li>)}</ul>
          ) : (
            <p>{sec.body[0]}</p>
          )}
        </section>
      ))}
      {a.example && <p className={s.example}><strong>Example:</strong> {a.example}</p>}
      {related.length > 0 && (
        <section>
          <h2>Related terms</h2>
          <ul>
            {related.map((g) => <li key={g.slug}><Link href={`/glossary#${g.slug}`}>{g.term}</Link> — {g.simple}</li>)}
          </ul>
        </section>
      )}
      <p className={s.muted}>
        General information only. The applicable policy wording, insurer/TPA decision and scheme rules take precedence.
      </p>
    </article>
  );
}
