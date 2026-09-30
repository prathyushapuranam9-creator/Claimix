import { ButtonLink } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

export default function NotFound() {
  return (
    <StatusPage code="404" title="Page not found" actions={<ButtonLink href="/">Back to home</ButtonLink>}>
      The page or record you&apos;re looking for doesn&apos;t exist, or you don&apos;t have access to it.
    </StatusPage>
  );
}
