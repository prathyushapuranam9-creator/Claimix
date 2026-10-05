import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { randomToken } from "@/lib/security/crypto";
import { PatientService } from "@/modules/patients/patients.service";
import { demoPrincipals, svc, testContext } from "./helpers";

const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const letters = () => randomToken(8).replace(/[^a-zA-Z]/g, "x").slice(0, 8);

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

describe("possible duplicate patient registration (warn, then confirm)", () => {
  it("warns about the same name and birth date at the same hospital, ignoring case and extra spaces", async () => {
    const name = `Dup Test ${letters()}`;
    const first = await PatientService.create(as("staffA"), { fullName: name, dob: "1985-03-04", gender: "female" });
    for (const variant of [name, name.toUpperCase(), `  ${name.replace(" ", "   ")}  `]) {
      const err = await PatientService.create(as("staffA"), { fullName: variant, dob: "1985-03-04", gender: "female" }).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors._duplicate).toEqual([`${first.id}|${first.patientNo}`]);
    }
  });

  it("nothing is created while the warning stands, and confirming registers a separate patient (audited)", async () => {
    const name = `Dup Confirm ${letters()}`;
    const first = await PatientService.create(as("staffA"), { fullName: name, dob: "1990-07-07", gender: "male" });
    await expect(PatientService.create(as("staffA"), { fullName: name, dob: "1990-07-07", gender: "male" })).rejects.toBeInstanceOf(ValidationError);
    const list = await PatientService.list(as("staffA"), { page: 1, pageSize: 50, q: name });
    expect(list.rows).toHaveLength(1);

    const second = await PatientService.create(as("staffA"), { fullName: name, dob: "1990-07-07", gender: "male", confirmDuplicate: true });
    expect(second.id).not.toBe(first.id);
    expect(second.patientNo).not.toBe(first.patientNo);
    const [audit] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "patient.created"), eq(auditLogs.resourceId, second.id)));
    expect(audit?.newState).toMatchObject({ confirmedPossibleDuplicate: true });
  });

  it("a different date of birth or name is not a duplicate", async () => {
    const name = `Dup Other ${letters()}`;
    await PatientService.create(as("staffA"), { fullName: name, dob: "1980-01-01", gender: "female" });
    await expect(PatientService.create(as("staffA"), { fullName: name, dob: "1980-01-02", gender: "female" })).resolves.toBeTruthy();
    await expect(PatientService.create(as("staffA"), { fullName: `${name} Jr`, dob: "1980-01-01", gender: "female" })).resolves.toBeTruthy();
  });

  it("only this hospital's own records are compared (another hospital's patient is never revealed)", async () => {
    const name = `Dup Cross ${letters()}`;
    await PatientService.create(as("staffB"), { fullName: name, dob: "1975-05-05", gender: "female" });
    await expect(PatientService.create(as("staffA"), { fullName: name, dob: "1975-05-05", gender: "female" })).resolves.toBeTruthy();
  });

  it("the unique patient-number rule still applies, with or without confirmation", async () => {
    const no = `DUPNO-${letters()}`;
    await PatientService.create(as("staffA"), { fullName: `Dup No ${letters()}`, dob: "1970-02-02", gender: "male", patientNo: no });
    await expect(PatientService.create(as("staffA"), { fullName: `Dup No Two ${letters()}`, dob: "1971-02-02", gender: "male", patientNo: no })).rejects.toBeInstanceOf(ConflictError);
    await expect(PatientService.create(as("staffA"), { fullName: `Dup No Three ${letters()}`, dob: "1972-02-02", gender: "male", patientNo: no, confirmDuplicate: true })).rejects.toBeInstanceOf(ConflictError);
  });
});
