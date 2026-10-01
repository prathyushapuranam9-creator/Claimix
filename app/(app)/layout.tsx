import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { AppShell } from "@/components/shell/AppShell";
import { requestMeta, requireUser } from "@/lib/auth/session";
import { visibleNav } from "@/lib/navigation";
import { PORTALS, portalFor } from "@/lib/portals";
import { InboxService } from "@/modules/notifications/inbox.service";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const hasInbox = user.principal.permissions.has("notification:read");
  const unread = hasInbox ? await InboxService.unreadCount({ db: getDb(), principal: user.principal, meta: await requestMeta() }) : null;
  return (
    <AppShell
      nav={visibleNav(user.principal.permissions)}
      portal={PORTALS[portalFor(user.principal.orgType)].label}
      user={{ fullName: user.fullName, email: user.email, roleName: user.roleName, orgName: user.orgName }}
      logout={logoutAction}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}
