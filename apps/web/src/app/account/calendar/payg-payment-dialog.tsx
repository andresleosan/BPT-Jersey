"use client";

import { useEffect, useRef, useState } from "react";

import type { PaygBookingPayment, SessionRecord } from "@bpt-jersey/domain/schedule";

import { EnrolmentBankDetails, useEnrolmentBankDetails } from "../../enrol/payment-instructions";
import { uploadPaygClassProof } from "../../../lib/schedule-client";

type PaygPaymentDialogProps = Readonly<{
  session: SessionRecord;
  studentId: string;
  priceMinor: number;
  onClose: () => void;
  onChoose: (payment: PaygBookingPayment) => void;
}>;

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** Whole pounds read as "£10"; pence stay visible ("£7.50"). */
function formatPrice(priceMinor: number): string {
  return priceMinor % 100 === 0 ? `£${priceMinor / 100}` : money.format(priceMinor / 100);
}

/**
 * A pay-as-you-go class is paid for at the moment it is booked. The member either transfers now
 * and attaches the screenshot, or says they will pay at the academy; the booking carries whichever
 * answer they give.
 */
export function PaygPaymentDialog({
  session,
  studentId,
  priceMinor,
  onClose,
  onChoose,
}: PaygPaymentDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [method, setMethod] = useState<"bank_transfer" | "at_venue">("bank_transfer");
  const [reference, setReference] = useState(`BPT-${session.startAt.slice(0, 10)}`);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The bank details are only worth fetching once the member says they will transfer.
  const bankDetails = useEnrolmentBankDetails(
    method === "bank_transfer" ? `${studentId}:${session.sessionId}` : undefined,
  );

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const transferReady = file !== undefined && reference.trim().length > 0;

  async function choose(): Promise<void> {
    if (method === "at_venue") {
      onChoose({ method: "at_venue" });
      return;
    }
    if (!file || !transferReady) return;
    setBusy(true);
    setFailed(false);
    try {
      const proofId = await uploadPaygClassProof(session.sessionId, studentId, file);
      onChoose({ method: "bank_transfer", proofId, reference: reference.trim() });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-labelledby="payg-dialog-title"
      className="payg-dialog"
      onClose={onClose}
      ref={ref}
    >
      <h2 id="payg-dialog-title">Pay for this class</h2>
      <p className="payg-dialog-price">
        {formatPrice(priceMinor)} · {session.title}
      </p>
      <fieldset className="payg-dialog-methods" disabled={busy}>
        <legend>How would you like to pay?</legend>
        <label>
          <input
            checked={method === "bank_transfer"}
            name="payg-method"
            onChange={() => setMethod("bank_transfer")}
            type="radio"
          />
          Pay online now (bank transfer)
        </label>
        <label>
          <input
            checked={method === "at_venue"}
            name="payg-method"
            onChange={() => setMethod("at_venue")}
            type="radio"
          />
          Pay at the academy
        </label>
      </fieldset>
      {method === "bank_transfer" ? (
        <div className="payg-dialog-transfer">
          <EnrolmentBankDetails {...bankDetails} />
          <label htmlFor="payg-reference">Payment reference</label>
          <input
            disabled={busy}
            id="payg-reference"
            maxLength={120}
            minLength={2}
            onChange={(event) => setReference(event.target.value)}
            value={reference}
          />
          <label htmlFor="payg-proof">Payment screenshot</label>
          <input
            accept="image/png,image/jpeg"
            disabled={busy}
            id="payg-proof"
            onChange={(event) => setFile(event.target.files?.[0])}
            type="file"
          />
        </div>
      ) : (
        <p className="payg-dialog-note">Pay at reception before the class starts.</p>
      )}
      {failed ? <p role="alert">The payment screenshot could not be uploaded.</p> : null}
      <div className="payg-dialog-actions">
        <button className="button button-secondary" disabled={busy} onClick={onClose} type="button">
          Not now
        </button>
        <button
          className="button button-primary"
          disabled={busy || (method === "bank_transfer" && !transferReady)}
          onClick={() => void choose()}
          type="button"
        >
          {busy ? "Sending…" : "Continue"}
        </button>
      </div>
    </dialog>
  );
}
