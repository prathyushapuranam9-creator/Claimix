import { ButtonLink } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

export const metadata = { title: "Access denied · Claimix" };

export default function ForbiddenPage() {
  return (
    <StatusPage
      code="403"
      title="You don't have access to this page"
      actions={<ButtonLink href="/dashboard">Go to dashboard</ButtonLink>}
    >
      Your role doesn&apos;t include this area. If you think you should have access, ask your administrator.
    </StatusPage>
  );
}
