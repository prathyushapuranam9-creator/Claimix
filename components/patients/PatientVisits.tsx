import type { ActionResult } from "@/lib/action-result";
import { formatDate, formatINR } from "@/lib/india";
import { departmentLabel } from "@/modules/patients/patients.validation";
import { PAYMENT_METHOD_LABEL, VISIT_TYPE_LABEL, type PaymentMethod, type VisitType } from "@/modules/scheduling/scheduling.validation";
import { ButtonLink } from "@/components/ui/Button";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, type Tone } from "@/components/ui/Surface";
import { DischargeButton } from "./DischargeButton";

interface Visit {
  id: string;
  reference: string;
  visitType: string;
  status: string;
  department: string;
  doctorName: string;
  slotDate: string;
  startsAt: string;
  endsAt: string;
  consultationFee: string;
  amountCollected: string | null;
  paymentMethod: string | null;
  paymentState: string;
  /** Set only for an IP admission: the stay opened by this visit. */
  admissionId: string | null;
  admissionStatus: string | null;
  ward: string | null;
  bed: string | null;
  admittedAt: Date | null;
  dischargedAt: Date | null;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  booked: { label: "Booked", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** The visits this patient has been registered for, newest first. */
export function PatientVisits({
  visits,
  canRegister,
  discharge,
}: {
  visits: Visit[];
  canRegister: boolean;
  /** Ends an open stay; omitted for users who cannot change the patient. */
  discharge?: (admissionId: string) => () => Promise<ActionResult<unknown>>;
}) {
  return (
    <Card
      title="Visits & appointments"
      padded={false}
      actions={canRegister && visits.length > 0 ? <ButtonLink size="sm" variant="secondary" href="/patients/new">Register a visit</ButtonLink> : undefined}
    >
      <DataTable
        caption="Visits"
        rows={visits}
        rowKey={(v) => v.id}
        empty={
          <EmptyState
            title="No visits registered yet"
            action={canRegister ? <ButtonLink href="/patients/new">Register a visit</ButtonLink> : undefined}
          >
            {canRegister ? "Register the patient for an OPD consultation or an IP admission." : undefined}
          </EmptyState>
        }
        columns={[
          {
            key: "w",
            header: "When",
            nowrap: true,
            cell: (v) => <CellText sub={`${v.startsAt} – ${v.endsAt}`}>{formatDate(v.slotDate)}</CellText>,
          },
          {
            key: "d",
            header: "Doctor",
            cell: (v) => <CellText sub={departmentLabel(v.department)}>{v.doctorName}</CellText>,
          },
          {
            key: "t",
            header: "Visit type",
            cell: (v) => <CellText sub={<span className="mono">{v.reference}</span>}>{VISIT_TYPE_LABEL[v.visitType as VisitType] ?? v.visitType}</CellText>,
          },
          {
            key: "s",
            header: "Status",
            cell: (v) =>
              v.admissionStatus === "admitted" ? (
                <CellText sub={[v.ward && `Ward ${v.ward}`, v.bed && `Bed ${v.bed}`].filter(Boolean).join(" · ") || undefined}>
                  <Badge tone="info">In hospital</Badge>
                </CellText>
              ) : v.admissionStatus === "discharged" ? (
                <CellText sub={v.dischargedAt ? `Discharged ${formatDate(v.dischargedAt)}` : undefined}>
                  <Badge tone="success">Discharged</Badge>
                </CellText>
              ) : (
                <Badge tone={STATUS[v.status]?.tone ?? "neutral"}>{STATUS[v.status]?.label ?? v.status}</Badge>
              ),
          },
          {
            key: "p",
            header: "Payment",
            align: "right",
            cell: (v) =>
              v.paymentState === "paid" ? (
                <CellText sub={v.paymentMethod ? PAYMENT_METHOD_LABEL[v.paymentMethod as PaymentMethod] : undefined}>{formatINR(v.amountCollected)}</CellText>
              ) : (
                <CellText sub={`of ${formatINR(v.consultationFee)}`}>
                  <Badge tone="warning">To collect</Badge>
                </CellText>
              ),
          },
          ...(discharge
            ? [{
                key: "x",
                header: "",
                nowrap: true,
                cell: (v: Visit) =>
                  v.admissionId && v.admissionStatus === "admitted" ? <DischargeButton action={discharge(v.admissionId)} patientName="This patient" /> : null,
              }]
            : []),
        ]}
      />
    </Card>
  );
}
