import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { scopeFor } from "@/lib/permissions/principal";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { PatientForm } from "@/components/patients/PatientForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { createPatientAction } from "../actions";

export const metadata: Metadata = { title: "Register patient · Claimix" };

export default async function NewPatientPage() {
  const ctx = await pageContext("patient:write");
  const hospitals = scopeFor(ctx.principal, "patient:write") === "all" ? await OrganizationRepository.options(ctx.db, ["hospital"]) : undefined;
  return (
    <>
      <PageHeader title="Register patient" description="Record the patient once; eligibility checks, pre-authorizations and claims link back here." />
      <Card>
        <PatientForm action={createPatientAction} hospitals={hospitals} cancelHref="/patients" submitLabel="Register patient" />
      </Card>
    </>
  );
}
