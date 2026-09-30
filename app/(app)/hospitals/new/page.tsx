import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { HospitalForm } from "@/components/hospitals/HospitalForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { createHospitalAction } from "../actions";

export const metadata: Metadata = { title: "Add hospital · Claimix" };

export default async function NewHospitalPage() {
  await pageContext("hospital:manage");
  return (
    <>
      <PageHeader title="Add hospital" />
      <Card>
        <HospitalForm action={createHospitalAction} cancelHref="/hospitals" submitLabel="Add hospital" />
      </Card>
    </>
  );
}
