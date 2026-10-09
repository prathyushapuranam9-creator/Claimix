"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ActionResult } from "@/lib/action-result";
import { ageOn } from "@/lib/india";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FieldShell } from "@/components/ui/Field";
import fieldStyles from "@/components/ui/Field.module.css";
import styles from "./NewClaimWizard.module.css";

export interface PatientSuggestion {
  beneficiaryId: string;
  fullName: string;
  patientNo: string;
  dob: string;
  phone: string | null;
  memberId: string;
  policyName: string;
  aadhaar: string | null;
  inForce: boolean;
}

const DEBOUNCE_MS = 250;

/**
 * Find the Patient: the existing Find search (a GET form, results listed below by the page) plus suggestions while
 * typing. Suggestions come from the same server search (the reviewer's own members only), debounced, and appear only
 * once something is typed. Choosing one opens the New Claim form for that patient, filled from the record.
 */
export function PatientFinder({
  basePath,
  q,
  suggest,
}: {
  basePath: string;
  q: string;
  suggest: (q: string) => Promise<ActionResult<PatientSuggestion[]>>;
}) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [value, setValue] = useState(q);
  const [items, setItems] = useState<PatientSuggestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  // Debounced search; a newer keystroke makes older answers irrelevant.
  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await suggest(term);
      if (n !== seq.current) return;
      setLoading(false);
      setItems(r.ok ? r.data : []);
      setActive(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, suggest]);

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (s: PatientSuggestion) => {
    if (!s.inForce) return;
    setValue(s.fullName);
    setOpen(false);
    seq.current++;
    router.push(`${basePath}?member=${s.beneficiaryId}`);
  };

  const shown = value.trim().length >= 2 && open;
  const list = items ?? [];

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(list.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && list[active]) {
      e.preventDefault();
      pick(list[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <form className={styles.finder} method="get" action={basePath} role="search">
      <div ref={wrap} className={styles.finderField}>
        <FieldShell id={id} label="UHID / IP Number / Patient Name / Aadhaar Number" hint="Type any part of the name, UHID, member or policy number, mobile, or Aadhaar (12 digits or the last 4).">
          <input
            id={id}
            name="q"
            type="search"
            className={fieldStyles.control}
            role="combobox"
            aria-expanded={shown}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown && list[active] ? `${id}-opt-${active}` : undefined}
            autoComplete="off"
            maxLength={100}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
              if (e.target.value.trim().length < 2) setItems(null);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
          />
        </FieldShell>
        {shown && (
          <ul id={listId} role="listbox" aria-label="Matching patients" className={styles.suggestions}>
            {items === null || (loading && list.length === 0) ? (
              <li className={styles.suggestEmpty} role="presentation">Searching…</li>
            ) : list.length === 0 ? (
              <li className={styles.suggestEmpty} role="presentation">No patients found</li>
            ) : (
              list.map((s, i) => (
                <li
                  key={s.beneficiaryId}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={!s.inForce || undefined}
                  className={styles.suggestion}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className={styles.suggestName}>{s.fullName}</span>
                  <span className={styles.suggestMeta}>
                    UHID {s.patientNo} · {ageOn(s.dob)} yrs{s.phone ? ` · ${s.phone}` : ""} · member {s.memberId}
                    {s.aadhaar ? ` · Aadhaar ${s.aadhaar}` : ""}
                  </span>
                  <span className={styles.suggestMeta}>{s.policyName}{s.inForce ? "" : " · cover not in force"}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <div className={styles.finderActions}>
        <Button type="submit">Find</Button>
        <ButtonLink href={basePath} variant="ghost">Clear</ButtonLink>
      </div>
    </form>
  );
}
