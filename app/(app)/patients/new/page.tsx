import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { scopeFor } from "@/lib/permissions/principal";
import { todayIso } from "@/lib/validation";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { RegistrationService } from "@/modules/scheduling/scheduling.service";
import { RegistrationWizard } from "@/components/patients/RegistrationWizard";
import { PageHeader } from "@/components/ui/Surface";
import { availabilityAction, doctorsForDepartmentAction, findPatientsAction, registerPatientAction } from "../registration-actions";

export const metadata: Metadata = { title: "Register patient · Claimix" };

/**
 * Front-desk registration. The patient is only registered when the third step completes, so this page
 * is the whole process: find or enter the patient, choose the doctor and slot, take payment and confirm.
 */
export default async function NewPatientPage() {
  const ctx = await pageContext("patient:write");
  const isAdmin = scopeFor(ctx.principal, "patient:write") === "all";
  const [hospitals, departments] = await Promise.all([
    isAdmin ? OrganizationRepository.options(ctx.db, ["hospital"]) : Promise.resolve(undefined),
    RegistrationService.departments(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Register patient"
        description="Find or register the patient, choose the doctor and slot, then take payment and confirm. The patient is registered only when the last step completes."
      />
      <RegistrationWizard
        departments={departments}
        hospitals={hospitals}
        findPatients={findPatientsAction}
        doctorsFor={doctorsForDepartmentAction}
        availabilityFor={availabilityAction}
        register={registerPatientAction}
        today={todayIso()}
      />
    </>
  );
}
