"use client";

import { forwardRef, useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { aria, FieldShell, type FieldProps } from "./Field";
import fieldStyles from "./Field.module.css";
import styles from "./PasswordField.module.css";

type Props = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Password input with a Show/Hide toggle. Only the input's type changes, so the value
 * (typed or filled by a password manager) is never touched. It is masked again whenever
 * its form is submitted, so browsers always see a password field when saving credentials.
 */
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { label, error, hint, required, id: idProp, className, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  // Mask again on submit (capture phase: before any submit handler reads or sends the form).
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const mask = () => {
      if (inputRef.current) inputRef.current.type = "password";
      setVisible(false);
    };
    form.addEventListener("submit", mask, true);
    return () => form.removeEventListener("submit", mask, true);
  }, []);

  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required}>
      <div className={styles.wrap}>
        <input
          ref={setRefs}
          id={id}
          type={visible ? "text" : "password"}
          className={[fieldStyles.control, styles.input, className].filter(Boolean).join(" ")}
          aria-required={required || undefined}
          {...aria(id, error, hint)}
          {...rest}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-controls={id}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </FieldShell>
  );
});

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

/** Password hidden: an open eye offers to show it. */
function EyeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Password visible: a struck-through eye offers to hide it. */
function EyeOffIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9" />
      <path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
