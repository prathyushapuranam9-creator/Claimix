import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

/** Label + control + hint/error wiring with correct aria attributes. */
export function FieldShell({ id, label, error, hint, required, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <span id={`${id}-hint`} className={styles.hint}>{hint}</span>}
      {error && <span id={`${id}-error`} className={styles.error} role="alert">{error}</span>}
    </div>
  );
}

export function aria(id: string, error?: string, hint?: string) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

export const TextField = forwardRef<HTMLInputElement, FieldProps & InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ label, error, hint, required, id: idProp, ...rest }, ref) {
    const auto = useId();
    const id = idProp ?? auto;
    return (
      <FieldShell id={id} label={label} error={error} hint={hint} required={required}>
        <input ref={ref} id={id} className={styles.control} aria-required={required || undefined} {...aria(id, error, hint)} {...rest} />
      </FieldShell>
    );
  },
);

export const SelectField = forwardRef<HTMLSelectElement, FieldProps & SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectField({ label, error, hint, required, id: idProp, children, ...rest }, ref) {
    const auto = useId();
    const id = idProp ?? auto;
    return (
      <FieldShell id={id} label={label} error={error} hint={hint} required={required}>
        <select ref={ref} id={id} className={styles.control} aria-required={required || undefined} {...aria(id, error, hint)} {...rest}>
          {children}
        </select>
      </FieldShell>
    );
  },
);

export const TextAreaField = forwardRef<HTMLTextAreaElement, FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextAreaField({ label, error, hint, required, id: idProp, ...rest }, ref) {
    const auto = useId();
    const id = idProp ?? auto;
    return (
      <FieldShell id={id} label={label} error={error} hint={hint} required={required}>
        <textarea ref={ref} id={id} className={styles.control} aria-required={required || undefined} {...aria(id, error, hint)} {...rest} />
      </FieldShell>
    );
  },
);
