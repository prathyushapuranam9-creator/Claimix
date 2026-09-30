import type { ReactNode } from "react";
import { describeRule } from "@/modules/rules/engine/kinds";
import { EmptyState } from "@/components/ui/Surface";
import styles from "./RuleList.module.css";

interface RuleRow {
  id: string;
  code: string;
  title: string;
  config: unknown;
}

/**
 * Renders a policy's rules in plain language. Text is generated from the rule
 * configs themselves, so what users read is exactly what the engine enforces.
 */
export function RuleList({ rules, empty, actions }: { rules: RuleRow[]; empty: string; actions?: (r: RuleRow) => ReactNode }) {
  if (!rules.length) {
    return <EmptyState title={empty}>Nothing is assumed: checks in this area will show &ldquo;Additional verification required&rdquo;.</EmptyState>;
  }
  return (
    <ul className={styles.list}>
      {rules.map((r) => {
        const text = describeRule(r.config);
        return (
          <li key={r.id} className={styles.item}>
            <div>
              <p className={styles.title}>{r.title}</p>
              <p className={text ? styles.text : styles.invalid}>{text ?? "This rule is misconfigured and will be treated as 'needs verification'."}</p>
            </div>
            {actions && <div className={styles.actions}>{actions(r)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
