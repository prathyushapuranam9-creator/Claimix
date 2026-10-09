"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/actions";
import { RegistrationService } from "@/modules/scheduling/scheduling.service";
import type { DischargeInput, RegistrationInput } from "@/modules/scheduling/scheduling.validation";
import type { Availability, DoctorOption, FoundPatient, RegistrationResult } from "@/components/patients/RegistrationWizard";

/** Step 1: existing patients at this hospital matching name, patient number or mobile. */
export async function findPatientsAction(q: string): Promise<ActionResult<FoundPatient[]>> {
  return runAction("registration.find_patients", async () => (await RegistrationService.findPatients(await actionContext(), q)) as FoundPatient[]);
}

/** Step 2: the doctors of one department at this hospital. */
export async function doctorsForDepartmentAction(department: string): Promise<ActionResult<DoctorOption[]>> {
  return runAction("registration.doctors", async () => (await RegistrationService.doctors(await actionContext(), department)) as DoctorOption[]);
}

/** Step 2: a doctor's slots on one date, each marked free or already booked. */
export async function availabilityAction(doctorId: string, slotDate: string): Promise<ActionResult<Availability>> {
  return runAction("registration.availability", async () => RegistrationService.availability(await actionContext(), doctorId, slotDate));
}

/**
 * The final action: the patient (created now if new), the visit, the doctor and slot, the payment state
 * and the acknowledgement, in one transaction. Only this makes the patient registered.
 */
export async function registerPatientAction(input: RegistrationInput): Promise<ActionResult<RegistrationResult>> {
  const r = await runAction("registration.complete", async () => {
    const done = await RegistrationService.register(await actionContext(), input);
    return {
      reference: done.appointment.reference,
      patientId: done.patient.id,
      patientNo: done.patient.patientNo,
      patientName: done.patient.fullName,
      doctorName: done.doctorName,
      department: done.appointment.department,
      visitType: done.appointment.visitType,
      slotDate: done.slot.slotDate,
      startsAt: done.slot.startsAt,
      endsAt: done.slot.endsAt,
      status: done.appointment.status,
      paymentState: done.appointment.paymentState,
    } satisfies RegistrationResult;
  });
  if (r.ok) {
    revalidatePath("/patients");
    revalidatePath(`/patients/${r.data.patientId}`);
  }
  return r;
}

/** Ends an inpatient stay. The appointment and its payment stay on the patient's record. */
export async function dischargeAction(admissionId: string, input: DischargeInput = {}): Promise<ActionResult> {
  const r = await runAction("admission.discharge", async () => {
    await RegistrationService.discharge(await actionContext(), admissionId, input);
    return undefined;
  });
  if (r.ok) {
    revalidatePath("/appointments");
    revalidatePath("/dashboard");
  }
  return r;
}
