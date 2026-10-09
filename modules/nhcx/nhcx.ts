import "server-only";

/**
 * Integration boundary for the National Health Claims Exchange (NHCX).
 *
 * Claimix does not include an NHCX client: no gateway, participant code or signing keys are configured, so nothing
 * is ever sent to NHCX. Cases are submitted inside Claimix to the payer's review queue. A real gateway (built
 * against the NHCX specification with credentials supplied by the operator) would implement this interface and be
 * registered at start-up; until then the UI states plainly that NHCX is not connected.
 */
export interface NhcxGateway {
  /** Shown in the UI, e.g. the participant / gateway name. */
  name: string;
  /** Sends a submitted pre-authorization; returns the exchange's correlation id. */
  submitPreauth(preauthId: string): Promise<{ correlationId: string }>;
}

let gateway: NhcxGateway | null = null;

/** Registers the configured gateway (none is shipped with Claimix). */
export function registerNhcxGateway(g: NhcxGateway | null) {
  gateway = g;
}

export function nhcxStatus(): { connected: true; name: string } | { connected: false; reason: string } {
  return gateway
    ? { connected: true, name: gateway.name }
    : { connected: false, reason: "No NHCX (National Health Claims Exchange) connection is configured in this installation, so nothing is sent to NHCX." };
}
