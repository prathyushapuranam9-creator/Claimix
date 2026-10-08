import { describe, expect, it } from "vitest";
import { detectKind, MAX_UPLOAD_BYTES, safeDisplayName, validateUpload } from "@/lib/security/file-validation";
import { basicScanner } from "@/modules/documents/scanner";
import { assertSafeKey, localStorageAdapter } from "@/modules/documents/storage";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const EXE = new TextEncoder().encode("MZ\x90\x00 this is not a document");

const f = (name: string, bytes: Uint8Array, size = bytes.length) => ({ name, size, bytes });

describe("upload validation", () => {
  it("accepts real PDF, PNG and JPG files", () => {
    expect(validateUpload(f("report.pdf", PDF))).toMatchObject({ ok: true, mime: "application/pdf" });
    expect(validateUpload(f("xray.PNG", PNG))).toMatchObject({ ok: true, mime: "image/png" });
    expect(validateUpload(f("photo.jpeg", JPG))).toMatchObject({ ok: true, mime: "image/jpeg", ext: "jpg" });
  });

  it("rejects MIME spoofing: extension doesn't match content", () => {
    expect(validateUpload(f("invoice.pdf", PNG)).ok).toBe(false);
    expect(validateUpload(f("scan.png", PDF)).ok).toBe(false);
    expect(validateUpload(f("malware.pdf", EXE)).ok).toBe(false);
  });

  it("rejects disallowed extensions even with valid content", () => {
    expect(validateUpload(f("report.pdf.exe", PDF)).ok).toBe(false);
    expect(validateUpload(f("page.html", PDF)).ok).toBe(false);
    expect(validateUpload(f("noext", PDF)).ok).toBe(false);
  });

  it("rejects empty and oversized files", () => {
    expect(validateUpload(f("a.pdf", new Uint8Array())).ok).toBe(false);
    expect(validateUpload(f("a.pdf", PDF, MAX_UPLOAD_BYTES + 1)).ok).toBe(false);
  });

  it("detects content types from magic bytes only", () => {
    expect(detectKind(PDF)).toBe("pdf");
    expect(detectKind(EXE)).toBeNull();
  });

  it("strips path components and control characters from display names", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName("C:\\Users\\x\\bill<script>.pdf")).toBe("billscript.pdf");
    expect(safeDisplayName("a\u0000b.pdf")).toBe("ab.pdf");
  });
});

describe("security scan", () => {
  it("blocks the EICAR test signature", async () => {
    const eicar = new TextEncoder().encode("%PDF-1.4 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect((await basicScanner.scan(eicar, "pdf")).status).toBe("infected");
  });

  it("blocks PDFs with active content", async () => {
    const js = new TextEncoder().encode("%PDF-1.7 << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>");
    expect((await basicScanner.scan(js, "pdf")).status).toBe("infected");
    const launch = new TextEncoder().encode("%PDF-1.7 << /Launch << /F (cmd.exe) >> >>");
    expect((await basicScanner.scan(launch, "pdf")).status).toBe("infected");
  });

  it("passes ordinary documents", async () => {
    expect((await basicScanner.scan(PDF, "pdf")).status).toBe("clean");
  });
});

describe("storage keys (path traversal)", () => {
  it("only accepts server-generated keys", () => {
    expect(() => assertSafeKey("3f2b8f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.pdf")).not.toThrow();
    for (const bad of ["../x.pdf", "..\\..\\x.pdf", "/etc/passwd", "a.pdf", "3f2b8f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.exe", "3f2b8f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.pdf/../../x"]) {
      expect(() => assertSafeKey(bad), bad).toThrow();
    }
  });

  it("the local adapter refuses traversal keys", async () => {
    const s = localStorageAdapter("./.storage-test");
    await expect(s.get("../../package.json")).rejects.toThrow();
  });
});

describe("WEBP uploads (photo ID / policy card)", () => {
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

  it("accepts a real WEBP by content and refuses RIFF files that aren't WEBP or a mismatched extension", () => {
    expect(detectKind(WEBP)).toBe("webp");
    expect(detectKind(WAV)).toBeNull();
    expect(validateUpload({ name: "card.webp", size: WEBP.length, bytes: WEBP })).toMatchObject({ ok: true, kind: "webp", mime: "image/webp" });
    expect(validateUpload({ name: "card.png", size: WEBP.length, bytes: WEBP }).ok).toBe(false);
    expect(validateUpload({ name: "sound.webp", size: WAV.length, bytes: WAV }).ok).toBe(false);
  });
});
