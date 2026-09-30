import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { TpaForm } from "@/components/insurers/PayerForms";
import { Card, PageHeader } from "@/components/ui/Surface";
import { createTpaAction } from "../../insurers/actions";

export const metadata: Metadata = { title: "Add TPA · Claimix" };

export default async function NewTpaPage() {
  await pageContext("insurer:manage");
  return (
    <>
      <PageHeader title="Add TPA" />
      <Card>
        <TpaForm action={createTpaAction} cancelHref="/tpas" submitLabel="Add TPA" />
      </Card>
    </>
  );
}
