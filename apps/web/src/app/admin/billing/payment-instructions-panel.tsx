"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  formatSortCode,
  savePaymentInstructions,
  type PaymentInstructions,
} from "../../../lib/billing-client";
import { AdminStatusBadge } from "../admin-ui";

/**
 * T010/T035 (re-scoped 2026-09-06): the pilot has no payment gateway. Members pay by bank transfer
 * or cash and office records it by hand. This is where office writes the academy's own account
 * details once, so every open invoice can tell the member where to send the money.
 *
 * These details are meant to be shown to payers; there is nothing secret on this form. What it
 * does not do is take any card, token or provider credential.
 */
export function PaymentInstructionsPanel({
  current,
  onSaved,
}: {
  current: PaymentInstructions | null;
  onSaved: () => Promise<void> | void;
}) {
  const [accountName, setAccountName] = useState(current?.accountName ?? "");
  const [sortCode, setSortCode] = useState(current ? formatSortCode(current.sortCode) : "");
  const [accountNumber, setAccountNumber] = useState(current?.accountNumber ?? "");
  const [bankName, setBankName] = useState(current?.bankName ?? "");
  const [referenceHint, setReferenceHint] = useState(
    current?.referenceHint ?? "Quote your invoice reference",
  );
  const [acceptsCash, setAcceptsCash] = useState(current?.acceptsCash ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Reflect what the account reload brought back, e.g. after a colleague saved in parallel.
  useEffect(() => {
    if (current === null) return;
    setAccountName(current.accountName);
    setSortCode(formatSortCode(current.sortCode));
    setAccountNumber(current.accountNumber);
    setBankName(current.bankName ?? "");
    setReferenceHint(current.referenceHint);
    setAcceptsCash(current.acceptsCash);
  }, [current]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await savePaymentInstructions({
        accountName: accountName.trim(),
        // The backend normalises the separators; the form sends what office typed.
        sortCode: sortCode.trim(),
        accountNumber: accountNumber.trim(),
        bankName: bankName.trim() === "" ? null : bankName.trim(),
        referenceHint: referenceHint.trim(),
        acceptsCash,
      });
      setMessage("Payment instructions saved. Members see them on every open invoice.");
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the payment instructions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel-card" aria-labelledby="payment-instructions-title">
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Manual payments</p>
          <h3 id="payment-instructions-title">How members pay</h3>
        </div>
        <AdminStatusBadge status={current === null ? "Not configured" : "Published"} />
      </div>
      <p>
        There is no card gateway in the pilot. Members pay by bank transfer or cash and you record
        the payment here. These details are shown to every member with a balance.
      </p>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="payment-account-name">
          Account name
          <input
            id="payment-account-name"
            onChange={(event) => setAccountName(event.target.value)}
            required
            value={accountName}
          />
        </label>
        <label htmlFor="payment-sort-code">
          Sort code
          <input
            id="payment-sort-code"
            inputMode="numeric"
            onChange={(event) => setSortCode(event.target.value)}
            placeholder="12-34-56"
            required
            value={sortCode}
          />
        </label>
        <label htmlFor="payment-account-number">
          Account number
          <input
            id="payment-account-number"
            inputMode="numeric"
            maxLength={8}
            onChange={(event) => setAccountNumber(event.target.value)}
            required
            value={accountNumber}
          />
        </label>
        <label htmlFor="payment-bank-name">
          Bank (optional)
          <input
            id="payment-bank-name"
            onChange={(event) => setBankName(event.target.value)}
            value={bankName}
          />
        </label>
        <label htmlFor="payment-reference-hint">
          What to use as the transfer reference
          <input
            id="payment-reference-hint"
            onChange={(event) => setReferenceHint(event.target.value)}
            required
            value={referenceHint}
          />
        </label>
        <label htmlFor="payment-accepts-cash">
          <input
            checked={acceptsCash}
            id="payment-accepts-cash"
            onChange={(event) => setAcceptsCash(event.target.checked)}
            type="checkbox"
          />
          Cash is accepted at reception
        </label>
        {error ? <p role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <button className="admin-home-link" disabled={busy} type="submit">
          {busy ? "Saving..." : "Save payment instructions"}
        </button>
      </form>
    </section>
  );
}
