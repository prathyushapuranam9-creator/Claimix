import type { Metadata } from "next";
import s from "../../content.module.css";

export const metadata: Metadata = { title: "Government health schemes · Claimix" };

export default function GovernmentSchemesPage() {
  return (
    <>
      <section className={s.hero}>
        <h1>Government health schemes</h1>
        <p className={s.lead}>
          Central and state government schemes provide treatment for eligible beneficiaries at empanelled hospitals. They work differently from private insurance, and Claimix keeps them separate.
        </p>
      </section>
      <section className={s.section}>
        <div className={s.compare}>
          <div className={s.tile}>
            <h3>How schemes differ</h3>
            <p>Eligibility is decided by the scheme&apos;s own beneficiary records — not by an insurance card.</p>
            <p>Treatment is available at hospitals empanelled for the scheme, for the specialities they&apos;re empanelled for.</p>
            <p>Many schemes pay fixed-rate packages for defined treatments.</p>
          </div>
          <div className={s.tile}>
            <h3>What the hospital desk checks</h3>
            <p>Beneficiary verification with the scheme, the hospital&apos;s empanelment and speciality, and the package for the planned treatment.</p>
            <p>The scheme&apos;s authority decides pre-authorizations and claims.</p>
          </div>
        </div>
      </section>
      <section className={s.section} aria-labelledby="abdm-heading">
        <h2 id="abdm-heading">ABDM and ABHA are not insurance</h2>
        <div className={s.callout}>
          The Ayushman Bharat Digital Mission (ABDM) and ABHA numbers are digital-health infrastructure for health records and identity. They are not an insurance scheme and do not provide cover by themselves.
        </div>
        <p className={s.muted}>
          Claimix has no official integration with any government scheme or ABDM. Schemes shown inside the platform are fictional DEMO DATA.
        </p>
      </section>
    </>
  );
}
