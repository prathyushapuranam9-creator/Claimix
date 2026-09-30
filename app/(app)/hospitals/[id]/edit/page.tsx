import type { Metadata } from "next";
import { orNotFound, pageContext } from "@/lib/auth/context";
import { HospitalService } from "@/modules/hospitals/hospitals.service";
import type { HospitalInput } from "@/modules/hospitals/hospitals.validation";
import { HospitalForm } from "@/components/hospitals/HospitalForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { updateHospitalAction } from "../../actions";

export const metadata: Metadata = { title: "Edit hospital · Claimix" };

export default async function EditHospitalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("hospital:manage");
  const { id } = await params;
  const h = await orNotFound(HospitalService.get(ctx, id));
  const x = h.hospital;
  return (
    <>
      <PageHeader title={`Edit ${h.name}`} />
      <Card>
        <HospitalForm
          action={updateHospitalAction.bind(null, x.id)}
          defaults={{
            name: h.name,
            registrationNo: x.registrationNo ?? "",
            city: x.city,
            state: x.state as HospitalInput["state"],
            address: x.address ?? "",
            departments: x.departments.join(", "),
            phone: x.phone ?? "",
            email: x.email ?? "",
          }}
          cancelHref={`/hospitals/${x.id}`}
          submitLabel="Save changes"
        />
      </Card>
    </>
  );
}
