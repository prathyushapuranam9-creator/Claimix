import { formatDateTime } from "@/lib/india";
import { Badge, type Tone } from "@/components/ui/Surface";
import styles from "./Timeline.module.css";

export interface TimelineEntry {
  id: string;
  toStatus: string;
  reason: string | null;
  message: string | null;
  requiredAction: string | null;
  requiredDocuments: string[];
  responsibleTeam: string | null;
  createdAt: Date;
  actorName: string | null;
}

/** Status history, newest first. Each entry shows why, what to do next, and who is responsible. */
export function Timeline({ entries, label, tone }: { entries: TimelineEntry[]; label: (s: string) => string; tone: (s: string) => Tone }) {
  return (
    <ol className={styles.list}>
      {[...entries].reverse().map((e) => (
        <li key={e.id} className={styles.entry}>
          <span className={styles.dot} data-tone={tone(e.toStatus)} aria-hidden="true" />
          <div className={styles.body}>
            <p className={styles.head}>
              <Badge tone={tone(e.toStatus)}>{label(e.toStatus)}</Badge>
              <time className={styles.time}>{formatDateTime(e.createdAt)}</time>
              {e.actorName && <span className={styles.time}>by {e.actorName}</span>}
            </p>
            {e.reason && <p><strong>Reason:</strong> {e.reason}</p>}
            {e.message && <p className={styles.msg}>{e.message}</p>}
            {e.requiredAction && <p><strong>Next:</strong> {e.requiredAction}</p>}
            {e.requiredDocuments.length > 0 && <p><strong>Documents needed:</strong> {e.requiredDocuments.join(", ")}</p>}
            {e.responsibleTeam && <p className={styles.time}>Responsible: {e.responsibleTeam}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
