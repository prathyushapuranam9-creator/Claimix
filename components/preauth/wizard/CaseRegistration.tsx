"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/india";
import type { RegistrationData } from "@/modules/preauth/registration.service";
import type { PreauthDetailsInput } from "@/modules/preauth/preauth.validation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { Alert, Card, Stack } from "@/components/ui/Surface";
import { CLINICAL_FORM_ID, WizardClinicalForm } from "./WizardClinicalForm";
import styles from "./CaseRegistration.module.css";

type Coded = { id: string; code: string; name: string };

function readSignature(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key);
    return v?.startsWith("data:image/png;base64,") ? v : null;
  } catch {
    return null;
  }
}
// sessionStorage has no same-tab change event; the page keeps its own copy once the user signs, so nothing to subscribe to.
const subscribeSignature = () => () => {};

const icon = (d: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const BACK = icon(<path d="M15 18l-6-6 6-6" />);
const EDIT = icon(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" /></>);
const PRINT = icon(<><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>);

/**
 * Register Case: the case registration form on its own page. Read-only by default; Edit switches to the Clinical
 * Details & Package form (the same one as the wizard step) and Save returns to the read-only form. Print, Download PDF
 * and Save a copy sit behind one menu. Submit needs the required details and a signature; it files the signed PDF with
 * the case (and so the patient's record). The unsent signature is kept in this tab, so Back loses nothing.
 */
export function CaseRegistration({
  data,
  signer,
  edit,
  actions,
}: {
  data: RegistrationData;
  signer: { name: string; role: string };
  edit: { defaults: PreauthDetailsInput; diagnoses: Coded[]; procedures: Coded[]; departments: string[] };
  actions: {
    saveClinical: (id: string, v: PreauthDetailsInput) => Promise<ActionResult>;
    saveCopy: (id: string, input: { signature?: string | null }) => Promise<ActionResult<string>>;
    submit: (id: string, input: { signature: string | null }) => Promise<ActionResult<{ documentId: string; duplicate: boolean }>>;
  };
}) {
  const router = useRouter();
  const menuId = useId();
  const draftKey = `claimix:register:${data.caseId}`;
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The signature drawn but not yet submitted is kept in this tab (sessionStorage), so Back / reload lose nothing.
  const stored = useSyncExternalStore(subscribeSignature, () => readSignature(draftKey), () => null);
  const [memSignature, setMemSignature] = useState<string | null | undefined>(undefined);
  const signature = memSignature !== undefined ? memSignature : stored;
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: ReactNode } | null>(null);
  const [pending, start] = useTransition();
  const submitted = useRef(false);
  const menuWrap = useRef<HTMLDivElement>(null);

  const sign = (v: string | null) => {
    setMemSignature(v);
    try {
      if (v) sessionStorage.setItem(draftKey, v);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* storage unavailable: the signature lasts for this page view */
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuWrap.current && !menuWrap.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  const back = () => {
    if (editing && dirty && !window.confirm("You have unsaved changes in the form. Leave without saving them?")) return;
    router.push(`/pre-authorizations/raise?id=${data.caseId}&step=2`);
  };

  const saveCopy = () => {
    setMenuOpen(false);
    start(async () => {
      const r = await actions.saveCopy(data.caseId, { signature });
      setMsg(r.ok ? { tone: "success", text: "A copy of the form was saved with the case documents." } : { tone: "danger", text: r.error });
      router.refresh();
    });
  };

  const submit = () => {
    if (submitted.current) return;
    submitted.current = true;
    setMsg(null);
    start(async () => {
      const r = await actions.submit(data.caseId, { signature });
      submitted.current = false;
      if (!r.ok) return setMsg({ tone: "danger", text: r.error });
      sign(null);
      setMsg({
        tone: "success",
        text: (
          <>
            {r.data.duplicate ? "This form was already saved — nothing changed since." : "The registration form was saved with the case and the patient's record."}{" "}
            <Link href={`/patients/${data.patientId}`}>Open {data.patientName}&apos;s record</Link> ·{" "}
            <Link href={`/pre-authorizations/raise?id=${data.caseId}&step=3`}>Continue to Supporting Documents</Link>
          </>
        ),
      });
      router.refresh();
    });
  };

  const reg = data.registration;
  const canSubmit = data.editable && !editing && !pending && !!signature && data.clinicalComplete;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar} role="toolbar" aria-label="Registration form actions" data-print="hide">
        <button type="button" className={styles.iconBtn} aria-label="Back" title="Back" onClick={back}>{BACK}</button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={editing ? "Stop editing" : "Edit"}
          title={editing ? "Stop editing" : "Edit"}
          aria-pressed={editing}
          disabled={!data.editable}
          onClick={() => {
            if (editing && dirty && !window.confirm("Discard the unsaved changes?")) return;
            setEditing((e) => !e);
            setDirty(false);
          }}
        >
          {EDIT}
        </button>
        <div ref={menuWrap} className={styles.menuWrap}>
          <button type="button" className={styles.iconBtn} aria-label="Print, download or save" title="Print / Download / Save" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen((o) => !o)}>
            {PRINT}
          </button>
          {menuOpen && (
            <div id={menuId} role="menu" className={styles.menu}>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); window.print(); }}>Print</button>
              <a role="menuitem" href={`/api/pre-authorizations/${data.caseId}/registration`} download onClick={() => setMenuOpen(false)}>Download PDF</a>
              <button type="button" role="menuitem" onClick={saveCopy} disabled={!data.editable}>Save a copy to the case documents</button>
            </div>
          )}
        </div>
        <span className={styles.toolbarInfo}>Case <span className="mono">{data.reference}</span>{editing ? " · editing" : " · read-only"}</span>
      </div>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!data.editable && <Alert tone="info">This case has been submitted to the payer; the form is shown read-only.</Alert>}
      {reg && !reg.current && <Alert tone="warning">The details changed after this form was submitted on {formatDateTime(reg.submittedAt)}. Sign and submit again to save an up-to-date copy.</Alert>}

      {editing ? (
        <Stack>
          <Card title="Clinical details & package">
            <WizardClinicalForm
              defaults={edit.defaults}
              diagnoses={edit.diagnoses}
              procedures={edit.procedures}
              departments={edit.departments}
              onDirty={setDirty}
              save={(v) => actions.saveClinical(data.caseId, v)}
              onSaved={() => {
                setEditing(false);
                setDirty(false);
                setMsg({ tone: "success", text: "Changes saved." });
                router.refresh();
              }}
            />
          </Card>
          <div className={styles.editActions} data-print="hide">
            <Button type="submit" form={CLINICAL_FORM_ID} loading={pending}>Save changes</Button>
            <Button type="button" variant="ghost" onClick={() => { if (!dirty || window.confirm("Discard the unsaved changes?")) { setEditing(false); setDirty(false); } }}>Cancel</Button>
          </div>
        </Stack>
      ) : (
        <article className={styles.sheet} aria-label="Case registration form">
          <header className={styles.sheetHead}>
            <h2>Pre-authorization request — case registration form</h2>
            <p className={styles.muted}>Case {data.reference} · {data.hospital}</p>
          </header>
          {data.sections.map((sec) => (
            <section key={sec.title}>
              <h3>{sec.title}</h3>
              <table className={styles.table}>
                <tbody>
                  {sec.rows.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">{k}</th>
                      <td>{v || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <section>
            <h3>Expected cost</h3>
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">Head</th><th scope="col">What it covers</th><th scope="col" className={styles.num}>Per day</th><th scope="col" className={styles.num}>Days</th><th scope="col" className={styles.num}>Amount</th></tr>
              </thead>
              <tbody>
                {data.cost.map((c, i) => (
                  <tr key={i}><td>{c.head}</td><td>{c.covers}</td><td className={styles.num}>{c.perDay}</td><td className={styles.num}>{c.days}</td><td className={styles.num}>{c.amount}</td></tr>
                ))}
                <tr><th scope="row" colSpan={4}>Expected cost</th><td className={styles.num}><strong>{data.costTotal}</strong></td></tr>
              </tbody>
            </table>
          </section>
          <section aria-labelledby="sig-title">
            <h3 id="sig-title">Digital signature</h3>
            {data.editable ? (
              <div className={styles.signRow}>
                <SignaturePad value={signature} onChange={sign} disabled={pending} label={`Signature of ${signer.name}`} />
                <dl className={styles.signer}>
                  <dt>Signer</dt><dd>{signer.name}</dd>
                  <dt>Role</dt><dd>{signer.role}</dd>
                  <dt>Signed at</dt><dd>Recorded when you submit</dd>
                </dl>
              </div>
            ) : null}
            {reg && (
              <figure className={styles.signed}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from this case, not a remote image */}
                <img src={reg.signatureDataUrl} alt={`Signature of ${reg.signerName}`} width={240} height={75} />
                <figcaption>
                  Last submitted: signed electronically by <strong>{reg.signerName}</strong> ({reg.signerRole}) on {formatDateTime(reg.signedAt)}
                </figcaption>
              </figure>
            )}
            <p className={styles.note}>
              This is an electronic signature captured in Claimix (a drawn or typed signature with the signer&apos;s identity and time). It is not a certified digital
              signature (DSC or Aadhaar eSign).
            </p>
          </section>
        </article>
      )}

      {!editing && data.editable && (
        <div className={styles.submitBar} data-print="hide">
          {!data.clinicalComplete && <span className={styles.muted}>Complete the form first (Edit): {data.clinicalIssues.join(" ")}</span>}
          {data.clinicalComplete && !signature && <span className={styles.muted}>Sign the form to submit it.</span>}
          <ButtonLink href={`/pre-authorizations/raise?id=${data.caseId}&step=3`} variant="ghost">Skip for now</ButtonLink>
          <Button type="button" onClick={submit} disabled={!canSubmit} loading={pending}>Submit</Button>
        </div>
      )}
    </div>
  );
}
