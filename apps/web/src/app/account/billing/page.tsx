"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";

import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";
import {
  listFinancialAccount,
  type FinancialAccount,
  type InvoiceView,
} from "../../../lib/billing-client";
import { paymentMethodLabels } from "@bpt-jersey/domain/payments";
import { InvoiceCheckout } from "../../../components/payments/invoice-checkout";

import "./billing.css";

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatMoney(amountMinor: number): string {
  return moneyFormatter.format(amountMinor / 100);
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function statusLabel(status: InvoiceView["invoice"]["status"]): string {
  switch (status) {
    case "partially_paid":
      return "Partially paid";
    case "paid":
      return "Paid";
    case "void":
      return "Void";
    default:
      return "Open";
  }
}

function BillingContent() {
  const [account, setAccount] = useState<FinancialAccount>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [payingInvoice, setPayingInvoice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      setAccount(await listFinancialAccount());
      setState("ready");
    } catch {
      setAccount(undefined);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="client-destination client-billing-page" aria-labelledby="billing-title">
      <Link className="client-billing-back" href="/account">
        <span aria-hidden="true">&larr;</span> Back to account
      </Link>
      <p className="account-eyebrow">BPT Jersey / Billing</p>
      <h1 id="billing-title">Invoices & payments</h1>
      <p className="client-destination-intro">
        Choose how to pay, review your invoices and keep track of confirmed payments.
      </p>

      {state === "loading" ? (
        <p className="client-billing-state" aria-live="polite" role="status">
          Loading your billing account...
        </p>
      ) : null}

      {state === "error" ? (
        <section className="client-billing-state client-billing-error" role="alert">
          <h2>Billing is unavailable</h2>
          <p>We couldn&apos;t load your billing. Try again.</p>
          <button className="button button-secondary" onClick={() => void load()} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {state === "ready" && account ? (
        <>
          <section className="client-billing-summary" aria-label="Billing summary">
            <div>
              <span>Outstanding balance</span>
              <strong>{formatMoney(account.balanceMinor)}</strong>
            </div>
            <div>
              <span>PAYG debt</span>
              <strong>{formatMoney(account.paygDebtMinor)}</strong>
            </div>
          </section>

          {account.invoices.length === 0 ? (
            <section className="client-billing-state">
              <h2>No invoices yet</h2>
              <p>The academy has not issued an invoice for this account.</p>
            </section>
          ) : (
            <section className="client-invoice-list" aria-labelledby="invoice-list-title">
              <div className="client-billing-heading">
                <p className="account-eyebrow">Account ledger</p>
                <h2 id="invoice-list-title">Your invoices</h2>
              </div>
              {account.invoices.map((view) => (
                <article className="client-invoice-card" key={view.invoice.invoiceId}>
                  <header>
                    <div>
                      <p>{view.invoice.invoiceReference}</p>
                      <h3>{view.invoice.description}</h3>
                    </div>
                    <span data-status={view.invoice.status}>
                      {statusLabel(view.invoice.status)}
                    </span>
                  </header>
                  <dl>
                    <div>
                      <dt>Total</dt>
                      <dd>{formatMoney(view.invoice.totalMinor)}</dd>
                    </div>
                    <div>
                      <dt>Balance</dt>
                      <dd>{formatMoney(view.balanceMinor)}</dd>
                    </div>
                    <div>
                      <dt>Due</dt>
                      <dd>{formatDate(view.invoice.dueAt)}</dd>
                    </div>
                  </dl>
                  {view.payments.length > 0 ? (
                    <div className="client-payment-list">
                      <h4>Recorded payments</h4>
                      <ul>
                        {view.payments.map((payment) => (
                          <li key={payment.paymentId}>
                            <span>{formatDate(payment.occurredAt)}</span>
                            <strong>{formatMoney(payment.amountMinor)}</strong>
                            <span>
                              {paymentMethodLabels[payment.method]} /{" "}
                              {payment.providerReference ?? payment.manualReference}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="client-payment-empty">No payment has been recorded.</p>
                  )}
                  {view.balanceMinor > 0 && view.invoice.status !== "void" ? (
                    <>
                      <button
                        className="button button-primary client-invoice-pay"
                        type="button"
                        aria-expanded={payingInvoice === view.invoice.invoiceId}
                        aria-controls={`checkout-${view.invoice.invoiceId}`}
                        onClick={() =>
                          setPayingInvoice((current) =>
                            current === view.invoice.invoiceId ? null : view.invoice.invoiceId,
                          )
                        }
                      >
                        {payingInvoice === view.invoice.invoiceId
                          ? "Close payment options"
                          : "Pay invoice"}
                      </button>
                      {payingInvoice === view.invoice.invoiceId ? (
                        <div id={`checkout-${view.invoice.invoiceId}`}>
                          <InvoiceCheckout
                            view={view}
                            instructions={account.paymentInstructions}
                            onRefresh={() => void load()}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </article>
              ))}
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}

export default function ClientBillingPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate allow={["guardian", "adultStudent"]} returnPath="/account/billing">
        <BillingContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
