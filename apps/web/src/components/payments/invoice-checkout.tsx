"use client";

import { useEffect, useRef, useState } from "react";
import {
  paymentMethodLabels,
  type CheckoutMethod,
  type CheckoutRecord,
} from "@bpt-jersey/domain/payments";
import {
  formatSortCode,
  type InvoiceView,
  type PaymentInstructions,
} from "../../lib/billing-client";
import { listPaymentActivity, preparePayment } from "../../lib/payment-client";
import { PaymentMethodPicker } from "./payment-method-picker";
import { OnlinePaymentFields, type OnlinePaymentSubmission } from "./online-payment-fields";

const money = (minor: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
export const checkoutStatusLabels: Record<CheckoutRecord["status"], string> = {
  preparing: "Preparing payment",
  unconfigured: "Details saved, no payment taken",
  requires_action: "Awaiting your payment",
  processing: "Awaiting payment confirmation",
  succeeded: "Payment received",
  failed: "Payment failed",
  cancelled: "Payment cancelled",
  review_required: "Office review required",
};
export function InvoiceCheckout({
  view,
  instructions,
  onRefresh,
}: {
  view: InvoiceView;
  instructions: PaymentInstructions | null;
  onRefresh: () => void;
}) {
  const [method, setMethod] = useState<CheckoutMethod>("bank_transfer");
  const [saved, setSaved] = useState<CheckoutRecord | null>(null);
  const submission = useRef<{ fingerprint: string; requestId: string } | null>(null);
  async function pay(payment: OnlinePaymentSubmission): Promise<string> {
    const fingerprint = JSON.stringify({ ...payment, invoiceId: view.invoice.invoiceId });
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, requestId: crypto.randomUUID() };
    const result = await preparePayment({
      invoiceId: view.invoice.invoiceId,
      ...payment,
      requestId: submission.current.requestId,
    });
    setSaved(result);
    if (["failed", "cancelled"].includes(result.status)) submission.current = null;
    if (result.status === "requires_action" && result.checkoutUrl) {
      const destination = new URL(result.checkoutUrl);
      if (destination.protocol !== "https:" || destination.username || destination.password)
        throw new Error("Payment destination is unavailable.");
      window.location.assign(destination.href);
      return "Opening secure payment...";
    }
    if (result.status === "unconfigured")
      return "The payment provider is not connected yet. Your billing details and selected method have been saved, but no payment has been taken.";
    if (result.status === "succeeded")
      return "Your payment has been received. Refresh your account to see the receipt.";
    if (result.status === "review_required")
      return "Contact the academy before trying another payment. We need to check this attempt.";
    return `${checkoutStatusLabels[result.status]}. Check your payment status before starting another payment.`;
  }
  return (
    <section className="bpt-checkout" aria-label={`Pay invoice ${view.invoice.invoiceReference}`}>
      <div className="bpt-checkout-layout">
        <div>
          <PaymentMethodPicker value={method} onChange={setMethod} />
          {method === "bank_transfer" ? (
            <div>
              <p className="bpt-checkout-help">
                Transfer the balance using your banking app. The academy will confirm it before your
                invoice is marked paid.
              </p>
              {instructions ? (
                <>
                  <dl className="bpt-bank-details">
                    <div>
                      <dt>Account name</dt>
                      <dd>{instructions.accountName}</dd>
                    </div>
                    {instructions.bankName ? (
                      <div>
                        <dt>Bank</dt>
                        <dd>{instructions.bankName}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Sort code</dt>
                      <dd>{formatSortCode(instructions.sortCode)}</dd>
                    </div>
                    <div>
                      <dt>Account number</dt>
                      <dd>{instructions.accountNumber}</dd>
                    </div>
                    <div>
                      <dt>Payment reference</dt>
                      <dd>{view.invoice.invoiceReference}</dd>
                    </div>
                  </dl>
                  <p className="bpt-checkout-help">{instructions.referenceHint}</p>
                  {instructions.acceptsCash ? (
                    <p className="bpt-checkout-help">You can also pay cash at reception.</p>
                  ) : null}
                </>
              ) : (
                <p className="bpt-payment-notice">
                  Bank details are not available yet. Contact the academy before making a transfer.
                </p>
              )}
              <div className="bpt-checkout-actions">
                <button className="button button-secondary" type="button" onClick={onRefresh}>
                  Refresh payment status
                </button>
              </div>
            </div>
          ) : (
            <OnlinePaymentFields
              key={method}
              method={method}
              amountMinor={view.balanceMinor}
              onPay={pay}
            />
          )}
        </div>
        <aside className="bpt-checkout-summary" aria-label="Payment summary">
          <h4>Payment summary</h4>
          <p>{view.invoice.description}</p>
          <p>{view.invoice.invoiceReference}</p>
          <p className="bpt-checkout-amount">{money(view.balanceMinor)}</p>
          <small>GBP / outstanding balance</small>
          <p>{paymentMethodLabels[method]}</p>
          <small>Your balance changes only after payment is confirmed.</small>
        </aside>
      </div>
      <PaymentActivity invoiceId={view.invoice.invoiceId} version={saved?.updatedAt} />
    </section>
  );
}

export function PaymentActivity({
  invoiceId,
  version,
}: {
  invoiceId?: string;
  version?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CheckoutRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setItems(null);
    setError(false);
    listPaymentActivity(invoiceId).then(
      (rows) => {
        if (active) setItems(rows);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [open, invoiceId, version, attempt]);
  return (
    <details className="bpt-payment-activity" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Online payment activity</summary>
      <p>
        These are payment attempts and saved choices. Only confirmed payments count towards income.
      </p>
      {error ? (
        <p role="alert">Payment activity could not be loaded.</p>
      ) : items === null ? (
        <div
          className="bpt-checkout-loading"
          aria-busy="true"
          aria-label="Loading payment activity"
        />
      ) : items.length === 0 ? (
        <p>No online payment activity yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.checkoutId}>
              <strong>
                {paymentMethodLabels[item.settledMethod ?? item.method]} / {money(item.amountMinor)}
              </strong>
              <br />
              {checkoutStatusLabels[item.status]}
              <br />
              <small>
                {new Date(item.createdAt).toLocaleString("en-GB")} / {item.invoiceId}
              </small>
              {!invoiceId ? (
                <>
                  <br />
                  <small>
                    {item.billing.name} / {item.billing.email}
                  </small>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button button-secondary"
        onClick={() => setAttempt((v) => v + 1)}
      >
        Refresh payment activity
      </button>
    </details>
  );
}
