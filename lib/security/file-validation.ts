/**
 * Upload validation. The file's real type is detected from its content (magic
 * bytes) and must agree with its extension; the browser-supplied MIME type is
 * never trusted.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_TYPES = {
  pdf: { mime: "application/pdf", exts: ["pdf"] },
  png: { mime: "image/png", exts: ["png"] },
  jpg: { mime: "image/jpeg", exts: ["jpg", "jpeg"] },
} as const;

export type AllowedKind = keyof typeof ALLOWED_TYPES;

function startsWith(buf: Uint8Array, sig: number[], offset = 0) {
  return sig.every((b, i) => buf[offset + i] === b);
}

export function detectKind(buf: Uint8Array): AllowedKind | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpg";
  return null;
}

/** Display-safe filename: no directories, control or reserved characters; bounded length. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "file").slice(-120);
}

export type FileCheck =
  | { ok: true; kind: AllowedKind; mime: string; ext: string; displayName: string }
  | { ok: false; error: string };

export function validateUpload(file: { name: string; size: number; bytes: Uint8Array }): FileCheck {
  if (file.size <= 0 || file.bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES || file.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Files must be 10 MB or smaller." };
  const displayName = safeDisplayName(file.name);
  const ext = displayName.includes(".") ? displayName.split(".").pop()!.toLowerCase() : "";
  const allowedExt = Object.values(ALLOWED_TYPES).some((t) => (t.exts as readonly string[]).includes(ext));
  if (!allowedExt) return { ok: false, error: "Upload a PDF, PNG or JPG file." };
  const kind = detectKind(file.bytes);
  if (!kind) return { ok: false, error: "This file's content isn't a valid PDF, PNG or JPG." };
  if (!(ALLOWED_TYPES[kind].exts as readonly string[]).includes(ext)) {
    return { ok: false, error: `The file extension .${ext} doesn't match its content (${kind.toUpperCase()}).` };
  }
  return { ok: true, kind, mime: ALLOWED_TYPES[kind].mime, ext: ALLOWED_TYPES[kind].exts[0], displayName };
}
