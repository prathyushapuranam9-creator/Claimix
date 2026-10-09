"use client";

import { useState } from "react";
import { formatINR } from "@/lib/india";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/modules/scheduling/scheduling.validation";
import { TextField } from "@/components/ui/Field";
import { Checkbox, FormGrid } from "@/components/ui/Form";
import { Alert, Stack } from "@/components/ui/Surface";
import styles from "./PaymentPanel.module.css";

export interface PaymentChoice {
  method: PaymentMethod | "";
  /** The card's last four digits or the UPI reference — never full card details. */
  reference?: string;
  collectLater: boolean;
}

/** A UPI collect link for the amount. Scannable by any UPI app; this build settles nothing itself. */
function upiUri(amount: string, payee: string, note: string) {
  const p = new URLSearchParams({ pa: "hospital@demo-upi", pn: payee, am: Number(amount).toFixed(2), cu: "INR", tn: note });
  return `upi://pay?${p.toString()}`;
}

/** A framed stand-in for the QR image, with the payload shown so it can be copied in a demo. */
function DemoQr({ uri }: { uri: string }) {
  return (
    <div className={styles.qr}>
      <div className={styles.qrFrame} aria-hidden="true">
        <span className={styles.qrMark}>UPI</span>
      </div>
      <div className={styles.qrSide}>
        <p className={styles.qrTitle}>Ask the patient to scan this with any UPI app</p>
        <code className={styles.qrUri}>{uri}</code>
      </div>
    </div>
  );
}

/**
 * How the consultation amount is taken: cash, a UPI collect request, or a card at the desk.
 *
 * No payment gateway is wired into this build, so nothing here moves money or confirms a transaction
 * on its own: the desk records what it collected, and the registration stores the method plus a
 * non-sensitive reference. Card numbers are used only to derive the last four digits and are never
 * sent to the server.
 */
export function PaymentPanel({
  amount,
  payeeName,
  note,
  value,
  onChange,
}: {
  amount: string | null;
  payeeName: string;
  note: string;
  value: PaymentChoice;
  onChange: (next: PaymentChoice) => void;
}) {
  const [card, setCard] = useState({ number: "", expiry: "", name: "" });
  const due = Number(amount ?? 0);

  if (!amount || due <= 0) {
    return (
      <Alert tone="info" title="No consultation fee to collect">
        This doctor has no consultation fee configured, so there is nothing to take at the desk. The visit is recorded as settled.
      </Alert>
    );
  }

  const pick = (method: PaymentMethod) => onChange({ method, reference: undefined, collectLater: false });

  const setCardField = (field: "number" | "expiry" | "name", raw: string) => {
    const next = { ...card, [field]: raw };
    setCard(next);
    // Only the last four digits ever leave this component.
    const digits = next.number.replace(/\D/g, "");
    onChange({ method: "card", collectLater: false, reference: digits.length >= 4 ? `****${digits.slice(-4)}` : undefined });
  };

  return (
    <Stack>
      <p className={styles.amount}>
        Amount to collect <strong>{formatINR(amount)}</strong>
      </p>

      <div className={styles.methods} role="group" aria-label="Payment method">
        {PAYMENT_METHODS.map((m) => (
          <label key={m} className={styles.method} data-picked={!value.collectLater && value.method === m}>
            <input type="radio" name="paymentMethod" value={m} checked={!value.collectLater && value.method === m} disabled={value.collectLater} onChange={() => pick(m)} />
            {PAYMENT_METHOD_LABEL[m]}
          </label>
        ))}
      </div>

      {!value.collectLater && value.method === "cash" && (
        <Alert tone="info" title={`Take ${formatINR(amount)} in cash`}>
          Confirm the cash in hand before registering. The visit is then recorded as paid.
        </Alert>
      )}

      {!value.collectLater && value.method === "upi" && (
        <Stack>
          <DemoQr uri={upiUri(amount, payeeName, note)} />
          <Alert tone="warning" title="Demo UPI collection">
            This build has no payment gateway, so nothing is settled here and no transaction is confirmed automatically. Check the patient&apos;s app for
            the payment, then record the UPI reference below.
          </Alert>
          <FormGrid>
            <TextField
              label="UPI reference"
              hint="From the patient's payment confirmation. Optional."
              value={value.reference ?? ""}
              onChange={(e) => onChange({ ...value, method: "upi", reference: e.target.value || undefined })}
            />
          </FormGrid>
        </Stack>
      )}

      {!value.collectLater && value.method === "card" && (
        <Stack>
          <Alert tone="warning" title="Demo card capture">
            No card is charged here and no card details are stored or sent to the server: only the last four digits are kept with the visit, as a
            reference. Use a test card in this environment.
          </Alert>
          <FormGrid>
            <TextField
              label="Card number"
              inputMode="numeric"
              autoComplete="off"
              placeholder="4111 1111 1111 1111"
              value={card.number}
              onChange={(e) => setCardField("number", e.target.value)}
            />
            <TextField label="Expiry (MM/YY)" autoComplete="off" placeholder="12/29" value={card.expiry} onChange={(e) => setCardField("expiry", e.target.value)} />
            <TextField label="Name on card" autoComplete="off" value={card.name} onChange={(e) => setCardField("name", e.target.value)} />
            <TextField label="Kept with the visit" value={value.reference ?? "—"} readOnly hint="Only this masked reference is stored." />
          </FormGrid>
        </Stack>
      )}

      <Checkbox
        label="Collect the payment later"
        checked={value.collectLater}
        onChange={(e) => onChange({ method: "", reference: undefined, collectLater: e.target.checked })}
      />
    </Stack>
  );
}
