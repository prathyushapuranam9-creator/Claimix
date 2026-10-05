import { describe, expect, it } from "vitest";
import { previewOf } from "@/modules/documents/document-preview";

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

describe("document preview type", () => {
  it("recognises PDFs, PNG screenshots and JPG/JPEG from their content", () => {
    expect(previewOf(bytes("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj 3 0 obj << /Type /Page >> endobj\n%%EOF")).kind).toBe("pdf");
    expect(previewOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toEqual({ kind: "image", mime: "image/png" });
    expect(previewOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ kind: "image", mime: "image/jpeg" });
  });

  it("accepts compressed PDFs whose pages live in object streams", () => {
    expect(previewOf(bytes("%PDF-1.7\n5 0 obj << /Type /ObjStm /N 3 /First 20 /Filter /FlateDecode >> stream\nxx\nendstream\n%%EOF")).kind).toBe("pdf");
  });

  it("flags a PDF with no pages, and refuses anything that isn't a supported type", () => {
    expect(previewOf(bytes("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF")).kind).toBe("empty_pdf");
    expect(previewOf(bytes("<html><script>alert(1)</script>")).kind).toBe("unsupported");
    expect(previewOf(bytes("GIF89a....")).kind).toBe("unsupported");
    expect(previewOf(new Uint8Array()).kind).toBe("unsupported");
  });
});
