"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { ageOn, formatDate, formatINR } from "@/lib/india";
import { GENDER_LABEL, departmentLabel, patientInputSchema, type PatientInput } from "@/modules/patients/patients.validation";
import {
  CONSENT_POINTS,
  CONSENT_REQUIRED,
  VISIT_TYPES,
  VISIT_TYPE_HINT,
  VISIT_TYPE_LABEL,
  type RegistrationInput,
  type VisitType,
} from "@/modules/scheduling/scheduling.validation";
import type { SlotOption } from "@/modules/scheduling/scheduling.service";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Checkbox, Details, FormActions, FormGrid, FormSection, formStyles } from "@/components/ui/Form";
import { Alert, Badge, Card, EmptyState, Stack } from "@/components/ui/Surface";
import { WorkflowStepper } from "@/components/workflow/WorkflowStepper";
import { PatientFields } from "./PatientFields";
import { PaymentPanel, type PaymentChoice } from "./PaymentPanel";
import styles from "./RegistrationWizard.module.css";

export interface FoundPatient {
  id: string;
  fullName: string;
  patientNo: string;
  dob: string;
  gender: keyof typeof GENDER_LABEL;
  phone: string | null;
  department: string | null;
}

export interface DoctorOption {
  id: string;
  fullName: string;
  department: string;
  registrationNo: string | null;
  consultationFee: string;
}

export interface Availability {
  doctor: { id: string; fullName: string; department: string; consultationFee: string };
  slots: SlotOption[];
  daysWithFreeSlots: { slotDate: string; free: number }[];
}

export interface RegistrationResult {
  reference: string;
  patientId: string;
  patientNo: string;
  patientName: string;
  doctorName: string;
  department: string;
  visitType: string;
  slotDate: string;
  startsAt: string;
  endsAt: string;
  status: string;
  paymentState: string;
}

interface Props {
  /** Departments at this hospital that have a doctor taking appointments. */
  departments: string[];
  /** Only for platform admins, who must choose the registering hospital. */
  hospitals?: { id: string; name: string }[];
  findPatients: (q: string) => Promise<ActionResult<FoundPatient[]>>;
  doctorsFor: (department: string) => Promise<ActionResult<DoctorOption[]>>;
  availabilityFor: (doctorId: string, slotDate: string) => Promise<ActionResult<Availability>>;
  register: (input: RegistrationInput) => Promise<ActionResult<RegistrationResult>>;
  today: string;
}

const STEPS = ["Identify & details", "Doctor & slot", "Payment & register"] as const;

/** Only the new patient's own details go through the form; the rest of the wizard is plain state. */
const newPatientFormSchema = z.object({ newPatient: patientInputSchema });

type NewPatientForm = { newPatient: PatientInput };

/**
 * Front-desk registration in three steps: identify the patient (find an existing one or enter a new
 * one), choose the doctor and slot, then take payment and register. Nothing is written until the final
 * action, which creates the patient (when new) and the visit together — so an abandoned registration
 * never leaves a half-registered patient behind. The server re-checks every step when it runs.
 */
export function RegistrationWizard({ departments, hospitals, findPatients, doctorsFor, availabilityFor, register: submit, today }: Props) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"search" | "existing" | "new">("search");
  /** Which registration method was chosen for a new patient: with an ABHA, or without one. */
  const [withAbha, setWithAbha] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundPatient[] | null>(null);
  const [selected, setSelected] = useState<FoundPatient | null>(null);

  const [visitType, setVisitType] = useState<VisitType>("opd_consultation");
  const [dept, setDept] = useState("");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [bookingDate, setBookingDate] = useState(today);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [slotId, setSlotId] = useState("");

  const [payment, setPayment] = useState<PaymentChoice>({ method: "", collectLater: false });
  const [admissionDetails, setAdmissionDetails] = useState({ ward: "", bed: "", expectedStayDays: "" });
  const [consent, setConsent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ id: string; patientNo: string }[]>([]);
  const [done, setDone] = useState<RegistrationResult | null>(null);
  const [searching, startSearch] = useTransition();
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  const form = useForm<NewPatientForm>({
    resolver: zodResolver(newPatientFormSchema),
    defaultValues: { newPatient: { gender: "undisclosed" } as PatientInput },
  });
  const patientErrors = (form.formState.errors.newPatient ?? {}) as Record<string, { message?: string } | undefined>;

  // ---------------------------------------------------------------- step 1

  const runSearch = () =>
    startSearch(async () => {
      const r = await findPatients(query);
      setResults(r.ok ? r.data : []);
      setError(r.ok ? null : r.error);
    });

  const choose = (p: FoundPatient) => {
    setSelected(p);
    setMode("existing");
    if (p.department) pickDepartment(p.department);
  };

  const startNew = (abha: boolean) => {
    setMode("new");
    setWithAbha(abha);
    setSelected(null);
  };

  const patientIdentified = mode === "existing" ? !!selected : mode === "new";

  const toStepTwo = async () => {
    setError(null);
    if (mode === "new" && !(await form.trigger("newPatient"))) return;
    if (mode === "existing" && !selected) return;
    setStep(1);
  };

  // ---------------------------------------------------------------- step 2

  function pickDepartment(value: string) {
    setDept(value);
    setDoctorId("");
    setDoctors([]);
    setAvailability(null);
    setSlotId("");
    if (!value) return;
    startLoad(async () => {
      const r = await doctorsFor(value);
      setDoctors(r.ok ? r.data : []);
    });
  }

  const loadAvailability = (nextDoctorId: string, date: string) => {
    setSlotId("");
    setAvailability(null);
    if (!nextDoctorId || !date) return;
    startLoad(async () => {
      const r = await availabilityFor(nextDoctorId, date);
      setAvailability(r.ok ? r.data : null);
      if (!r.ok) setError(r.error);
    });
  };

  const pickDoctor = (value: string) => {
    setDoctorId(value);
    loadAvailability(value, bookingDate);
  };

  const pickDate = (value: string) => {
    setBookingDate(value);
    loadAvailability(doctorId, value);
  };

  const slotChosen = availability?.slots.find((s) => s.id === slotId) ?? null;
  const doctor = availability?.doctor ?? null;
  const fee = doctor?.consultationFee ?? null;
  const canReachStepThree = !!dept && !!doctorId && !!slotChosen && !slotChosen.taken;
  const feeDue = Number(fee ?? 0) > 0;
  // Nothing to collect when the doctor has no fee: the payment choice is then not asked for.
  const paymentHandled = !feeDue || payment.collectLater || !!payment.method;

  // ---------------------------------------------------------------- step 3

  const newPatientValues = () => form.getValues("newPatient");
  const summaryName = selected?.fullName ?? newPatientValues()?.fullName ?? null;
  const summaryDob = (selected?.dob ?? newPatientValues()?.dob) as string | undefined;
  const summaryGender = (selected?.gender ?? newPatientValues()?.gender) as keyof typeof GENDER_LABEL | undefined;
  const summaryPhone = (selected?.phone ?? newPatientValues()?.phone) as string | null | undefined;

  const runRegister = (confirmDuplicate: boolean) =>
    startSave(async () => {
      setError(null);
      const patient = mode === "new" ? { ...newPatientValues(), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) } : undefined;
      const r = await submit({
        patientId: selected?.id,
        newPatient: patient,
        visitType,
        doctorId,
        slotId,
        paymentMethod: payment.collectLater || !feeDue ? undefined : payment.method || undefined,
        paymentReference: payment.collectLater || !feeDue ? undefined : payment.reference,
        collectPaymentLater: payment.collectLater,
        admission: visitType === "ip_admission" ? admissionDetails : undefined,
        consentAcknowledged: consent,
      });
      if (r.ok) {
        setDuplicates([]);
        setDone(r.data);
        return;
      }
      const found = r.fieldErrors?.["newPatient._duplicate"] ?? r.fieldErrors?._duplicate;
      if (found?.length) {
        setDuplicates(found.map((x) => ({ id: x.split("|")[0]!, patientNo: x.split("|")[1] ?? "" })));
        return;
      }
      setDuplicates([]);
      setError(r.error);
    });

  if (done) {
    return (
      <Stack>
        <Alert tone="success" title="Patient registered successfully.">
          <p>
            Registration <span className="mono">{done.reference}</span> · patient <span className="mono">{done.patientNo}</span>
          </p>
        </Alert>
        <Card title="Registration">
          <Details
            columns={3}
            items={[
              ["Registration", <span key="r" className="mono">{done.reference}</span>],
              ["Patient ID / MRN", <span key="p" className="mono">{done.patientNo}</span>],
              ["Patient", done.patientName],
              ["Visit type", VISIT_TYPE_LABEL[done.visitType as VisitType] ?? done.visitType],
              ["Department", departmentLabel(done.department)],
              ["Doctor", done.doctorName],
              ["Appointment date", formatDate(done.slotDate)],
              ["Appointment time", `${done.startsAt} – ${done.endsAt}`],
              ["Status", <Badge key="s" tone="success">{done.status === "booked" ? "Booked" : done.status}</Badge>],
              ["Payment", done.paymentState === "paid" ? <Badge key="pay" tone="success">Collected</Badge> : <Badge key="pay" tone="warning">To collect</Badge>],
            ]}
          />
          <FormActions>
            <ButtonLink href={`/patients/${done.patientId}`}>Open patient</ButtonLink>
            <ButtonLink href="/patients/new" variant="secondary">Register another patient</ButtonLink>
          </FormActions>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack>
      <Card title="Registration steps">
        <WorkflowStepper steps={STEPS.map((label, i) => ({ key: label, label, state: i < step ? "done" : i === step ? "current" : "upcoming" }))} />
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* ------------------------------------------------ step 1 */}
      {step === 0 && (
        <Card title="Step 1 · Find or register a patient">
          <Stack>
            <FormSection title="Find the patient" hint="Search by name, patient number (MRN) or mobile number before creating a new record.">
              <div className={styles.search}>
                <TextField
                  label="Patient name, number or mobile"
                  value={query}
                  onChange={(ev) => setQuery(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      runSearch();
                    }
                  }}
                />
                <Button type="button" variant="secondary" loading={searching} onClick={runSearch}>Search patient</Button>
              </div>
            </FormSection>

            {results !== null && results.length > 0 && (
              <div>
                <p className={styles.resultsTitle}>Existing patients found — select one instead of creating a duplicate.</p>
                <ul className={styles.results}>
                  {results.map((p) => (
                    <li key={p.id} className={selected?.id === p.id ? styles.picked : undefined}>
                      <span>
                        <strong>{p.fullName}</strong> <span className="mono">{p.patientNo}</span>
                        <span className={styles.meta}>
                          {ageOn(p.dob)} y · {GENDER_LABEL[p.gender]}
                          {p.phone ? ` · ${p.phone}` : ""}
                        </span>
                      </span>
                      <Button type="button" size="sm" variant={selected?.id === p.id ? "primary" : "secondary"} onClick={() => choose(p)}>
                        {selected?.id === p.id ? "Selected" : "Select patient"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {results !== null && results.length === 0 && <EmptyState title="No existing patient matches that search">Create a new patient record below.</EmptyState>}

            {mode !== "new" && (
              <div className={styles.methodsRow}>
                <Button type="button" variant={results?.length ? "ghost" : "primary"} onClick={() => startNew(true)}>Register New ABHA</Button>
                <Button type="button" variant="secondary" onClick={() => startNew(false)}>Register Without ABHA ID</Button>
              </div>
            )}

            {mode === "existing" && selected && (
              <Alert tone="info" title="Registering an existing patient">
                <p>
                  {selected.fullName} (<span className="mono">{selected.patientNo}</span>) — a new visit will be added to this record. No second patient
                  record is created.
                </p>
              </Alert>
            )}

            {mode === "new" && (
              <form className={formStyles.form} noValidate onSubmit={(ev) => ev.preventDefault()}>
                {withAbha ? (
                  <Alert tone="info" title="Registering with an ABHA">
                    Enter the patient&apos;s ABHA number and address below as they present them. Claimix records them with the patient; it has no ABDM
                    connection, so nothing is verified with ABDM and no ABHA is created here.
                  </Alert>
                ) : (
                  <Alert tone="info" title="Registering without an ABHA ID">
                    No ABHA is needed or created. The patient is registered on their own details alone.
                  </Alert>
                )}
                <PatientFields
                  register={(n) => form.register(`newPatient.${n}` as const)}
                  errorFor={(n) => patientErrors[n]?.message}
                  hospitals={hospitals}
                  abha={withAbha}
                />
                <div>
                  <Button type="button" variant="ghost" onClick={() => setMode(selected ? "existing" : "search")}>Cancel new patient</Button>
                </div>
              </form>
            )}

            <FormSection title="Visit type" hint="What the patient is being registered for.">
              <FormGrid>
                <SelectField label="Visit type" required value={visitType} hint={VISIT_TYPE_HINT[visitType]} onChange={(ev) => setVisitType(ev.target.value as VisitType)}>
                  {VISIT_TYPES.map((v) => (
                    <option key={v} value={v}>{VISIT_TYPE_LABEL[v]}</option>
                  ))}
                </SelectField>
              </FormGrid>
              {visitType === "ip_admission" && (
                <Alert tone="info" title="Inpatient admission">
                  The patient will be admitted and stay in the hospital. Registering opens the admission; the stay runs until a discharge is recorded on
                  the patient&apos;s profile.
                </Alert>
              )}
              {visitType === "pre_auth" && (
                <Alert tone="warning" title="Pre-auth: approval requested before admission">
                  <p>
                    The visit is recorded as a pre-auth registration, so the planned treatment is on the patient&apos;s record with its doctor and estimate.
                  </p>
                  <p>
                    Sending the request to the payer is an insurance-side action, and this role does not hold it: an insurance user has to raise the
                    pre-authorization itself.
                  </p>
                </Alert>
              )}
            </FormSection>

            <FormActions>
              <ButtonLink href="/patients" variant="secondary">Cancel</ButtonLink>
              <Button type="button" disabled={!patientIdentified} onClick={() => void toStepTwo()}>Continue to doctor &amp; slot</Button>
            </FormActions>
            {!patientIdentified && <p className={styles.gate}>Find the patient or create a new record to continue.</p>}
          </Stack>
        </Card>
      )}

      {/* ------------------------------------------------ step 2 */}
      {step === 1 && (
        <Card title="Step 2 · Doctor &amp; slot">
          <Stack>
            {departments.length === 0 ? (
              <EmptyState title="No doctors are taking appointments yet">
                Ask an administrator to add doctors and open their slots under Administration → Doctors &amp; slots.
              </EmptyState>
            ) : (
              <>
                <FormGrid>
                  <SelectField label="Department" required value={dept} onChange={(ev) => pickDepartment(ev.target.value)}>
                    <option value="">Select department…</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>{departmentLabel(d)}</option>
                    ))}
                  </SelectField>
                  <SelectField label="Doctor" required disabled={!dept || loading} value={doctorId} onChange={(ev) => pickDoctor(ev.target.value)}>
                    <option value="">{dept ? "Select doctor…" : "Select a department first"}</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.fullName}</option>
                    ))}
                  </SelectField>
                  <TextField label="Booking date" type="date" required min={today} value={bookingDate} disabled={!doctorId} onChange={(ev) => pickDate(ev.target.value)} />
                </FormGrid>

                {doctorId && availability && (
                  <Details
                    columns={3}
                    items={[
                      ["Department", departmentLabel(dept)],
                      ["Doctor", availability.doctor.fullName],
                      [
                        "Consultation fee",
                        Number(availability.doctor.consultationFee) > 0 ? (
                          formatINR(availability.doctor.consultationFee)
                        ) : (
                          <span key="nofee">Not configured for this doctor</span>
                        ),
                      ],
                    ]}
                  />
                )}

                {visitType === "ip_admission" && doctorId && (
                  <FormSection title="Admission details" hint="Recorded with the stay; all optional at the desk.">
                    <FormGrid>
                      <TextField label="Ward" value={admissionDetails.ward} onChange={(ev) => setAdmissionDetails((a) => ({ ...a, ward: ev.target.value }))} />
                      <TextField label="Bed" value={admissionDetails.bed} onChange={(ev) => setAdmissionDetails((a) => ({ ...a, bed: ev.target.value }))} />
                      <TextField
                        label="Expected stay (days)"
                        inputMode="numeric"
                        value={admissionDetails.expectedStayDays}
                        onChange={(ev) => setAdmissionDetails((a) => ({ ...a, expectedStayDays: ev.target.value }))}
                      />
                    </FormGrid>
                  </FormSection>
                )}

                {doctorId && availability && (
                  <div>
                    <p className={styles.resultsTitle}>Available slots on {formatDate(bookingDate)}</p>
                    {availability.slots.length === 0 ? (
                      <EmptyState title="No slots on this date">
                        {availability.daysWithFreeSlots.length > 0
                          ? `This doctor has free slots on ${availability.daysWithFreeSlots.slice(0, 5).map((d) => formatDate(d.slotDate)).join(", ")}.`
                          : "This doctor has no open slots yet."}
                      </EmptyState>
                    ) : (
                      <div className={styles.slots} role="group" aria-label="Available slots">
                        {availability.slots.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={styles.slot}
                            data-state={s.taken ? "taken" : slotId === s.id ? "picked" : "free"}
                            disabled={s.taken}
                            aria-pressed={slotId === s.id}
                            onClick={() => setSlotId(s.id)}
                          >
                            {s.startsAt}
                            <span className={styles.slotState}>{s.taken ? "Booked" : slotId === s.id ? "Selected" : "Available"}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setStep(0)}>Back</Button>
              <Button type="button" disabled={!canReachStepThree} onClick={() => setStep(2)}>Continue to payment</Button>
            </FormActions>
            {!canReachStepThree && departments.length > 0 && <p className={styles.gate}>Select a department, a doctor and an available slot to continue.</p>}
          </Stack>
        </Card>
      )}

      {/* ------------------------------------------------ step 3 */}
      {step === 2 && (
        <Card title="Step 3 · Payment &amp; register">
          <Stack>
            {duplicates.length > 0 && (
              <Alert tone="warning" title="This patient may already be registered">
                <p>
                  A patient with the same name and date of birth is already registered at this hospital:{" "}
                  {duplicates.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ", "}
                      <Link href={`/patients/${d.id}`} target="_blank" rel="noopener noreferrer">{d.patientNo}</Link>
                    </span>
                  ))}
                  . Go back to step 1 and select the existing record, or register this person as a separate patient if they are not the same individual.
                </p>
                <FormActions>
                  <Button type="button" variant="secondary" loading={saving} onClick={() => runRegister(true)}>Register as a new patient anyway</Button>
                </FormActions>
              </Alert>
            )}

            <Details
              columns={3}
              items={[
                ["Patient", selected ? `${selected.fullName} (${selected.patientNo})` : summaryName],
                ["Age / gender", summaryDob ? `${ageOn(summaryDob)} y · ${summaryGender ? GENDER_LABEL[summaryGender] : "—"}` : null],
                ["Date of birth", formatDate(summaryDob)],
                ["Mobile number", summaryPhone ?? null],
                ["Visit type", VISIT_TYPE_LABEL[visitType]],
                ["Department", departmentLabel(dept)],
                ["Doctor", doctor?.fullName ?? null],
                ["Appointment date", formatDate(bookingDate)],
                ["Appointment time", slotChosen ? `${slotChosen.startsAt} – ${slotChosen.endsAt}` : null],
                ["Consultation fee", feeDue ? formatINR(fee) : "Not configured for this doctor"],
                ...(visitType === "ip_admission"
                  ? ([["Admission", [admissionDetails.ward && `Ward ${admissionDetails.ward}`, admissionDetails.bed && `Bed ${admissionDetails.bed}`, admissionDetails.expectedStayDays && `${admissionDetails.expectedStayDays} days expected`].filter(Boolean).join(" · ") || "Details not recorded"]] as [string, string][])
                  : []),
              ]}
            />

            <FormSection title="Payment">
              <Stack>
                <PaymentPanel
                  amount={fee}
                  payeeName={doctor?.fullName ?? "Consultation"}
                  note={`${VISIT_TYPE_LABEL[visitType]} ${summaryName ?? ""}`.trim()}
                  value={payment}
                  onChange={setPayment}
                />
                {!paymentHandled && <p className={styles.gate}>Choose how the amount was collected, or choose to collect it later.</p>}
              </Stack>
            </FormSection>

            <FormSection title="Patient Rights &amp; Responsibilities">
              <Stack>
                <ul className={styles.consent}>
                  {CONSENT_POINTS.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <Checkbox
                  label="I confirm the above was explained and the required consent was taken."
                  checked={consent}
                  onChange={(ev) => setConsent(ev.target.checked)}
                />
                {!consent && <p className={styles.gate}>{CONSENT_REQUIRED}</p>}
              </Stack>
            </FormSection>

            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button type="button" loading={saving} disabled={!consent || !paymentHandled} onClick={() => runRegister(false)}>Register patient</Button>
            </FormActions>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
