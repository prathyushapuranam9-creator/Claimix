"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import styles from "./SignaturePad.module.css";

const W = 480;
const H = 150;

/**
 * Electronic signature: draw it (mouse, touch or pen), or type the name (keyboard / screen-reader friendly), which is
 * rendered into the same image. Reports a PNG data URL, or null when cleared. This is an electronic signature, not a
 * certified digital signature (DSC / Aadhaar eSign).
 */
export function SignaturePad({
  value,
  onChange,
  disabled,
  label = "Signature",
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");

  // Paint a saved signature back onto the canvas (e.g. after a reload).
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (!value) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, W, H);
    img.src = value;
  }, [value]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvas.current?.toDataURL("image/png") ?? null);
  };

  const applyTyped = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    const name = typed.trim();
    if (!c || !ctx || name.length < 2) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#111827";
    ctx.font = "italic 40px 'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', cursive";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 16, H / 2, W - 32);
    onChange(c.toDataURL("image/png"));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span id={`${id}-label`} className={styles.label}>{label}</span>
        <div className={styles.modes} role="group" aria-label="How to sign">
          <button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")} disabled={disabled}>Draw</button>
          <button type="button" aria-pressed={mode === "type"} onClick={() => setMode("type")} disabled={disabled}>Type</button>
        </div>
      </div>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        className={styles.canvas}
        data-empty={!value || undefined}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      {mode === "type" && (
        <div className={styles.typeRow}>
          <input
            className={styles.typeInput}
            aria-label="Type your full name to sign"
            value={typed}
            maxLength={60}
            disabled={disabled}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyTyped();
              }
            }}
          />
          <button type="button" className={styles.action} onClick={applyTyped} disabled={disabled || typed.trim().length < 2}>Use as signature</button>
        </div>
      )}
      <div className={styles.foot}>
        <span id={`${id}-hint`} className={styles.hint}>
          {value ? "Signed." : mode === "draw" ? "Sign inside the box with your mouse, finger or pen." : "Type your name, then select Use as signature."}
        </span>
        <button type="button" className={styles.action} onClick={() => onChange(null)} disabled={disabled || !value}>Clear</button>
      </div>
    </div>
  );
}
