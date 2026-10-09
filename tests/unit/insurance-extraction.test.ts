import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  documentText,
  matchPolicy,
  parseDocumentAmount,
  parseDocumentDate,
  parseInsuranceDetails,
  type PolicyOption,
} from "@/modules/documents/insurance-extraction";
import { AAROGYA_CARD, insuranceCardPdf, NAVJEEVAN_SCHEDULE, SPARSE_CARD } from "@/tests/fixtures/insurance-card";

const POLICIES: PolicyOption[] = [
  { id: "p-floater", name: "Aarogya Family Floater Plus (DEMO DATA)", category: "private", insurerName: "Aarogya Shield General Insurance (DEMO DATA)" },
  { id: "p-individual", name: "Suraksha Individual Health Secure (DEMO DATA)", category: "private", insurerName: "Suraksha Health Insurance (DEMO DATA)" },
  { id: "p-topup", name: "Navjeevan Super Top-Up 10L (DEMO DATA)", category: "private", insurerName: "Navjeevan General Insurance (DEMO DATA)" },
  { id: "p-senior", name: "Aarogya Senior Citizen Care (DEMO DATA)", category: "private", insurerName: "Aarogya Shield General Insurance (DEMO DATA)" },
  { id: "p-cghs", name: "CGHS inpatient benefit (DEMO DATA)", category: "government", schemeName: "Central Government Health Scheme (CGHS)" },
];

describe("dates as printed on Indian insurance documents", () => {
  it.each([
    ["15/06/2026", "2026-06-15"],
    ["15-06-2026", "2026-06-15"],
    ["15.06.2026", "2026-06-15"],
    ["15/06/26", "2026-06-15"],
    ["01/04/2026", "2026-04-01"],
    ["15 Jun 2026", "2026-06-15"],
    ["15-Jun-2026", "2026-06-15"],
    ["15 June 2026", "2026-06-15"],
    ["Jun 15, 2026", "2026-06-15"],
    ["2026-06-15", "2026-06-15"],
  ])("reads %s as %s", (raw, iso) => {
    expect(parseDocumentDate(raw)).toBe(iso);
  });

  it("reads numeric dates day-first, as the documents print them", () => {
    expect(parseDocumentDate("03/04/2026")).toBe("2026-04-03");
  });

  it("uses the only possible reading when the first number cannot be a month", () => {
    expect(parseDocumentDate("2026/06/15")).toBeUndefined(); // not a format these documents use
    expect(parseDocumentDate("06/15/2026")).toBe("2026-06-15"); // 15 can only be the day
  });

  it("refuses dates that do not exist, rather than shifting them", () => {
    expect(parseDocumentDate("31/02/2026")).toBeUndefined();
    expect(parseDocumentDate("00/06/2026")).toBeUndefined();
    expect(parseDocumentDate("not a date")).toBeUndefined();
  });
});

describe("rupee amounts as printed", () => {
  it.each([
    ["Rs. 5,00,000", 500000],
    ["₹10,00,000", 1000000],
    ["INR 1000000", 1000000],
    ["Rs 2,50,000/-", 250000],
    ["10 Lakh", 1000000],
    ["1.5 Crore", 15000000],
    ["4,00,000.50", 400000.5],
  ])("reads %s as %d", (raw, value) => {
    expect(parseDocumentAmount(raw)).toBe(value);
  });

  it("returns nothing when there is no amount", () => {
    expect(parseDocumentAmount("As per policy terms")).toBeUndefined();
    expect(parseDocumentAmount("")).toBeUndefined();
  });
});

describe("reading an insurance card", () => {
  const read = (lines: string[]) => parseInsuranceDetails(documentText(insuranceCardPdf(lines)));

  it("takes every labelled value from a card, and nothing else", () => {
    const { details, read: fields } = read(AAROGYA_CARD);
    expect(details).toMatchObject({
      memberId: "AAR-FF-778901",
      policyNumber: "POL/AAR/2026/5512",
      policyHolderName: "Test Card Patient",
      policyName: "Aarogya Family Floater Plus",
      insurerName: "Aarogya Shield General Insurance",
      relationship: "self",
      coverStart: "2026-04-01",
      coverEnd: "2027-03-31",
      inceptionDate: "2021-04-01",
      sumInsured: 500000,
      availableBalance: 400000,
    });
    // The label each value came from is kept, so staff can check it against the document.
    expect(fields.find((f) => f.field === "memberId")?.label).toBe("Member / beneficiary ID");
    expect(fields.every((f) => f.raw.length > 0)).toBe(true);
  });

  it("keeps the member ID and the policy number apart when the card prints both", () => {
    const { details } = read(AAROGYA_CARD);
    expect(details.memberId).toBe("AAR-FF-778901");
    expect(details.policyNumber).toBe("POL/AAR/2026/5512");
    expect(details.policyNumber).not.toBe(details.memberId);
  });

  it("keeps the available balance and the sum insured apart", () => {
    const { details } = read(AAROGYA_CARD);
    expect(details.sumInsured).toBe(500000);
    expect(details.availableBalance).toBe(400000);
  });

  it("reads a cover period printed as one range, and an amount in lakh", () => {
    const { details } = read(NAVJEEVAN_SCHEDULE);
    expect(details.coverStart).toBe("2026-06-15");
    expect(details.coverEnd).toBe("2027-06-14");
    expect(details.sumInsured).toBe(1000000);
    expect(details.memberId).toBe("NJV20260018452");
    expect(details.relationship).toBe("spouse");
  });

  it("leaves everything the document does not state blank", () => {
    const { details } = read(SPARSE_CARD);
    expect(details.memberId).toBe("XYZ-001-22");
    for (const k of ["coverStart", "coverEnd", "sumInsured", "availableBalance", "inceptionDate", "relationship"] as const) {
      expect(details[k]).toBeUndefined();
    }
  });

  it("reports an image with no text layer instead of inventing values", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(documentText(png)).toBe("");
    const { details, hasText } = parseInsuranceDetails(documentText(png));
    expect(hasText).toBe(false);
    expect(Object.keys(details)).toHaveLength(0);
  });

  it("drops a cover period that reads backwards rather than offering it", () => {
    const { details } = read(["Cover start: 31/03/2027", "Cover end: 01/04/2026"]);
    expect(details.coverStart).toBeUndefined();
    expect(details.coverEnd).toBeUndefined();
  });

  it("drops an available balance above the sum insured", () => {
    const { details } = read(["Sum insured: Rs. 1,00,000", "Available balance: Rs. 5,00,000"]);
    expect(details.sumInsured).toBe(100000);
    expect(details.availableBalance).toBeUndefined();
  });

  it("reads a value printed on the line under its label", () => {
    const { details } = read(["Member ID", "AAR-FF-999002", "Cover start", "01/04/2026"]);
    expect(details.memberId).toBe("AAR-FF-999002");
    expect(details.coverStart).toBe("2026-04-01");
  });
});

describe("compressed and multi-object PDFs", () => {
  /** A PDF whose content stream is Flate-encoded, as almost every real document is. */
  function compressedPdf(lines: string[]) {
    const content = ["BT", "/F1 11 Tf", "40 800 Td", "14 TL", ...lines.map((l) => `(${l}) Tj T*`), "ET"].join("\n");
    const z = deflateSync(Buffer.from(content, "latin1"));
    const head = [
      "%PDF-1.4",
      "1 0 obj",
      "<< /Type /Page /Contents 2 0 R >>",
      "endobj",
      "2 0 obj",
      `<< /Length ${z.length} /Filter /FlateDecode >>`,
      "stream",
      "",
    ].join("\n");
    const tail = ["", "endstream", "endobj", "3 0 obj", "<< /Type /Font >>", "endobj", "trailer", "<< /Root 1 0 R >>", "%%EOF", ""].join("\n");
    const all = Buffer.concat([Buffer.from(head, "latin1"), z, Buffer.from(tail, "latin1")]);
    const bytes = new Uint8Array(all.byteLength);
    bytes.set(all);
    return bytes;
  }

  it("inflates a Flate-encoded content stream and reads the labelled values", () => {
    const { details } = parseInsuranceDetails(documentText(compressedPdf(AAROGYA_CARD)));
    expect(details.memberId).toBe("AAR-FF-778901");
    expect(details.coverStart).toBe("2026-04-01");
    expect(details.sumInsured).toBe(500000);
  });

  it("reads each value once, however many objects the file has", () => {
    const { read } = parseInsuranceDetails(documentText(compressedPdf(AAROGYA_CARD)));
    const fields = read.map((r) => r.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe("matching the document to a policy in Claimix", () => {
  const match = (lines: string[]) => matchPolicy(documentText(insuranceCardPdf(lines)), POLICIES);

  it("picks the product the document names", () => {
    expect(match(AAROGYA_CARD)?.policy.id).toBe("p-floater");
    expect(match(NAVJEEVAN_SCHEDULE)?.policy.id).toBe("p-topup");
  });

  it("does not pick a different product of the same insurer", () => {
    expect(match(AAROGYA_CARD)?.policy.id).not.toBe("p-senior");
  });

  it("picks nothing when the document names no product", () => {
    expect(match(SPARSE_CARD)).toBeNull();
    expect(match(["Insurance company: Aarogya Shield General Insurance"])).toBeNull();
  });

  it("picks nothing rather than guessing between two equal matches", () => {
    const twins: PolicyOption[] = [
      { id: "a", name: "Family Floater Plus (DEMO DATA)", category: "private", insurerName: "Insurer One" },
      { id: "b", name: "Family Floater Plus (DEMO DATA)", category: "private", insurerName: "Insurer Two" },
    ];
    expect(matchPolicy(documentText(insuranceCardPdf(["Policy name: Family Floater Plus"])), twins)).toBeNull();
  });

  it("matches a government scheme record too", () => {
    expect(match(["Scheme: CGHS inpatient benefit", "Beneficiary ID: CGHS-0099"])?.policy.id).toBe("p-cghs");
  });
});
