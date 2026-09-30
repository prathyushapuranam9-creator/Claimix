import type { Metadata } from "next";
import Link from "next/link";
import s from "../../content.module.css";

export const metadata: Metadata = { title: "Private health insurance · Claimix" };

const CATEGORIES = [
  { title: "Individual", body: "Covers one person with their own sum insured." },
  { title: "Family floater", body: "One sum insured shared by the whole family. A big claim by one member reduces what's left for others that year." },
  { title: "Senior citizen", body: "Designed for older people; often has co-pay and specific limits." },
  { title: "Group / employer", body: "Provided by an employer to employees and often their families. Terms are set in the group policy." },
  { title: "Top-up and super top-up", body: "Pay only above a deductible — useful with a base policy." },
  { title: "Critical illness", body: "Pays a fixed benefit on diagnosis of a listed illness, rather than reimbursing hospital bills." },
];

export default function PrivateInsurancePage() {
  return (
    <>
      <section className={s.hero}>
        <h1>Private health insurance</h1>
        <p className={s.lead}>
          Bought from an insurer. What&apos;s covered — and on what conditions — is set by the policy wording. Claims are handled by the insurer or its TPA.
        </p>
      </section>
      <section className={s.section} aria-labelledby="cat-heading">
        <h2 id="cat-heading">Common types of policy</h2>
        <div className={s.grid}>
          {CATEGORIES.map((c) => (
            <div key={c.title} className={s.tile}>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className={s.section} aria-labelledby="check-heading">
        <h2 id="check-heading">What hospitals check before admission</h2>
        <div className={s.prose}>
          <ul>
            <li>Policy active on the admission date, and the patient is an insured member.</li>
            <li>The hospital is in the payer&apos;s network for cashless treatment.</li>
            <li>Waiting periods, <Link href="/glossary#ped">pre-existing diseases</Link> and <Link href="/glossary#exclusion">exclusions</Link>.</li>
            <li>Available sum insured, <Link href="/glossary#room-rent-limit">room rent</Link> and <Link href="/glossary#sub-limit">sub-limits</Link>, co-pay and deductibles.</li>
          </ul>
          <p className={s.muted}>
            These checks are guidance. The insurer or TPA decides every pre-authorization and claim.
          </p>
        </div>
      </section>
    </>
  );
}
