import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { admissions, appointments, doctors, doctorSlots } from "@/db/schema";
import { DEMO } from "./ids";

const TAG = " (DEMO DATA)";

/** Fictional doctors at the fixture hospitals, with slots opened for front-desk registration. */
const DOCTOR_DEFS = [
  { id: DEMO.doctor.aGeneral, hospitalId: DEMO.org.hospitalA, fullName: "Dr Asha Rao" + TAG, department: "general_medicine", registrationNo: "DEMO-MR-0001", consultationFee: "600.00" },
  { id: DEMO.doctor.aCardiology, hospitalId: DEMO.org.hospitalA, fullName: "Dr Vivek Menon" + TAG, department: "cardiology", registrationNo: "DEMO-MR-0002", consultationFee: "900.00" },
  { id: DEMO.doctor.bGeneral, hospitalId: DEMO.org.hospitalB, fullName: "Dr Priya Nair" + TAG, department: "general_medicine", registrationNo: "DEMO-MR-0003", consultationFee: "500.00" },
];

/** A full clinic day in 20-minute slots, so a long test run never exhausts them. */
const SLOT_MINUTES = 20;
const TIMES = Array.from({ length: 24 }, (_, i) => {
  const total = 9 * 60 + i * SLOT_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
});

const addMinutes = (t: string, m: number) => {
  const [h, min] = t.split(":").map(Number) as [number, number];
  const total = h * 60 + min + m;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** Slots are opened relative to the run date, so the fixtures never go stale. */
function slotDates() {
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function seedScheduling(db: DbOrTx, opts: { resetDemoBalances?: boolean } = {}) {
  // Test databases only: free every fixture slot that an earlier run booked, so each run starts clean.
  if (opts.resetDemoBalances) {
    const onDemoSlot = sql`exists (select 1 from ${doctorSlots} s where s.id = ${appointments.slotId} and s.is_demo)`;
    // Stays reference their registration, so they go first.
    await db.delete(admissions).where(sql`exists (select 1 from ${appointments} a where a.id = ${admissions.appointmentId} and exists (select 1 from ${doctorSlots} s where s.id = a.slot_id and s.is_demo))`);
    await db.delete(appointments).where(onDemoSlot);
  }
  await db
    .insert(doctors)
    .values(DOCTOR_DEFS.map((d) => ({ ...d, isDemo: true })))
    .onConflictDoUpdate({ target: doctors.id, set: { fullName: sql`excluded.full_name`, consultationFee: sql`excluded.consultation_fee` } });

  const rows = DOCTOR_DEFS.flatMap((d) =>
    slotDates().flatMap((slotDate) => TIMES.map((startsAt) => ({ doctorId: d.id, slotDate, startsAt, endsAt: addMinutes(startsAt, SLOT_MINUTES), isDemo: true }))),
  );
  await db.insert(doctorSlots).values(rows).onConflictDoNothing();

  // Past days' slots are of no use to the fixtures and would accumulate; drop the unbooked ones.
  await db.delete(doctorSlots).where(
    sql`${doctorSlots.isDemo} and ${doctorSlots.slotDate} < current_date and not exists (select 1 from ${appointments} a where a.slot_id = ${doctorSlots.id})`,
  );
}

/** The fixture doctors, for tests that need one without querying. */
export const DEMO_DOCTORS = DOCTOR_DEFS;
