import { Alert } from "./Surface";

export const DISCLAIMER_TEXT =
  "Insurance coverage, authorization and claim settlement are subject to the applicable policy wording, insurer/TPA decision and government-scheme rules. This platform provides workflow assistance and information; it does not guarantee claim approval or payment.";

export function Disclaimer({ compact }: { compact?: boolean }) {
  return (
    <Alert tone="neutral" title={compact ? undefined : "Important"}>
      {DISCLAIMER_TEXT}
    </Alert>
  );
}
