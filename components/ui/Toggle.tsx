import type { InputHTMLAttributes } from "react";
import styles from "./Toggle.module.css";

/**
 * On/off switch for forms. A real checkbox (so plain GET forms submit it as before), shown as a switch
 * and announced as one (role="switch").
 */
export function Toggle({ label, ...rest }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" role="switch" className={styles.input} {...rest} />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      <span>{label}</span>
    </label>
  );
}
