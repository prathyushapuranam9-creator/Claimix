import { detectKind } from "@/lib/security/file-validation";

/** What the document viewer can show. The same types uploads accept: PDF, PNG (screenshots), JPG/JPEG, WEBP. */
export type Preview =
  | { kind: "pdf"; mime: "application/pdf" }
  | { kind: "image"; mime: "image/png" | "image/jpeg" | "image/webp" }
  | { kind: "unsupported" }
  | { kind: "empty_pdf" };

/**
 * Decides how to preview a file from its own bytes (the same magic-byte check uploads use),
 * never from the name or a header alone. A PDF with no page tree at all — e.g. a placeholder
 * file — is reported as `empty_pdf` so the viewer can say so instead of the browser's error.
 * Real PDFs always have either a plain "/Page" object or compressed object streams ("/ObjStm",
 * whose dictionary is never compressed), so this never rejects a genuine document.
 */
export function previewOf(bytes: Uint8Array): Preview {
  const kind = detectKind(bytes);
  if (kind === "png") return { kind: "image", mime: "image/png" };
  if (kind === "jpg") return { kind: "image", mime: "image/jpeg" };
  if (kind === "webp") return { kind: "image", mime: "image/webp" };
  if (kind !== "pdf") return { kind: "unsupported" };
  const text = new TextDecoder("latin1").decode(bytes);
  if (!/\/Page\b/.test(text) && !/\/ObjStm\b/.test(text)) return { kind: "empty_pdf" };
  return { kind: "pdf", mime: "application/pdf" };
}
