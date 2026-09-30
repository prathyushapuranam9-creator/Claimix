"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { Answer, Source, StepState } from "@/modules/assistant/answer";
import { INTENTS, type Intent } from "@/modules/assistant/intents";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Alert, Badge, Card, Stack, type Tone } from "@/components/ui/Surface";
import styles from "./AssistantPanel.module.css";

type Subject = { type: "preauth" | "claim"; id: string; label: string };
type Result = Answer & { interactionId: string; explanation: string | null };

const SOURCE: Record<Source, { label: string; tone: Tone }> = {
  rules: { label: "Policy rules", tone: "info" },
  payer: { label: "Payer decision", tone: "warning" },
  record: { label: "Record", tone: "neutral" },
  guidance: { label: "Guidance", tone: "neutral" },
};

const STATUS: Record<Answer["status"], { label: string; tone: Tone }> = {
  answered: { label: "Answered from records", tone: "success" },
  needs_information: { label: "Needs more information", tone: "warning" },
  needs_human_review: { label: "Needs human review", tone: "danger" },
};

const STEP: Record<StepState, { icon: string; text: string }> = {
  pass: { icon: "✓", text: "Passed" },
  fail: { icon: "✕", text: "Failed" },
  verify: { icon: "!", text: "Verify" },
  pending: { icon: "○", text: "Not yet" },
  na: { icon: "–", text: "Not applicable" },
};

export function AssistantPanel({
  subjects,
  initial,
  ask,
  requestReview,
}: {
  subjects: Subject[];
  initial?: { type: "preauth" | "claim"; id: string };
  ask: (i: { subjectType: "preauth" | "claim"; subjectId: string; question: string; intent?: Intent }) => Promise<ActionResult<Result>>;
  requestReview: (i: { interactionId: string; note?: string }) => Promise<ActionResult>;
}) {
  const [subject, setSubject] = useState(initial ? `${initial.type}:${initial.id}` : subjects[0] ? `${subjects[0].type}:${subjects[0].id}` : "");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewSent, setReviewSent] = useState(false);
  const [pending, start] = useTransition();

  const submit = (q: string, intent?: Intent) => {
    const [type, id] = subject.split(":") as ["preauth" | "claim", string];
    if (!id) return setError("Choose a pre-authorization or claim first.");
    start(async () => {
      setError(null);
      setReviewSent(false);
      const r = await ask({ subjectType: type, subjectId: id, question: q, intent });
      if (r.ok) setResult(r.data);
      else { setResult(null); setError(r.fieldErrors?.question?.[0] ?? r.error); }
    });
  };

  return (
    <Stack>
      <Card>
        <div className={styles.form}>
          <SelectField label="About which request?" value={subject} onChange={(e) => { setSubject(e.target.value); setResult(null); }}>
            {!subjects.length && <option value="">No requests available</option>}
            {subjects.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.type === "claim" ? "Claim" : "Pre-auth"} {s.label}</option>)}
          </SelectField>
          <div className={styles.chips} role="group" aria-label="Suggested questions">
            {(Object.entries(INTENTS) as [Intent, string][]).map(([k, label]) => (
              <button key={k} type="button" className={styles.chip} disabled={pending} onClick={() => { setQuestion(label); submit(label, k); }}>
                {label}
              </button>
            ))}
          </div>
          <form className={styles.ask} onSubmit={(e) => { e.preventDefault(); submit(question); }}>
            <TextField label="Or type your question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} placeholder="e.g. Why was this queried?" />
            <Button type="submit" loading={pending}>Ask</Button>
          </form>
        </div>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {result && (
        <Card title={result.question} actions={<Badge tone={STATUS[result.status].tone}>{STATUS[result.status].label}</Badge>}>
          <div className={styles.answer} aria-live="polite">
            <p className={styles.headline}>{result.headline}</p>
            {result.explanation && <p>{result.explanation}</p>}
            {result.facts.length > 0 && (
              <ul className={styles.facts}>
                {result.facts.map((f, i) => (
                  <li key={i}>
                    <Badge tone={SOURCE[f.source].tone}>{SOURCE[f.source].label}</Badge>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.askFor.length > 0 && (
              <Alert tone="warning" title="I need this information to answer">
                <ul className={styles.list}>{result.askFor.map((a) => <li key={a}>{a}</li>)}</ul>
              </Alert>
            )}
            {result.nextSteps.length > 0 && (
              <div>
                <p className={styles.sub}>Next steps</p>
                <ul className={styles.list}>{result.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
            <div>
              <p className={styles.sub}>Decision sequence</p>
              <ol className={styles.sequence}>
                {result.sequence.map((s) => (
                  <li key={s.key} data-state={s.state}>
                    <span aria-hidden="true">{STEP[s.state].icon}</span>
                    {s.label}
                    <span className="visually-hidden"> — {STEP[s.state].text}</span>
                  </li>
                ))}
              </ol>
            </div>
            {result.status !== "answered" && (
              <div className={styles.review}>
                {reviewSent ? (
                  <Alert tone="success">Sent for human review. You&apos;ll be notified when a colleague answers.</Alert>
                ) : (
                  <>
                    <TextField label="Note for the reviewer (optional)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} maxLength={1000} />
                    <Button
                      variant="secondary"
                      loading={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await requestReview({ interactionId: result.interactionId, note: reviewNote || undefined });
                          if (r.ok) setReviewSent(true);
                          else setError(r.error);
                        })
                      }
                    >
                      Send for human review
                    </Button>
                  </>
                )}
              </div>
            )}
            <p className={styles.fine}>Answers come from this request&apos;s records and the policy&apos;s configured rules. The assistant doesn&apos;t make or change insurance decisions.</p>
          </div>
        </Card>
      )}
    </Stack>
  );
}
