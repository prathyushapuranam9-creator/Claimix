import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { ContextBanner } from "@/components/insurance/ContextBanner";
import { ContextSwitcher } from "@/components/insurance/ContextSwitcher";
import { AppShell } from "@/components/shell/AppShell";
import { authService, requestMeta, requireUser, sessionToken } from "@/lib/auth/session";
import { visibleNav } from "@/lib/navigation";
import { PORTALS, portalFor } from "@/lib/portals";
import { InboxService } from "@/modules/notifications/inbox.service";
import { logoutAction } from "../(auth)/actions";
import { exitContextAction, switchContextAction } from "./context/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const hasInbox = user.principal.permissions.has("notification:read");
  const unread = hasInbox ? await InboxService.unreadCount({ db: getDb(), principal: user.principal, meta: await requestMeta() }) : null;
  // While acting as an insurer / TPA role, the same selectors are available from the banner on every page.
  const acting = user.principal.acting;
  const switcher =
    acting && user.canSwitchContext ? (
      <ContextSwitcher
        key={`${user.principal.organizationId}:${user.principal.roleKey}`}
        options={await authService().contextOptions(await sessionToken())}
        allowAll={user.homeIsAllInsurers}
        current={{ organizationId: user.principal.organizationId, roleKey: user.principal.roleKey }}
        active
        switchAction={switchContextAction}
        exitAction={exitContextAction}
      />
    ) : undefined;
  return (
    <AppShell
      nav={visibleNav(user.principal)}
      portal={PORTALS[portalFor(user.principal.orgType)].label}
      portalKey={portalFor(user.principal.orgType)}
      user={{ fullName: user.fullName, email: user.email, roleName: user.roleName, orgName: user.orgName }}
      logout={logoutAction}
      unread={unread}
    >
      {acting && <ContextBanner organizationName={acting.organizationName} roleName={acting.roleName} policyName={acting.policyName} switcher={switcher} />}
      {children}
    </AppShell>
  );
}
