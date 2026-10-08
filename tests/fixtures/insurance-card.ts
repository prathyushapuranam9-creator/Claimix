/**
 * Fictional insurance documents for tests: a real, minimal PDF whose text sits in an uncompressed
 * content stream, so the extractor reads it the way it reads a text-bearing PDF from a policy portal.
 * Every value here is DEMO DATA and matches the fictional policies in `tests/fixtures/seed`.
 */

/** Builds a one-page PDF that prints each line, with a correct xref table. */
export function insuranceCardPdf(lines: string[]) {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = [
    "BT",
    "/F1 11 Tf",
    "40 800 Td",
    "14 TL",
    ...lines.map((l) => `(${escape(l)}) Tj T*`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const latin1 = Buffer.from(pdf, "latin1");
  const bytes = new Uint8Array(latin1.byteLength);
  bytes.set(latin1);
  return bytes;
}

/** An insurance card for the fictional "Aarogya Family Floater Plus" policy, as printed on a card. */
export const AAROGYA_CARD = [
  "AAROGYA SHIELD GENERAL INSURANCE (DEMO DATA)",
  "HEALTH INSURANCE CARD",
  "Policy name: Aarogya Family Floater Plus",
  "Insurance company: Aarogya Shield General Insurance",
  "Member ID: AAR-FF-778901",
  "Policy No: POL/AAR/2026/5512",
  "Insured name: Test Card Patient",
  "Policy holder: Test Card Patient",
  "Relationship: Self",
  "Cover start: 01/04/2026",
  "Cover end: 31/03/2027",
  "First inception date: 01/04/2021",
  "Sum insured: Rs. 5,00,000",
  "Available balance: Rs. 4,00,000",
  "24x7 helpline 1800-000-0001",
];

/** A policy schedule that prints the cover period as a range and the amount in lakh. */
export const NAVJEEVAN_SCHEDULE = [
  "NAVJEEVAN GENERAL INSURANCE (DEMO DATA)",
  "POLICY SCHEDULE",
  "Policy name: Navjeevan Super Top-Up 10L",
  "Membership No: NJV20260018452",
  "Policy period: 15 Jun 2026 to 14 Jun 2027",
  "Sum insured: 10 Lakh",
  "Relationship: Spouse",
];

/** A card that states almost nothing: the extractor must leave the rest blank, not guess. */
export const SPARSE_CARD = ["HEALTH CARD", "Member ID: XYZ-001-22", "Issued by the hospital insurance desk"];
