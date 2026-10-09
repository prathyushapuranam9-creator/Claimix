import type { Metadata } from "next";
import { maskAadhaar } from "@/lib/india";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { PatientService } from "@/modules/patients/patients.service";
import { PatientForm } from "@/components/patients/PatientForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { updatePatientAction } from "../../actions";

export const metadata: Metadata = { title: "Edit patient · Claimix" };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("patient:write");
  const { id } = await params;
  const { patient: p } = await orNotFound(PatientService.get(ctx, id));
  const update = updatePatientAction.bind(null, p.id);
  return (
    <>
      <PageHeader title={`Edit ${p.fullName}`} />
      <Card>
        <PatientForm
          action={update}
          defaults={{ fullName: p.fullName, dob: p.dob, gender: p.gender, patientNo: p.patientNo, phone: p.phone ?? "", email: p.email ?? "", department: p.department ?? "", visitReason: p.visitReason ?? "" }}
          aadhaarOnFile={maskAadhaar(p.aadhaarLast4)}
          cancelHref={`/patients/${p.id}`}
          submitLabel="Save changes"
        />
      </Card>
    </>
  );
}
