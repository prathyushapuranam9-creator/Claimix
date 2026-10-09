import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { formatINR } from "@/lib/india";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { departmentLabel } from "@/modules/patients/patients.validation";
import { DoctorService } from "@/modules/scheduling/scheduling.service";
import { DoctorForm, SlotForm } from "@/components/reference/DoctorForms";
import { CellText, DataTable } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import { addDoctorAction, openSlotsAction } from "./actions";

export const metadata: Metadata = { title: "Doctors & slots · Claimix" };

/** Reference data behind front-desk registration: who can be booked, and when. Administrators only. */
export default async function DoctorsPage() {
  const ctx = await pageContext("hospital:manage");
  const [doctors, hospitals] = await Promise.all([DoctorService.list(ctx), OrganizationRepository.options(ctx.db, ["hospital"])]);
  return (
    <>
      <PageHeader title="Doctors & slots" description="The doctors each hospital offers appointments with, and the slots they can be booked into." />
      <Stack>
        <Card title="Add a doctor">
          <DoctorForm action={addDoctorAction} hospitals={hospitals} />
        </Card>
        <Card title="Open slots">
          <SlotForm action={openSlotsAction} doctors={doctors.map((d) => ({ id: d.id, label: `${d.fullName} · ${departmentLabel(d.department)} · ${d.hospitalName}` }))} />
        </Card>
        <Card title={`Doctors (${doctors.length})`} padded={false}>
          <DataTable
            caption="Doctors"
            rows={doctors}
            rowKey={(d) => d.id}
            empty={<EmptyState title="No doctors yet">Add a doctor, then open their slots so the front desk can book appointments.</EmptyState>}
            columns={[
              { key: "n", header: "Doctor", cell: (d) => <CellText sub={d.registrationNo ? `Reg. ${d.registrationNo}` : undefined}>{d.fullName}</CellText> },
              { key: "h", header: "Hospital", cell: (d) => <CellText sub={departmentLabel(d.department)}>{d.hospitalName}</CellText> },
              { key: "f", header: "Consultation fee", align: "right", cell: (d) => formatINR(d.consultationFee) },
              { key: "s", header: "Slots opened", align: "right", cell: (d) => d.slots },
              { key: "a", header: "Status", cell: (d) => (d.isActive ? <Badge tone="success">Taking appointments</Badge> : <Badge tone="neutral">Not offered</Badge>) },
            ]}
          />
        </Card>
      </Stack>
    </>
  );
}
