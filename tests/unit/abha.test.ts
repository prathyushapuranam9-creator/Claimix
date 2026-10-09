import { describe, expect, it } from "vitest";
import { patientInputSchema } from "@/modules/patients/patients.validation";
import { admissionDetailsSchema, paymentCaptureSchema, VISIT_TYPES, VISIT_TYPE_LABEL } from "@/modules/scheduling/scheduling.validation";

const base = { fullName: "Test Person", dob: "1990-01-01", gender: "female" as const };

describe("ABHA is recorded as presented and never required", () => {
  it("accepts a patient with no ABHA at all", () => {
    const r = patientInputSchema.parse(base);
    expect(r.abhaNumber).toBeUndefined();
    expect(r.abhaAddress).toBeUndefined();
  });

  it("normalises the number to 14 digits and the address to lower case", () => {
    const r = patientInputSchema.parse({ ...base, abhaNumber: "12-3456-7890-1234", abhaAddress: "Name.Demo@ABDM" });
    expect(r.abhaNumber).toBe("12345678901234");
    expect(r.abhaAddress).toBe("name.demo@abdm");
  });

  it.each(["1234", "abcdefghijklmn", "123456789012345"])("refuses the number %s", (abhaNumber) => {
    expect(patientInputSchema.safeParse({ ...base, abhaNumber }).success).toBe(false);
  });

  it.each(["plain", "@abdm", "a@", "two words@abdm"])("refuses the address %s", (abhaAddress) => {
    expect(patientInputSchema.safeParse({ ...base, abhaAddress }).success).toBe(false);
  });

  it("treats blank fields as not given", () => {
    const r = patientInputSchema.parse({ ...base, abhaNumber: "", abhaAddress: "  " });
    expect(r.abhaNumber).toBeUndefined();
    expect(r.abhaAddress).toBeUndefined();
  });
});

describe("visit types and payment capture", () => {
  it("offers exactly OPD consultation, IP admission and pre-auth", () => {
    expect(VISIT_TYPES.map((v) => VISIT_TYPE_LABEL[v])).toEqual(["OPD consultation", "IP admission", "Pre-auth"]);
  });

  it("keeps a payment reference to a short handle, never free text", () => {
    expect(paymentCaptureSchema.safeParse({ reference: "****4242" }).success).toBe(true);
    expect(paymentCaptureSchema.safeParse({ reference: "UPI-REF-9001" }).success).toBe(true);
    expect(paymentCaptureSchema.safeParse({ reference: "4111 1111 1111 1111; drop" }).success).toBe(false);
  });

  it("bounds the inpatient details", () => {
    expect(admissionDetailsSchema.parse({ ward: "B", bed: "7", expectedStayDays: "3" }).expectedStayDays).toBe(3);
    expect(admissionDetailsSchema.safeParse({ expectedStayDays: 0 }).success).toBe(false);
    expect(admissionDetailsSchema.safeParse({ expectedStayDays: 400 }).success).toBe(false);
    expect(admissionDetailsSchema.parse({}).expectedStayDays).toBeUndefined();
  });
});
