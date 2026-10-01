import type { Metadata } from "next";
import { pageContext } from "@/lib/auth/context";
import { SchemeForm } from "@/components/reference/SchemeForm";
import { Card, PageHeader } from "@/components/ui/Surface";
import { createSchemeAction } from "../actions";

export const metadata: Metadata = { title: "Add government scheme · Claimix" };

export default async function NewSchemePage() {
  await pageContext("policy:manage");
  return (
    <>
      <PageHeader
        title="Add government scheme"
        description="Register the scheme here, then add its covers as policies and empanel hospitals from each hospital's page."
      />
      <Card>
        <SchemeForm action={createSchemeAction} />
      </Card>
    </>
  );
}
