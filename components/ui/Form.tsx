import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Form.module.css";

export function FormSection({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className={styles.section}>
      {title && <legend className={styles.sectionTitle}>{title}</legend>}
      {hint && <p className={styles.sectionHint}>{hint}</p>}
      {children}
    </fieldset>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

/** Spans both grid columns on wider screens. */
export function FullWidth({ children }: { children: ReactNode }) {
  return <div className={styles.full}>{children}</div>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export const Checkbox = forwardRef<HTMLInputElement, { label: string } & InputHTMLAttributes<HTMLInputElement>>(function Checkbox(
  { label, ...rest },
  ref,
) {
  return (
    <label className={styles.check}>
      <input ref={ref} type="checkbox" {...rest} />
      {label}
    </label>
  );
});

/** Read-only key/value details. */
export function Details({ items, columns = 2 }: { items: [label: string, value: ReactNode][]; columns?: 2 | 3 }) {
  return (
    <dl className={`${styles.dl} ${columns === 3 ? styles.three : ""}`}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export { styles as formStyles };
