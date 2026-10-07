import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * The printable patient details sheet: hospital letterhead (name, address, contact), the patient's details and their
 * coverage. Built with the PDF standard fonts, so text is limited to Latin-1 (the rupee sign is written "Rs.").
 */
export interface SheetHospital {
  name: string;
  registrationNo?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface SheetCoverage {
  policy: string;
  payer: string | null;
  memberId: string;
  relationship: string;
  period: string;
  sumInsured: string;
  available: string;
}

export interface PatientSheet {
  hospital: SheetHospital;
  title?: string;
  /** Label / value pairs, shown in order. */
  details: [string, string | null][];
  coverage: SheetCoverage[];
  generatedAt: string;
  generatedBy: string;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 44; // page margin
const INK = rgb(0.11, 0.14, 0.17);
const MUTED = rgb(0.4, 0.45, 0.5);
const BRAND = rgb(0.06, 0.3, 0.38);
const RULE = rgb(0.84, 0.87, 0.9);
const BAND = rgb(0.95, 0.97, 0.98);

/** The standard fonts cannot draw characters outside Latin-1. */
const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .trim();

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of clean(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) out.push(line);
      // A single very long word is cut to fit.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

export async function buildPatientSheet(sheet: PatientSheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Patient details - ${clean(sheet.details.find(([k]) => k === "Patient number")?.[1])}`);
  doc.setCreator("Claimix");
  doc.setProducer("Claimix");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = A4.w - 2 * M;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = A4.h - M;
  };
  const ensure = (need: number) => {
    if (y - need < M + 36) {
      newPage();
      y = A4.h - M;
    }
  };

  newPage();

  // Letterhead band: hospital name, address, contact.
  const h = sheet.hospital;
  const place = [h.city, h.state].filter(Boolean).join(", ");
  const addressLines = [...(h.address ? wrap(h.address, regular, 9.5, width - 32) : []), ...(place ? [clean(place)] : [])];
  const contact = [h.phone && `Phone: ${clean(h.phone)}`, h.email && `Email: ${clean(h.email)}`, h.registrationNo && `Reg. no: ${clean(h.registrationNo)}`].filter(Boolean).join("   |   ");
  const nameLines = wrap(h.name, bold, 18, width - 32);
  const bandH = 22 + nameLines.length * 22 + addressLines.length * 13 + (contact ? 16 : 0) + 12;
  page.drawRectangle({ x: 0, y: A4.h - bandH - 20, width: A4.w, height: bandH + 20, color: BRAND });
  let by = A4.h - 20 - 22;
  for (const l of nameLines) {
    page.drawText(l, { x: M, y: by, size: 18, font: bold, color: rgb(1, 1, 1) });
    by -= 22;
  }
  by += 6;
  for (const l of addressLines) {
    by -= 13;
    page.drawText(l, { x: M, y: by, size: 9.5, font: regular, color: rgb(0.88, 0.94, 0.96) });
  }
  if (contact) {
    by -= 16;
    page.drawText(clean(contact), { x: M, y: by, size: 9.5, font: regular, color: rgb(0.88, 0.94, 0.96) });
  }
  y = A4.h - bandH - 20 - 34;

  // Title.
  page.drawText(clean(sheet.title ?? "Patient Details"), { x: M, y, size: 16, font: bold, color: INK });
  page.drawLine({ start: { x: M, y: y - 8 }, end: { x: M + width, y: y - 8 }, thickness: 1.5, color: BRAND });
  y -= 30;

  // Details as label / value rows.
  const labelW = 150;
  let shade = false;
  for (const [label, value] of sheet.details) {
    const lines = wrap(value && value.trim() ? value : "-", regular, 10.5, width - labelW - 20);
    const rowH = Math.max(1, lines.length) * 14 + 10;
    ensure(rowH);
    if (shade) page.drawRectangle({ x: M, y: y - rowH + 6, width, height: rowH, color: BAND });
    shade = !shade;
    page.drawText(clean(label), { x: M + 8, y: y - 8, size: 10, font: bold, color: MUTED });
    lines.forEach((l, i) => page.drawText(l, { x: M + labelW + 8, y: y - 8 - i * 14, size: 10.5, font: regular, color: INK }));
    y -= rowH;
  }

  // Coverage table.
  y -= 18;
  ensure(60);
  page.drawText("Insurance & scheme coverage", { x: M, y, size: 13, font: bold, color: INK });
  page.drawLine({ start: { x: M, y: y - 6 }, end: { x: M + width, y: y - 6 }, thickness: 1, color: RULE });
  y -= 24;
  if (sheet.coverage.length === 0) {
    page.drawText("No coverage recorded.", { x: M, y, size: 10.5, font: regular, color: MUTED });
    y -= 16;
  }
  for (const c of sheet.coverage) {
    const cell = (label: string, v: string | null, x: number, w: number) => ({ label, lines: wrap(v ?? "-", regular, 10, w), x });
    const colW = (width - 16) / 2;
    const left = [cell("Policy / scheme", c.policy, M + 8, colW - 8), cell("Member ID", c.memberId, M + 8, colW - 8), cell("Cover period", c.period, M + 8, colW - 8)];
    const right = [cell("Insurer / scheme", c.payer, M + 8 + colW, colW - 8), cell("Relationship", c.relationship, M + 8 + colW, colW - 8), cell("Sum insured / available", `${c.sumInsured} / ${c.available}`, M + 8 + colW, colW - 8)];
    const blockH = (cells: typeof left) => cells.reduce((n, x) => n + 12 + x.lines.length * 13 + 4, 0);
    const boxH = Math.max(blockH(left), blockH(right)) + 12;
    ensure(boxH + 8);
    page.drawRectangle({ x: M, y: y - boxH + 10, width, height: boxH, borderColor: RULE, borderWidth: 1, color: rgb(1, 1, 1) });
    for (const col of [left, right]) {
      let cy = y - 6;
      for (const x of col) {
        page.drawText(clean(x.label), { x: x.x, y: cy, size: 8.5, font: bold, color: MUTED });
        cy -= 12;
        for (const l of x.lines) {
          page.drawText(l, { x: x.x, y: cy, size: 10, font: regular, color: INK });
          cy -= 13;
        }
        cy -= 4;
      }
    }
    y -= boxH + 10;
  }

  // Footer on every page.
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 18 }, end: { x: M + width, y: M + 18 }, thickness: 0.75, color: RULE });
    p.drawText(clean(`Generated ${sheet.generatedAt} by ${sheet.generatedBy} from Claimix`), { x: M, y: M + 5, size: 8, font: regular, color: MUTED });
    const right = `Confidential - patient information   |   Page ${i + 1} of ${pages.length}`;
    p.drawText(right, { x: M + width - regular.widthOfTextAtSize(right, 8), y: M + 5, size: 8, font: regular, color: MUTED });
  });

  return doc.save();
}
