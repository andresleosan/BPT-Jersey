"use client";

import { useId, useState, type FormEvent } from "react";

import { voidManualPayment } from "../../../lib/billing-client";
import {
  DialogHeading,
  ModalDialog,
  reasonLimit,
  reasonMinimum,
} from "../members/profile/payment-dialogs";
import { formatDate, formatMoney } from "./billing-format";

export function VoidPaymentDialog({
  payment,
  memberLabel,
  onClose,
  onVoided,
  voidPayment = voidManualPayment,
}: {
  payment: Readonly<{ paymentId: string; amountMinor: number; occurredAt: string }>;
  memberLabel: string;
  onClose: () => void;
  onVoided: () => void;
  voidPayment?: typeof voidManualPayment;
}) {
  const titleId = useId();
  const countId = useId();
  // One id per opened dialog: a retry after a lost response replays instead of voiding twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = reason.trim().length >= reasonMinimum;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    const result = await voidPayment({
      paymentId: payment.paymentId,
      reason: reason.trim(),
      requestId,
    });
    if (result.ok) {
      onVoided();
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  return (
    <ModalDialog titleId={titleId} onClose={onClose}>
      <DialogHeading
        busy={busy}
        eyebrow={memberLabel}
        id={titleId}
        onClose={onClose}
        title="Void payment"
      />
      <form className="billing-form" onSubmit={(event) => void submit(event)}>
        <p className="billing-form-wide" style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatMoney(payment.amountMinor)} paid on {formatDate(payment.occurredAt)}
        </p>
        <p className="member-subscription-help billing-form-wide">
          Voiding does not change the member&apos;s plan dates. Fix those in the Plan tab if needed.
        </p>
        <label className="family-field billing-form-wide">
          Reason for voiding
          <textarea
            aria-describedby={countId}
            maxLength={reasonLimit}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </label>
        <p
          className="member-subscription-help billing-form-wide"
          id={countId}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {reason.trim().length}/{reasonLimit}
          {ready ? null : ` · At least ${reasonMinimum} characters. Kept with the payment.`}
        </p>
        {error ? (
          <p className="member-record-notice billing-form-wide" role="alert">
            {error}
          </p>
        ) : null}
        <div className="billing-dialog-actions billing-form-wide">
          <button className="button billing-danger-button" disabled={busy || !ready} type="submit">
            {busy ? "Voiding…" : "Void payment"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
