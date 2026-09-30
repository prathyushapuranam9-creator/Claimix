import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLES } from "@/modules/knowledge/articles";
import s from "../content.module.css";

export const metadata: Metadata = { title: "Knowledge Center · Claimix" };

export default function KnowledgePage() {
  return (
    <>
      <section className={s.hero}>
        <h1>Knowledge Center</h1>
        <p className={s.lead}>
          Plain-language guides to health insurance and hospital claims in India. General information only — the policy wording and the payer&apos;s decision always apply.
        </p>
      </section>
      <div className={s.grid}>
        {ARTICLES.map((a) => (
          <Link key={a.slug} href={`/knowledge/${a.slug}`} className={s.tile}>
            <h2 className={s.tileHeading}>{a.title}</h2>
            <p>{a.summary}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
