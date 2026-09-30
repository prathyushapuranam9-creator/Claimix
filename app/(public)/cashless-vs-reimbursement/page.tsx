import type { Metadata } from "next";
import Link from "next/link";
import s from "../content.module.css";

export const metadata: Metadata = { title: "Cashless vs reimbursement · Claimix" };

export default function CashlessVsReimbursementPage() {
  return (
    <>
      <section className={s.hero}>
        <h1>Cashless vs reimbursement</h1>
        <p className={s.lead}>Two ways a health insurance claim is paid. The difference is who pays the hospital, and when.</p>
      </section>
      <section className={s.section}>
        <div className={s.compare}>
          <div className={s.tile}>
            <h3>Cashless</h3>
            <p>At a <Link href="/glossary#network-hospital">network hospital</Link>, the hospital requests a <Link href="/glossary#pre-authorization">pre-authorization</Link>. After approval, the insurer or TPA pays the hospital directly.</p>
            <p>After discharge, the hospital sends the final bill for final settlement.</p>
            <p><Link href="/knowledge/how-cashless-works">How cashless works →</Link></p>
          </div>
          <div className={s.tile}>
            <h3>Reimbursement</h3>
            <p>The patient pays the hospital, then submits original bills and reports to the insurer or TPA.</p>
            <p>The payer assesses the <Link href="/glossary#admissible-amount">admissible amount</Link> and pays it to the policyholder.</p>
            <p><Link href="/knowledge/how-reimbursement-works">How reimbursement works →</Link></p>
          </div>
        </div>
      </section>
      <section className={s.section} aria-labelledby="free-heading">
        <h2 id="free-heading">Cashless does not mean everything is free.</h2>
        <div className={s.prose}>
          <p>Even with an approved cashless request, the patient may pay:</p>
          <ul>
            <li><Link href="/glossary#co-pay">Co-pay</Link> and <Link href="/glossary#deductible">deductibles</Link>.</li>
            <li>Non-payable items such as some consumables.</li>
            <li>Amounts above <Link href="/glossary#room-rent-limit">room-rent</Link> or <Link href="/glossary#sub-limit">sub-limits</Link>.</li>
            <li>Anything beyond the available <Link href="/glossary#sum-insured">sum insured</Link>.</li>
          </ul>
          <p className={s.example}>
            Example: an approved ₹80,000 pre-authorization against a ₹90,000 bill leaves ₹10,000 for the patient — plus anything the final assessment disallows.
          </p>
        </div>
      </section>
    </>
  );
}
