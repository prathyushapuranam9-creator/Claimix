import type { Metadata } from "next";
import s from "../content.module.css";

export const metadata: Metadata = { title: "About · Claimix" };

export default function AboutPage() {
  return (
    <article className={s.prose}>
      <h1>About Claimix</h1>
      <p className={s.lead}>
        Claimix is a workflow platform for hospital insurance desks, insurers, TPAs, government-scheme desks and patients in India.
      </p>
      <h2>What it does</h2>
      <ul>
        <li>Checks eligibility against each policy&apos;s own, versioned rules — never a single hardcoded rule for every insurer.</li>
        <li>Organizes pre-authorizations, documents, queries, claims and settlements with a full, append-only audit trail.</li>
        <li>Keeps every organization&apos;s data separate: a hospital sees its own cases; an insurer or TPA sees only cases submitted to it.</li>
      </ul>
      <h2>What it doesn&apos;t do</h2>
      <ul>
        <li>It doesn&apos;t approve, reject or settle claims. Only the insurer, TPA or scheme decides, and the platform records that decision.</li>
        <li>It doesn&apos;t guarantee claim approval or payment.</li>
        <li>It has no official integration with any insurer, TPA, government scheme or ABDM. Organizations, policies and rules in this installation are fictional DEMO DATA.</li>
      </ul>
      <h2>Privacy</h2>
      <p>
        Documents are stored privately and served only to authorized users. Sign-in, access changes and every important business action are audited.
      </p>
    </article>
  );
}
