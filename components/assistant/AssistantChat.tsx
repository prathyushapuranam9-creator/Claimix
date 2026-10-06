"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { GuideReply } from "@/modules/assistant/guide";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Surface";
import styles from "./AssistantChat.module.css";

type Msg = { role: "user" | "assistant"; content: string; links?: GuideReply["links"]; notice?: string | null };
type Turn = { role: "user" | "assistant"; content: string };
const STORE = "claimix.assistant.chat";

/** **bold** only; everything else is plain text (React escapes it). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}

/** A small, safe renderer for the answer format: paragraphs, numbered and bulleted lists, bold, and ```path blocks. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!.replace(/^→\s*/, ""));
      i++;
      out.push(
        <p key={out.length} className={styles.path} role="group" aria-label={`Navigation path: ${body.join(", then ")}`}>
          {body.map((b, k) => <span key={k}>{b}</span>)}
        </p>,
      );
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\d+\.\s/, ""));
      out.push(<ol key={out.length}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ol>);
    } else if (/^-\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s/.test(lines[i]!)) items.push(lines[i++]!.replace(/^-\s/, ""));
      out.push(<ul key={out.length}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>);
    } else if (line.trim()) {
      out.push(<p key={out.length}>{inline(line)}</p>);
      i++;
    } else i++;
  }
  return <>{out}</>;
}

export function AssistantChat({ roleName, prompts, guide }: { roleName: string; prompts: string[]; guide: (i: { question: string; history: Turn[] }) => Promise<ActionResult<GuideReply>> }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // The conversation survives following a link in an answer (it lives in this tab's session only).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      // Restoring browser-only state after hydration; reading it during render would not match the server HTML.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setMsgs(JSON.parse(saved) as Msg[]);
    } catch {}
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-30))); } catch {}
  }, [msgs]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, pending]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setText("");
    setError(null);
    start(async () => {
      const r = await guide({ question, history });
      if (r.ok) setMsgs((m) => [...m, { role: "assistant", content: r.data.markdown, links: r.data.links, notice: r.data.notice }]);
      else setError(r.fieldErrors?.question?.[0] ?? r.error);
    });
  };

  return (
    <section className={styles.chat} aria-label="Claimix assistant conversation">
      <div className={styles.bar}>
        <div>
          <h2>Ask Claimix</h2>
          <p>Where things are, how workflows run, and what {roleName} can do.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={pending || msgs.length === 0} onClick={() => { setMsgs([]); setError(null); }}>New conversation</Button>
      </div>

      <div className={styles.thread} role="log" aria-live="polite" aria-relevant="additions">
        {msgs.length === 0 && (
          <div className={styles.empty}>
            <p>Hi! I am the Claimix Insurance Assistant. Ask me about screens, workflows, statuses or permissions in Claimix, or start with one of these:</p>
            <div className={styles.chips} role="group" aria-label="Suggested questions">
              {prompts.map((p) => <button key={p} type="button" className={styles.chip} disabled={pending} onClick={() => send(p)}>{p}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`${styles.row} ${m.role === "user" ? styles.user : styles.assistant}`}>
            {m.role === "assistant" && <span className={styles.avatar} aria-hidden="true">✦</span>}
            <div className={styles.bubble}>
              {m.role === "user" ? m.content : <Markdown text={m.content} />}
              {m.links && m.links.length > 0 && (
                <div className={styles.links}>
                  {m.links.map((l) => <Link key={l.href} href={l.href} className={styles.chip}>{l.label}</Link>)}
                </div>
              )}
              {m.notice && <Alert tone="info">{m.notice}</Alert>}
            </div>
          </div>
        ))}
        {pending && (
          <div className={`${styles.row} ${styles.assistant}`}>
            <span className={styles.avatar} aria-hidden="true">✦</span>
            <p className={styles.typing} role="status">Thinking<span>.</span><span>.</span><span>.</span></p>
          </div>
        )}
        <div ref={end} />
      </div>

      <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        {error && <Alert tone="danger">{error}</Alert>}
        {msgs.length > 0 && (
          <div className={styles.chips} role="group" aria-label="Suggested questions">
            {prompts.slice(0, 4).map((p) => <button key={p} type="button" className={styles.chip} disabled={pending} onClick={() => send(p)}>{p}</button>)}
          </div>
        )}
        <div className={styles.inputRow}>
          <textarea
            className={styles.input}
            aria-label="Your question"
            rows={1}
            value={text}
            maxLength={500}
            placeholder="Ask about Claimix, e.g. Where can I find claims?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
          />
          <Button type="submit" loading={pending} disabled={!text.trim()}>Send</Button>
        </div>
        <p className={styles.hint}>This assistant only answers questions about Claimix. It never makes or predicts a payer&apos;s decision.</p>
      </form>
    </section>
  );
}
