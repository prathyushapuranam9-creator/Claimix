import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { InsurerForm } from "@/components/insurers/PayerForms";
import { Card, PageHeader } from "@/components/ui/Surface";
import { createInsurerAction } from "../actions";

export const metadata: Metadata = { title: "Add insurer · Claimix" };

export default async function NewInsurerPage() {
  await pageContext("insurer:manage");
  return (
    <>
      <PageHeader title="Add insurance company" />
      <Card>
        <InsurerForm action={createInsurerAction} cancelHref="/insurers" submitLabel="Add insurer" />
      </Card>
    </>
  );
}
