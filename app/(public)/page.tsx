import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import s from "./content.module.css";

const FLOW = ["Patient", "Policy / scheme", "Eligibility", "Pre-authorization", "Documents", "Payer decision", "Claim", "Settlement"];

const FEATURES = [
  { icon: "✓", title: "Eligibility checker", body: "Checks the policy, member, dates, waiting periods, PED, exclusions and limits against the policy's own rules — and says clearly what still needs verification." },
  { icon: "⌂", title: "Hospital network", body: "Which hospitals are in which payer's network, with cashless status and when it was last verified." },
  { icon: "✎", title: "Pre-authorization", body: "A guided request with a server-checked submission checklist, document tracking and a full timeline." },
  { icon: "▤", title: "Documents", body: "Private, access-controlled uploads with file checks, and payer review of each document." },
  { icon: "₹", title: "Claims & settlement", body: "Queries, payer responses, rejections with reasons, and settlement recorded exactly as the payer decided." },
  { icon: "?", title: "Insurance Assistant", body: "Explains a case in plain language from its recorded data and rules — and routes anything uncertain to a person." },
];

export default function HomePage() {
  return (
    <>
      <section className={s.hero}>
        <h1>Simplify Health Insurance &amp; Hospital Claims</h1>
        <p className={s.lead}>
          Verify eligibility, understand coverage, and manage pre-authorizations, documents and claims — for private health insurance and government health schemes — from one platform.
        </p>
        <div className={s.ctas}>
          <ButtonLink href="/eligibility">Check Eligibility</ButtonLink>
          <ButtonLink href="/insurance/private" variant="secondary">Explore Insurance</ButtonLink>
          <ButtonLink href="/login" variant="secondary">Hospital Login</ButtonLink>
          <ButtonLink href="#how-it-works" variant="ghost">Learn How It Works</ButtonLink>
        </div>
      </section>

      <section className={s.section} id="how-it-works" aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className={s.flow}>
          {FLOW.map((step) => <li key={step}><span>{step}</span></li>)}
        </ol>
        <p className={s.muted}>
          Every step is recorded. The platform checks and organizes; the insurer, TPA or scheme makes the decision.
        </p>
      </section>

      <section className={s.section} aria-labelledby="features-heading">
        <h2 id="features-heading">What Claimix does</h2>
        <div className={s.grid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={s.tile}>
              <span className={s.icon} aria-hidden="true">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={s.section} aria-labelledby="learn-heading">
        <h2 id="learn-heading">Learn the basics</h2>
        <div className={s.grid}>
          <Link className={s.tile} href="/cashless-vs-reimbursement">
            <h3>Cashless vs reimbursement</h3>
            <p>Who pays the hospital, when, and what the patient may still owe.</p>
          </Link>
          <Link className={s.tile} href="/insurance/government">
            <h3>Government health schemes</h3>
            <p>How scheme eligibility and empanelled hospitals differ from private insurance.</p>
          </Link>
          <Link className={s.tile} href="/knowledge">
            <h3>Knowledge Center</h3>
            <p>Plain-language guides: waiting periods, PED, co-pay, sub-limits and more.</p>
          </Link>
          <Link className={s.tile} href="/glossary">
            <h3>Glossary</h3>
            <p>Insurance terms explained simply, with an example and why each matters.</p>
          </Link>
        </div>
      </section>
    </>
  );
}
