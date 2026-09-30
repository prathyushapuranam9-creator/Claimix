import { Badge, type Tone } from "@/components/ui/Surface";
import { NETWORK_STATUS_LABEL, type NETWORK_STATUSES } from "@/modules/hospitals/hospitals.validation";

const TONE: Record<(typeof NETWORK_STATUSES)[number], Tone> = {
  network: "success",
  empanelled: "success",
  non_network: "neutral",
  suspended: "danger",
  unverified: "warning",
};

export function NetworkStatusBadge({ status }: { status: (typeof NETWORK_STATUSES)[number] }) {
  return <Badge tone={TONE[status]}>{NETWORK_STATUS_LABEL[status]}</Badge>;
}
