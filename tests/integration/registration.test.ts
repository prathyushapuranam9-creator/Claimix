import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { appointments, auditLogs, doctorSlots, patients, preAuthorizations } from "@/db/schema";
import { DEMO } from "@/tests/fixtures/seed/ids";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { randomToken } from "@/lib/security/crypto";
import { todayIso } from "@/lib/validation";
import { PatientService } from "@/modules/patients/patients.service";
import { SchedulingRepository } from "@/modules/scheduling/scheduling.repository";
import { DoctorService, RegistrationService } from "@/modules/scheduling/scheduling.service";
import { CONSENT_REQUIRED } from "@/modules/scheduling/scheduling.validation";
import { demoPrincipals, svc, testContext } from "./helpers";

/**
 * Front-desk registration: find or enter the patient, choose a doctor and a free slot, record the
 * payment state and the acknowledgement — and only then is anything written.
 */
const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);
const ALL = { page: 1, pageSize: 100 };

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
});
afterAll(() => ctx.close());

const alpha = () => randomToken(6).replace(/[^a-zA-Z]/g, "x").slice(0, 6);

const newPatient = (over: Record<string, unknown> = {}) => ({
  fullName: `Reception Test ${alpha()}`,
  dob: "1986-03-03",
  gender: "female" as const,
  phone: "+91 98765 43210",
  ...over,
});

/**
 * A free slot of one of Hospital A's fixture doctors, from the first opened day that still has room,
 * so one test never exhausts another's slots.
 */
async function freeSlot(doctorId: string = DEMO.doctor.aGeneral) {
  const { daysWithFreeSlots } = await RegistrationService.availability(as("staffA"), doctorId, todayIso());
  for (const day of daysWithFreeSlots) {
    const { slots } = await RegistrationService.availability(as("staffA"), doctorId, day.slotDate);
    const free = slots.find((s) => !s.taken);
    if (free) return { ...free, slotDate: day.slotDate };
  }
  throw new Error("the fixtures have no free slot left");
}

const registration = (over: Record<string, unknown> = {}) => ({
  newPatient: newPatient(),
  visitType: "opd_consultation" as const,
  doctorId: DEMO.doctor.aGeneral,
  paymentMethod: "cash" as const,
  collectPaymentLater: false,
  consentAcknowledged: true,
  ...over,
});

describe("Step 1: find the patient before creating one", () => {
  it("finds this hospital's patients by name, patient number and mobile number", async () => {
    const name = `Findable Patient ${alpha()}`;
    const created = await PatientService.create(as("staffA"), { fullName: name, dob: "1990-02-02", gender: "male", phone: "+91 90000 12345" });

    expect((await RegistrationService.findPatients(as("staffA"), name)).map((p) => p.id)).toContain(created.id);
    expect((await RegistrationService.findPatients(as("staffA"), created.patientNo)).map((p) => p.id)).toContain(created.id);
    // Digits only: the stored number has a country code and spaces.
    expect((await RegistrationService.findPatients(as("staffA"), "9000012345")).map((p) => p.id)).toContain(created.id);
  });

  it("never finds another hospital's patients", async () => {
    const found = await RegistrationService.findPatients(as("staffB"), "Demo Patient Anil");
    expect(found.map((p) => p.id)).not.toContain(DEMO.patient.a1);
  });

  it("ignores a search too short to be meaningful", async () => {
    expect(await RegistrationService.findPatients(as("staffA"), "a")).toEqual([]);
  });
});

describe("Step 2: doctors and slots", () => {
  it("offers only departments that have a doctor taking appointments at this hospital", async () => {
    const departments = await RegistrationService.departments(as("staffA"));
    expect(departments).toContain("general_medicine");
    expect(departments).toContain("cardiology");
    // Hospital B's fixture doctor is in general medicine only.
    expect(await RegistrationService.departments(as("staffB"))).toEqual(["general_medicine"]);
  });

  it("offers only this hospital's doctors", async () => {
    const mine = await RegistrationService.doctors(as("staffA"), "general_medicine");
    expect(mine.map((d) => d.id)).toContain(DEMO.doctor.aGeneral);
    expect(mine.map((d) => d.id)).not.toContain(DEMO.doctor.bGeneral);
  });

  it("refuses another hospital's doctor's availability", async () => {
    await expect(RegistrationService.availability(as("staffB"), DEMO.doctor.aGeneral, todayIso())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("marks a slot as taken once it is booked, and offers the days that still have room", async () => {
    const slot = await freeSlot();
    await RegistrationService.register(as("staffA"), registration({ slotId: slot.id }));
    const after = await RegistrationService.availability(as("staffA"), DEMO.doctor.aGeneral, slot.slotDate);
    expect(after.slots.find((s) => s.id === slot.id)?.taken).toBe(true);
    expect(after.daysWithFreeSlots.length).toBeGreaterThan(0);
    expect(after.doctor.consultationFee).toBe("600.00");
  });
});

describe("Step 3: the registration is what creates the patient", () => {
  it("creates the patient, the visit, the doctor and slot assignment, the payment and the consent together", async () => {
    const slot = await freeSlot();
    const details = newPatient();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, newPatient: details, visitType: "ip_admission" }));

    expect(done.patient.patientNo).toMatch(/^PT-/);
    expect(done.doctorName).toContain("Dr Asha Rao");
    expect(done.slot.startsAt).toBe(slot.startsAt);
    expect(done.appointment).toMatchObject({
      hospitalId: DEMO.org.hospitalA,
      patientId: done.patient.id,
      doctorId: DEMO.doctor.aGeneral,
      slotId: slot.id,
      department: "general_medicine",
      visitType: "ip_admission",
      status: "booked",
      consultationFee: "600.00",
      amountCollected: "600.00",
      paymentMethod: "cash",
      paymentState: "paid",
    });
    expect(done.appointment.reference).toMatch(/^REG-\d{8}-[A-Z0-9]{6}$/);
    expect(done.appointment.consentAcknowledgedBy).toBe(who.staffA.userId);
    expect(done.appointment.consentAcknowledgedAt).toBeInstanceOf(Date);

    // The patient exists, with the visit against them.
    const [stored] = await ctx.db.select().from(patients).where(eq(patients.id, done.patient.id));
    expect(stored!.hospitalId).toBe(DEMO.org.hospitalA);
    const visits = await RegistrationService.forPatient(as("staffA"), done.patient.id);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ reference: done.appointment.reference, doctorName: expect.stringContaining("Dr Asha Rao"), paymentState: "paid" });

    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.completed"), eq(auditLogs.resourceId, done.appointment.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.newState).toMatchObject({ newPatient: true, consentAcknowledged: true, paymentState: "paid" });
  });

  it("records a visit against an existing patient without creating a second patient record", async () => {
    const existing = await PatientService.create(as("staffA"), newPatient({ fullName: `Returning Patient ${alpha()}` }));
    const before = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(patients).where(eq(patients.hospitalId, DEMO.org.hospitalA));
    const slot = await freeSlot();

    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, newPatient: undefined, patientId: existing.id }));
    expect(done.patient.id).toBe(existing.id);
    expect(done.patient.patientNo).toBe(existing.patientNo);

    const after = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(patients).where(eq(patients.hospitalId, DEMO.org.hospitalA));
    expect(after[0]!.n).toBe(before[0]!.n);
    expect(await RegistrationService.forPatient(as("staffA"), existing.id)).toHaveLength(1);
  });

  it("writes nothing at all when the acknowledgement is missing", async () => {
    const slot = await freeSlot();
    const details = newPatient({ fullName: `No Consent ${alpha()}` });
    await expect(RegistrationService.register(as("staffA"), registration({ slotId: slot.id, newPatient: details, consentAcknowledged: false }))).rejects.toThrow(CONSENT_REQUIRED);

    // No patient, and the slot is still free: filling the form is not registering.
    expect(await ctx.db.select().from(patients).where(eq(patients.fullName, details.fullName))).toHaveLength(0);
    const after = await RegistrationService.availability(as("staffA"), DEMO.doctor.aGeneral, slot.slotDate);
    expect(after.slots.find((s) => s.id === slot.id)?.taken).toBe(false);
  });

  it("writes nothing when the payment state is not handled", async () => {
    const slot = await freeSlot();
    const details = newPatient({ fullName: `No Payment ${alpha()}` });
    await expect(
      RegistrationService.register(as("staffA"), registration({ slotId: slot.id, newPatient: details, paymentMethod: undefined, collectPaymentLater: false })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await ctx.db.select().from(patients).where(eq(patients.fullName, details.fullName))).toHaveLength(0);
  });

  it("records a payment left to be collected later, with no method or amount", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(
      as("staffA"),
      registration({ slotId: slot.id, paymentMethod: undefined, collectPaymentLater: true }),
    );
    expect(done.appointment.paymentState).toBe("pending");
    expect(done.appointment.paymentMethod).toBeNull();
    expect(done.appointment.amountCollected).toBeNull();
    // The fee is still recorded, so the amount to collect is known.
    expect(done.appointment.consultationFee).toBe("600.00");
  });

  it("refuses a method and 'collect later' together", async () => {
    const slot = await freeSlot();
    await expect(
      RegistrationService.register(as("staffA"), registration({ slotId: slot.id, paymentMethod: "upi", collectPaymentLater: true })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("warns about a repeat registration instead of silently creating a duplicate patient", async () => {
    const name = `Duplicate Desk ${alpha()}`;
    const first = await RegistrationService.register(as("staffA"), registration({ slotId: (await freeSlot()).id, newPatient: newPatient({ fullName: name }) }));

    const again = RegistrationService.register(as("staffA"), registration({ slotId: (await freeSlot()).id, newPatient: newPatient({ fullName: name }) }));
    await expect(again).rejects.toBeInstanceOf(ValidationError);
    await again.catch((e: ValidationError) => expect(e.fieldErrors?._duplicate?.[0]).toContain(first.patient.id));

    // Confirming registers the namesake as a separate patient, as the patient form does.
    const confirmed = await RegistrationService.register(
      as("staffA"),
      registration({ slotId: (await freeSlot()).id, newPatient: newPatient({ fullName: name, confirmDuplicate: true }) }),
    );
    expect(confirmed.patient.id).not.toBe(first.patient.id);
  });
});

describe("A slot can only be taken once", () => {
  it("refuses a slot another registration already holds", async () => {
    const slot = await freeSlot();
    await RegistrationService.register(as("staffA"), registration({ slotId: slot.id }));
    await expect(RegistrationService.register(as("staffA"), registration({ slotId: slot.id }))).rejects.toBeInstanceOf(ConflictError);
    expect(await ctx.db.select().from(appointments).where(eq(appointments.slotId, slot.id))).toHaveLength(1);
  });

  it("refuses a slot that is not the chosen doctor's", async () => {
    const other = await freeSlot(DEMO.doctor.aCardiology);
    await expect(RegistrationService.register(as("staffA"), registration({ slotId: other.id, doctorId: DEMO.doctor.aGeneral }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses another hospital's doctor", async () => {
    const slot = await freeSlot();
    await expect(RegistrationService.register(as("staffA"), registration({ slotId: slot.id, doctorId: DEMO.doctor.bGeneral }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an existing patient of another hospital", async () => {
    const slot = await freeSlot();
    await expect(
      RegistrationService.register(as("staffA"), registration({ slotId: slot.id, newPatient: undefined, patientId: DEMO.patient.b1 })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the database refuses a registration whose links do not agree", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id }));
    // Moving the visit to another hospital's doctor is refused whatever issues the statement.
    const err = await ctx.db
      .execute(sql`update appointments set doctor_id = ${DEMO.doctor.bGeneral} where id = ${done.appointment.id}`)
      .then(() => null, (e: unknown) => e);
    const chain: string[] = [];
    for (let e = err as { message?: string; cause?: unknown } | null; e; e = (e.cause ?? null) as typeof e) chain.push(e.message ?? "");
    expect(chain.join(" | ")).toMatch(/practises at hospital|is in department/);
  });
});

describe("Who may register", () => {
  it("is refused to a payer reviewer and to a patient portal user", async () => {
    const slot = await freeSlot();
    await expect(RegistrationService.register(as("insurerA"), registration({ slotId: slot.id }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(RegistrationService.register(as("patientA1"), registration({ slotId: slot.id }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists only the caller's own hospital's registrations", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id }));
    const mine = await RegistrationService.list(as("staffA"), ALL, {});
    expect(mine.rows.map((r) => r.id)).toContain(done.appointment.id);
    const other = await RegistrationService.list(as("staffB"), ALL, {});
    expect(other.rows.map((r) => r.id)).not.toContain(done.appointment.id);
  });
});

describe("Doctors and slots are administrator reference data", () => {
  it("hospital staff cannot add a doctor or open slots", async () => {
    await expect(DoctorService.add(as("staffA"), { hospitalId: DEMO.org.hospitalA, fullName: "Dr Nobody", department: "cardiology", consultationFee: 100 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(DoctorService.openSlots(as("staffA"), { doctorId: DEMO.doctor.aGeneral, slotDate: todayIso(), from: "14:00", to: "15:00", minutes: 30 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an administrator adds a doctor and opens slots, and re-opening the same period adds nothing", async () => {
    const doctor = await DoctorService.add(as("admin"), {
      hospitalId: DEMO.org.hospitalA,
      fullName: `Dr Added ${alpha()}`,
      department: "neurology",
      registrationNo: "MR-NEW-1",
      consultationFee: 750,
    });
    expect(doctor.consultationFee).toBe("750.00");

    const date = todayIso();
    const first = await DoctorService.openSlots(as("admin"), { doctorId: doctor.id, slotDate: date, from: "15:00", to: "16:00", minutes: 20 });
    expect(first).toEqual({ opened: 3, requested: 3 });
    const again = await DoctorService.openSlots(as("admin"), { doctorId: doctor.id, slotDate: date, from: "15:00", to: "16:00", minutes: 20 });
    expect(again).toEqual({ opened: 0, requested: 3 });
    expect(await ctx.db.select().from(doctorSlots).where(and(eq(doctorSlots.doctorId, doctor.id), eq(doctorSlots.slotDate, date)))).toHaveLength(3);

    // The new department becomes bookable at that hospital.
    expect(await RegistrationService.departments(as("staffA"))).toContain("neurology");
  });

  it("refuses a period shorter than one slot", async () => {
    await expect(
      DoctorService.openSlots(as("admin"), { doctorId: DEMO.doctor.aGeneral, slotDate: todayIso(), from: "15:00", to: "15:10", minutes: 30 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ----------------------------------------------------------- visit types, admissions, payment, ABHA

describe("Visit types", () => {
  it("offers OPD consultation, IP admission and pre-auth", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, visitType: "pre_auth" }));
    expect(done.appointment.visitType).toBe("pre_auth");
    // A pre-auth registration is a visit, not an insurance request: none is created here.
    expect(done.admission).toBeNull();
    const [row] = await ctx.db.select().from(preAuthorizations).where(eq(preAuthorizations.patientId, done.patient.id));
    expect(row).toBeUndefined();
  });

  it("opens a stay for an IP admission, with the details recorded", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(
      as("staffA"),
      registration({ slotId: slot.id, visitType: "ip_admission", admission: { ward: "Ward B", bed: "12", expectedStayDays: 4 } }),
    );
    expect(done.admission).toMatchObject({
      patientId: done.patient.id,
      hospitalId: DEMO.org.hospitalA,
      appointmentId: done.appointment.id,
      status: "admitted",
      ward: "Ward B",
      bed: "12",
      expectedStayDays: 4,
    });
    expect(done.admission!.dischargedAt).toBeNull();

    // The patient shows as in hospital until discharged.
    const admitted = await RegistrationService.currentAdmissions(as("staffA"));
    expect(admitted.map((a) => a.id)).toContain(done.admission!.id);
    const [visit] = await RegistrationService.forPatient(as("staffA"), done.patient.id);
    expect(visit).toMatchObject({ admissionStatus: "admitted", ward: "Ward B" });
  });

  it("opens no stay for an OPD consultation", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, visitType: "opd_consultation" }));
    expect(done.admission).toBeNull();
    expect(await SchedulingRepository.admissionForAppointment(ctx.db, done.appointment.id)).toBeUndefined();
  });

  it("the database refuses a stay against a visit that is not an admission", async () => {
    const slot = await freeSlot();
    const opd = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, visitType: "opd_consultation" }));
    const err = await ctx.db
      .execute(sql`insert into admissions (appointment_id, hospital_id, patient_id, admitted_by)
                   values (${opd.appointment.id}, ${DEMO.org.hospitalA}, ${opd.patient.id}, ${who.staffA.userId})`)
      .then(() => null, (e: unknown) => e);
    const chain: string[] = [];
    for (let e = err as { message?: string; cause?: unknown } | null; e; e = (e.cause ?? null) as typeof e) chain.push(e.message ?? "");
    expect(chain.join(" | ")).toMatch(/not an inpatient admission/);
  });
});

describe("Discharge", () => {
  it("ends the stay, once, and only for the admitting hospital", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, visitType: "ip_admission" }));
    const admissionId = done.admission!.id;

    await expect(RegistrationService.discharge(as("staffB"), admissionId, {})).rejects.toBeInstanceOf(NotFoundError);

    const discharged = await RegistrationService.discharge(as("staffA"), admissionId, { note: "Stable, advised rest." });
    expect(discharged.status).toBe("discharged");
    expect(discharged.dischargedAt).toBeInstanceOf(Date);
    expect(discharged.dischargedBy).toBe(who.staffA.userId);
    expect(discharged.dischargeNote).toBe("Stable, advised rest.");

    await expect(RegistrationService.discharge(as("staffA"), admissionId, {})).rejects.toBeInstanceOf(ConflictError);
    expect((await RegistrationService.currentAdmissions(as("staffA"))).map((a) => a.id)).not.toContain(admissionId);
  });
});

describe("Payment at the desk", () => {
  it("records the method and a non-sensitive reference", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, paymentMethod: "card", paymentReference: "****4242" }));
    expect(done.appointment).toMatchObject({ paymentState: "paid", paymentMethod: "card", paymentReference: "****4242", amountCollected: "600.00" });
  });

  it("refuses a reference that is not a reference", async () => {
    const slot = await freeSlot();
    await expect(
      RegistrationService.register(as("staffA"), registration({ slotId: slot.id, paymentMethod: "upi", paymentReference: "4111 1111 1111 1111; drop" })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a reference on a cash payment", async () => {
    const slot = await freeSlot();
    await expect(
      RegistrationService.register(as("staffA"), registration({ slotId: slot.id, paymentMethod: "cash", paymentReference: "X1" })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("settles a visit with no fee without asking for a method", async () => {
    const free = await DoctorService.add(as("admin"), { hospitalId: DEMO.org.hospitalA, fullName: `Dr Free ${alpha()}`, department: "psychiatry", consultationFee: 0 });
    await DoctorService.openSlots(as("admin"), { doctorId: free.id, slotDate: todayIso(), from: "16:00", to: "17:00", minutes: 30 });
    const { slots } = await RegistrationService.availability(as("staffA"), free.id, todayIso());
    const slot = slots.find((s) => !s.taken)!;

    const done = await RegistrationService.register(
      as("staffA"),
      registration({ slotId: slot.id, doctorId: free.id, paymentMethod: undefined, collectPaymentLater: false }),
    );
    expect(done.appointment).toMatchObject({ consultationFee: "0.00", paymentState: "paid", paymentMethod: null, amountCollected: "0.00" });
  });
});

describe("ABHA", () => {
  it("records an ABHA number and address as presented, and never requires them", async () => {
    const withAbha = await RegistrationService.register(
      as("staffA"),
      registration({ slotId: (await freeSlot()).id, newPatient: newPatient({ abhaNumber: "12-3456-7890-1234", abhaAddress: "Patient.Demo@ABDM" }) }),
    );
    const [stored] = await ctx.db.select().from(patients).where(eq(patients.id, withAbha.patient.id));
    // Stored digits-only and lower-cased; otherwise exactly as presented.
    expect(stored!.abhaNumber).toBe("12345678901234");
    expect(stored!.abhaAddress).toBe("patient.demo@abdm");

    const without = await RegistrationService.register(as("staffA"), registration({ slotId: (await freeSlot()).id }));
    const [plain] = await ctx.db.select().from(patients).where(eq(patients.id, without.patient.id));
    expect(plain!.abhaNumber).toBeNull();
    expect(plain!.abhaAddress).toBeNull();
  });

  it("refuses an ABHA number or address that is not one", async () => {
    for (const bad of [{ abhaNumber: "1234" }, { abhaAddress: "not-an-address" }]) {
      await expect(
        RegistrationService.register(as("staffA"), registration({ slotId: (await freeSlot()).id, newPatient: newPatient(bad) })),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("keeps the ABHA number out of the audit trail", async () => {
    const done = await RegistrationService.register(
      as("staffA"),
      registration({ slotId: (await freeSlot()).id, newPatient: newPatient({ abhaNumber: "99-8877-6655-4433" }) }),
    );
    const rows = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, "patient.created"), eq(auditLogs.resourceId, done.patient.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.newState).toMatchObject({ hasAbha: true });
    expect(JSON.stringify(rows[0]!.newState)).not.toContain("998877665544");
  });
});

describe("The day sheet", () => {
  it("filters by date and by what is still to collect", async () => {
    const slot = await freeSlot();
    const paid = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id }));
    const later = await RegistrationService.register(
      as("staffA"),
      registration({ slotId: (await freeSlot()).id, paymentMethod: undefined, collectPaymentLater: true }),
    );

    const pending = await RegistrationService.list(as("staffA"), ALL, { paymentState: "pending" });
    expect(pending.rows.map((r) => r.id)).toContain(later.appointment.id);
    expect(pending.rows.map((r) => r.id)).not.toContain(paid.appointment.id);

    const collected = await RegistrationService.list(as("staffA"), ALL, { paymentState: "paid" });
    expect(collected.rows.map((r) => r.id)).toContain(paid.appointment.id);

    const otherDay = await RegistrationService.list(as("staffA"), ALL, { slotDate: "2020-01-01" });
    expect(otherDay.rows).toHaveLength(0);
  });

  it("counts the day for the front-desk dashboard, including inpatients", async () => {
    const slot = await freeSlot();
    const done = await RegistrationService.register(as("staffA"), registration({ slotId: slot.id, visitType: "ip_admission" }));
    const overview = await RegistrationService.dayOverview(as("staffA"), slot.slotDate);
    expect(overview!.booked).toBeGreaterThan(0);
    expect(overview!.inHospital).toBeGreaterThan(0);
    // `upcoming` is the first page of the day; the registration itself is on the day's full list.
    expect(overview!.upcoming.length).toBeGreaterThan(0);
    const day = await RegistrationService.list(as("staffA"), ALL, { slotDate: slot.slotDate });
    expect(day.rows.map((r) => r.id)).toContain(done.appointment.id);
  });
});
