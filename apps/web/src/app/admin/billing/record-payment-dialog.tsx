"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ManualPaymentMethod, ManualPaymentRecord } from "@bpt-jersey/domain/finance";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import {
  recordManualPayment,
  type FinancialAccount,
  type InvoiceView,
} from "../../../lib/billing-client";
import { getFamilyFinancialAccount } from "../../../lib/finance-client";
import { formatMoney, parseMoney } from "./billing-format";
import { MemberPicker } from "./member-picker";

import "./billing.css";

type PaymentMethod = Extract<ManualPaymentMethod, "cash" | "bank_transfer">;

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

type Props = Readonly<{
  invoice: InvoiceView | null;
  members: readonly MemberNameRow[] | null;
  membersError?: string | undefined;
  loadFamilyAccount?: typeof getFamilyFinancialAccount;
  record?: typeof recordManualPayment;
  onClose: () => void;
  onRecorded: (payment: ManualPaymentRecord) => void;
}>;

export function RecordPaymentDialog({
  invoice,
  members,
  membersError,
  loadFamilyAccount = getFamilyFinancialAccount,
  record = recordManualPayment,
  onClose,
  onRecorded,
}: Props) {
  const [member, setMember] = useState<MemberNameRow | null>(null);
  const [account, setAccount] = useState<FinancialAccount | null>(null);
  const [accountError, setAccountError] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    invoice?.invoice.invoiceId ?? null,
  );
  const [form, setForm] = useState({
    amount: "",
    method: "bank_transfer" as PaymentMethod,
    manualReference: "",
    occurredAt: toDateTimeLocal(new Date()),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openInvoices =
    invoice === null
      ? (account?.invoices.filter(
          (v) =>
            (v.invoice.status === "open" || v.invoice.status === "partially_paid") &&
            v.balanceMinor > 0,
        ) ?? [])
      : [];

  const selectedInvoice: InvoiceView | null =
    invoice ?? openInvoices.find((v) => v.invoice.invoiceId === selectedInvoiceId) ?? null;

  useEffect(() => {
    if (invoice !== null || member === null || member.familyId === null) {
      setAccount(null);
      return;
    }
    let mounted = true;
    setAccount(null);
    setAccountError("");
    void loadFamilyAccount(member.familyId)
      .then((result) => {
        if (mounted) setAccount(result);
      })
      .catch(() => {
        if (mounted) setAccountError("Unable to load this family's account. Please try again.");
      });
    return () => {
      mounted = false;
    };
  }, [invoice, member, loadFamilyAccount]);

  useEffect(() => {
    if (selectedInvoice) {
      setForm((current) => ({
        ...current,
        amount: (selectedInvoice.balanceMinor / 100).toFixed(2),
      }));
    }
    // selectedInvoice derives from invoice/account/selectedInvoiceId; only its balance matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoice?.invoice.invoiceId, selectedInvoice?.balanceMinor]);

  const blockedNoFamily = invoice === null && member !== null && member.familyId === null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoice) return;
    const amountMinor = parseMoney(form.amount);
    if (amountMinor === undefined || amountMinor > selectedInvoice.balanceMinor) {
      setError("Enter a valid payment no greater than the balance.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payment = await record({
        invoiceId: selectedInvoice.invoice.invoiceId,
        amountMinor,
        method: form.method,
        manualReference: form.manualReference.trim(),
        occurredAt: new Date(form.occurredAt).toISOString(),
      });
      onRecorded(payment);
    } catch {
      setError("The payment could not be recorded. Refresh the balance and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-labelledby="record-payment-title"
      aria-modal="true"
      className="billing-dialog-backdrop"
      role="dialog"
    >
      <section className="billing-dialog">
        <div className="billing-dialog-heading">
          <div>
            <p className="admin-eyebrow">Manual receipt</p>
            <h3 id="record-payment-title">Record payment</h3>
          </div>
          <button
            aria-label="Close dialog"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <form className="billing-form" onSubmit={(event) => void submit(event)}>
          {invoice === null ? (
            <>
              <MemberPicker
                autoFocus
                error={membersError}
                members={members}
                onSelect={setMember}
                selected={member}
              />
              {blockedNoFamily ? (
                <p className="family-error billing-form-wide" role="alert">
                  This member has no billing family yet.
                </p>
              ) : null}
              {accountError ? (
                <p className="family-error billing-form-wide" role="alert">
                  {accountError}
                </p>
              ) : null}
              {member && member.familyId !== null && openInvoices.length > 0 ? (
                <fieldset className="billing-form-wide">
                  <legend>Invoice</legend>
                  <div aria-label="Invoice" className="billing-choice-column" role="radiogroup">
                    {openInvoices.map((v) => (
                      <label className="billing-radio" key={v.invoice.invoiceId}>
                        <input
                          checked={selectedInvoiceId === v.invoice.invoiceId}
                          name="invoice"
                          onChange={() => setSelectedInvoiceId(v.invoice.invoiceId)}
                          type="radio"
                        />
                        {v.invoice.invoiceReference} · {v.invoice.description} · balance{" "}
                        {formatMoney(v.balanceMinor)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </>
          ) : (
            <p className="billing-form-wide">
              Selected: <strong>{invoice.invoice.invoiceReference}</strong> · balance{" "}
              {formatMoney(invoice.balanceMinor)}
            </p>
          )}
          <div aria-label="Payment method" className="billing-choice-row" role="radiogroup">
            {(["cash", "bank_transfer"] as const).map((method) => (
              <button
                aria-checked={form.method === method}
                className="billing-choice"
                disabled={!selectedInvoice}
                key={method}
                onClick={() => setForm({ ...form, method })}
                role="radio"
                type="button"
              >
                {method === "cash" ? "Cash" : "Bank transfer"}
              </button>
            ))}
          </div>
          <label className="family-field">
            Payment amount (GBP)
            <input
              aria-label="Payment amount (GBP)"
              disabled={!selectedInvoice}
              inputMode="decimal"
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              required
              value={form.amount}
            />
          </label>
          <label className="family-field">
            Payment reference
            <input
              aria-label="Payment reference"
              autoComplete="off"
              disabled={!selectedInvoice}
              onChange={(event) => setForm({ ...form, manualReference: event.target.value })}
              required
              value={form.manualReference}
            />
          </label>
          <label className="family-field">
            Paid on
            <input
              aria-label="Paid on"
              disabled={!selectedInvoice}
              onChange={(event) => setForm({ ...form, occurredAt: event.target.value })}
              required
              type="datetime-local"
              value={form.occurredAt}
            />
          </label>
          {error ? (
            <p className="family-error billing-form-wide" role="alert">
              {error}
            </p>
          ) : null}
          <div className="billing-dialog-actions billing-form-wide">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={onClose}
              type="button"
            >
              Keep unchanged
            </button>
            <button className="button" disabled={busy || !selectedInvoice} type="submit">
              {busy ? "Working…" : "Save payment"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
