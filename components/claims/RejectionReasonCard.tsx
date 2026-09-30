import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/Surface";
import styles from "./RejectionReasonCard.module.css";

const KIND_TONE: Record<string, Tone> = { query: "warning", rejection: "danger", both: "neutral" };
const KIND_LABEL: Record<string, string> = { query: "Query", rejection: "Rejection", both: "Query or rejection" };

/** Reason → what it means → what to check → required action. */
export function RejectionReasonCard({
  title,
  kind,
  meaning,
  whatToCheck,
  requiredAction,
  actions,
  remarks,
}: {
  title: string;
  kind?: string;
  meaning: string | null;
  whatToCheck: string | null;
  requiredAction: string | null;
  actions?: ReactNode;
  /** The payer's own remarks for this case, when shown on a claim. */
  remarks?: string | null;
}) {
  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <h3>{title}</h3>
        {kind && <Badge tone={KIND_TONE[kind] ?? "neutral"}>{KIND_LABEL[kind] ?? kind}</Badge>}
        {actions}
      </header>
      {remarks && <p className={styles.remarks}>&ldquo;{remarks}&rdquo;</p>}
      <ol className={styles.steps}>
        {meaning && <li><span>What it means</span><p>{meaning}</p></li>}
        {whatToCheck && <li><span>What to check</span><p>{whatToCheck}</p></li>}
        {requiredAction && <li><span>Required action</span><p>{requiredAction}</p></li>}
      </ol>
    </article>
  );
}
