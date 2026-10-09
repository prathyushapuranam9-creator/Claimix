import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { clean, wrap } from "@/modules/patients/patient-pdf";

/**
 * The case registration form (New Claim → Register Case) as a PDF: the case's sections as label / value rows, the
 * expected cost table, and the electronic signature with signer and time. Standard fonts only (Latin-1; the rupee
 * sign is written "Rs.").
 */
export interface RegistrationSheet {
  title: string;
  reference: string;
  hospital: string;
  sections: { title: string; rows: [string, string][] }[];
  cost: { head: string; covers: string; perDay: string; days: string; amount: string }[];
  costTotal: string;
  signature: { png: Uint8Array; signerName: string; signerRole: string; signedAt: string } | null;
  generatedAt: string;
  generatedBy: string;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 44;
const INK = rgb(0.11, 0.14, 0.17);
const MUTED = rgb(0.4, 0.45, 0.5);
const BRAND = rgb(0.06, 0.3, 0.38);
const RULE = rgb(0.84, 0.87, 0.9);
const BAND = rgb(0.95, 0.97, 0.98);

export async function buildRegistrationPdf(sheet: RegistrationSheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(clean(`${sheet.title} - ${sheet.reference}`));
  doc.setCreator("Claimix");
  doc.setProducer("Claimix");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = A4.w - 2 * M;
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - M;
  };
  const ensure = (need: number) => {
    if (y - need < M + 30) newPage();
  };
  newPage();

  // Header band.
  page.drawRectangle({ x: 0, y: A4.h - 92, width: A4.w, height: 92, color: BRAND });
  page.drawText(clean(sheet.title), { x: M, y: A4.h - 44, size: 17, font: bold, color: rgb(1, 1, 1) });
  page.drawText(clean(`Case ${sheet.reference}  |  ${sheet.hospital}`), { x: M, y: A4.h - 66, size: 10, font: regular, color: rgb(0.88, 0.94, 0.96) });
  y = A4.h - 92 - 28;

  const heading = (t: string) => {
    ensure(40);
    page.drawText(clean(t), { x: M, y, size: 12.5, font: bold, color: INK });
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: M + width, y: y - 6 }, thickness: 1, color: BRAND });
    y -= 22;
  };

  const labelW = 170;
  for (const sec of sheet.sections) {
    heading(sec.title);
    let shade = false;
    for (const [label, value] of sec.rows) {
      const lines = wrap(value && value.trim() ? value : "-", regular, 10, width - labelW - 16);
      const rowH = lines.length * 13 + 8;
      ensure(rowH);
      if (shade) page.drawRectangle({ x: M, y: y - rowH + 10, width, height: rowH, color: BAND });
      shade = !shade;
      page.drawText(clean(label), { x: M + 6, y, size: 9.5, font: bold, color: MUTED });
      let ly = y;
      for (const l of lines) {
        page.drawText(l, { x: M + labelW, y: ly, size: 10, font: regular, color: INK });
        ly -= 13;
      }
      y -= rowH;
    }
    y -= 8;
  }

  // Expected cost.
  heading("Expected cost");
  const cols = [
    { k: "head", t: "Head", w: 120 },
    { k: "covers", t: "What it covers", w: 170 },
    { k: "perDay", t: "Per day", w: 80 },
    { k: "days", t: "Days", w: 40 },
    { k: "amount", t: "Amount", w: width - 410 },
  ] as const;
  const row = (cells: Record<string, string>, font = regular) => {
    const wrapped = cols.map((c) => wrap(cells[c.k] ?? "", font, 9.5, c.w - 8));
    const h = Math.max(...wrapped.map((w) => w.length)) * 12 + 8;
    ensure(h);
    let x = M;
    cols.forEach((c, i) => {
      let ly = y;
      for (const l of wrapped[i]!) {
        page.drawText(l, { x: x + 4, y: ly, size: 9.5, font, color: INK });
        ly -= 12;
      }
      x += c.w;
    });
    y -= h;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: M + width, y: y + 6 }, thickness: 0.5, color: RULE });
  };
  row({ head: "Head", covers: "What it covers", perDay: "Per day", days: "Days", amount: "Amount" }, bold);
  for (const c of sheet.cost) row(c);
  row({ head: "", covers: "Expected cost", perDay: "", days: "", amount: sheet.costTotal }, bold);
  y -= 12;

  // Signature.
  heading("Signature");
  if (sheet.signature) {
    const img = await doc.embedPng(sheet.signature.png);
    const scale = Math.min(220 / img.width, 70 / img.height, 1);
    ensure(img.height * scale + 50);
    page.drawImage(img, { x: M, y: y - img.height * scale + 10, width: img.width * scale, height: img.height * scale });
    y -= img.height * scale + 6;
    page.drawText(clean(`Signed electronically by ${sheet.signature.signerName} (${sheet.signature.signerRole})`), { x: M, y, size: 9.5, font: bold, color: INK });
    y -= 13;
    page.drawText(clean(`on ${sheet.signature.signedAt}`), { x: M, y, size: 9.5, font: regular, color: INK });
    y -= 16;
  } else {
    ensure(40);
    page.drawText("Not signed yet.", { x: M, y, size: 10, font: regular, color: MUTED });
    y -= 18;
  }
  for (const l of wrap(
    "This is an electronic signature captured in Claimix (a drawn signature with the signer's identity and time). It is not a certified digital signature (DSC or Aadhaar eSign).",
    regular,
    8.5,
    width,
  )) {
    ensure(12);
    page.drawText(l, { x: M, y, size: 8.5, font: regular, color: MUTED });
    y -= 11;
  }

  // Footer on every page.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(clean(`Generated ${sheet.generatedAt} by ${sheet.generatedBy}  |  Page ${i + 1} of ${pages.length}`), { x: M, y: 24, size: 8, font: regular, color: MUTED });
  });
  return doc.save();
}
