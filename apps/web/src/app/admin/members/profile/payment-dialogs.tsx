"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ManualPaymentMethod } from "@bpt-jersey/domain/finance";
import type {
  SubscriptionBilling,
  SubscriptionBillingPayment,
} from "@bpt-jersey/domain/memberships/admin";

import { editManualPayment, recordManualPayment } from "../../../../lib/billing-client";
import { formatMoney, methodLabel, parseMoney } from "../../billing/billing-format";

import "../../billing/billing.css";

type BillingInvoice = SubscriptionBilling["invoices"][number];

const reasonLimit = 280;
const reasonMinimum = 10;

function localDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** What is still owed; an older backend sends no balance, so it is derived from the receipts. */
export function invoiceBalance(invoice: BillingInvoice): number {
  return (
    invoice.balanceMinor ??
    Math.max(0, invoice.totalMinor - invoice.payments.reduce((sum, p) => sum + p.amountMinor, 0))
  );
}

/** A native modal: the browser contains focus and Escape closes it through onCancel. */
function ModalDialog({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="billing-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function DialogHeading({
  id,
  eyebrow,
  title,
  busy,
  onClose,
}: {
  id: string;
  eyebrow: string;
  title: string;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="billing-dialog-heading">
      <div>
        <p className="admin-eyebrow">{eyebrow}</p>
        <h3 id={id}>{title}</h3>
      </div>
      <button className="member-record-link" disabled={busy} onClick={onClose} type="button">
        Close
      </button>
    </div>
  );
}

export function RecordMemberPaymentDialog({
  invoices,
  onClose,
  onRecorded,
}: {
  invoices: readonly BillingInvoice[];
  onClose: () => void;
  onRecorded: () => void;
}) {
  const titleId = useId();
  const open = invoices.filter(
    (invoice) =>
      (invoice.status === "open" || invoice.status === "partially_paid") &&
      invoiceBalance(invoice) > 0,
  );
  const [invoiceId, setInvoiceId] = useState(open[0]?.invoiceId ?? "");
  const selected = open.find((invoice) => invoice.invoiceId === invoiceId);
  const [amount, setAmount] = useState(selected ? (invoiceBalance(selected) / 100).toFixed(2) : "");
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => localDateTime(new Date().toISOString()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function choose(invoice: BillingInvoice) {
    setInvoiceId(invoice.invoiceId);
    setAmount((invoiceBalance(invoice) / 100).toFixed(2));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const amountMinor = parseMoney(amount.trim());
    if (amountMinor === undefined || amountMinor > invoiceBalance(selected)) {
      setError("Enter an amount no greater than the balance.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await recordManualPayment({
        invoiceId: selected.invoiceId,
        amountMinor,
        method,
        manualReference: reference.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
      });
      onRecorded();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to record the payment. Check the details and try again.",
      );
      setBusy(false);
    }
  }

  return (
    <ModalDialog titleId={titleId} onClose={onClose}>
      <DialogHeading
        busy={busy}
        eyebrow="Manual receipt"
        id={titleId}
        onClose={onClose}
        title="Record payment"
      />
      {open.length === 0 ? (
        <p className="member-subscription-help">Issue an invoice first to record a payment.</p>
      ) : (
        <form className="billing-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="billing-form-wide" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend>Invoice</legend>
            <div className="billing-choice-column">
              {open.map((invoice) => (
                <label className="billing-radio" key={invoice.invoiceId}>
                  <input
                    checked={invoiceId === invoice.invoiceId}
                    name="invoice"
                    onChange={() => choose(invoice)}
                    type="radio"
                  />
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {invoice.invoiceReference ?? invoice.description} · balance{" "}
                    {formatMoney(invoiceBalance(invoice))}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="family-field">
            Payment amount (GBP)
            <input
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              required
              style={{ fontVariantNumeric: "tabular-nums" }}
              value={amount}
            />
          </label>
          <label className="family-field">
            Method
            <select
              onChange={(event) => setMethod(event.target.value as ManualPaymentMethod)}
              value={method}
            >
              {(["cash", "bank_transfer", "other"] as const).map((value) => (
                <option key={value} value={value}>
                  {methodLabel[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="family-field">
            Payment reference
            <input
              autoComplete="off"
              onChange={(event) => setReference(event.target.value)}
              required
              value={reference}
            />
          </label>
          <label className="family-field">
            Paid on
            <input
              onChange={(event) => setOccurredAt(event.target.value)}
              required
              type="datetime-local"
              value={occurredAt}
            />
          </label>
          {error ? (
            <p className="member-record-notice billing-form-wide" role="alert">
              {error}
            </p>
          ) : null}
          <div className="billing-dialog-actions billing-form-wide">
            <button className="member-record-button" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save payment"}
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}

export function EditPaymentDialog({
  payment,
  onClose,
  onSaved,
}: {
  payment: SubscriptionBillingPayment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const titleId = useId();
  const reasonId = useId();
  // One id per opened dialog: a retry after a lost response replays instead of editing twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const initial = {
    amount: (payment.amountMinor / 100).toFixed(2),
    method: payment.method,
    reference: payment.reference,
    occurredAt: localDateTime(payment.occurredAt),
  };
  const [form, setForm] = useState(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reasonReady = reason.trim().length >= reasonMinimum;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = parseMoney(form.amount.trim());
    if (amountMinor === undefined) {
      setError("Enter a valid amount.");
      return;
    }
    const changes = {
      ...(amountMinor !== payment.amountMinor ? { amountMinor } : {}),
      ...(form.method !== initial.method ? { method: form.method } : {}),
      ...(form.reference.trim() !== initial.reference
        ? { manualReference: form.reference.trim() }
        : {}),
      ...(form.occurredAt !== initial.occurredAt
        ? { occurredAt: new Date(form.occurredAt).toISOString() }
        : {}),
    };
    if (Object.keys(changes).length === 0) {
      setError("Change at least one payment detail.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await editManualPayment({
      paymentId: payment.paymentId,
      ...changes,
      reason: reason.trim(),
      requestId,
    });
    if (result.ok) {
      onSaved();
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  return (
    <ModalDialog titleId={titleId} onClose={onClose}>
      <DialogHeading
        busy={busy}
        eyebrow={`Reference ${payment.reference}`}
        id={titleId}
        onClose={onClose}
        title="Edit payment"
      />
      <form className="billing-form" onSubmit={(event) => void submit(event)}>
        <label className="family-field">
          Amount (GBP)
          <input
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            required
            style={{ fontVariantNumeric: "tabular-nums" }}
            value={form.amount}
          />
        </label>
        <label className="family-field">
          Method
          <select
            onChange={(event) =>
              setForm({ ...form, method: event.target.value as ManualPaymentMethod })
            }
            value={form.method}
          >
            {(["cash", "bank_transfer", "other"] as const).map((value) => (
              <option key={value} value={value}>
                {methodLabel[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="family-field">
          Reference
          <input
            autoComplete="off"
            onChange={(event) => setForm({ ...form, reference: event.target.value })}
            required
            value={form.reference}
          />
        </label>
        <label className="family-field">
          Paid on
          <input
            onChange={(event) => setForm({ ...form, occurredAt: event.target.value })}
            required
            type="datetime-local"
            value={form.occurredAt}
          />
        </label>
        <label className="family-field billing-form-wide">
          Reason for the change
          <textarea
            aria-describedby={`${reasonId}-count`}
            maxLength={reasonLimit}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            style={{
              border: "1px solid var(--line, #8a8880)",
              borderRadius: 0,
              font: "inherit",
              minHeight: "3rem",
              padding: "0.65rem",
            }}
            value={reason}
          />
        </label>
        <p
          className="member-subscription-help billing-form-wide"
          id={`${reasonId}-count`}
          style={{ fontVariantNumeric: "tabular-nums", marginTop: "-0.5rem" }}
        >
          <span>
            {reason.trim().length}/{reasonLimit}
          </span>
          {reasonReady ? null : ` · At least ${reasonMinimum} characters. Kept with the payment.`}
        </p>
        {error ? (
          <p className="member-record-notice billing-form-wide" role="alert">
            {error}
          </p>
        ) : null}
        <div className="billing-dialog-actions billing-form-wide">
          <button className="member-record-button" disabled={busy || !reasonReady} type="submit">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
