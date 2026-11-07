"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  billingDetailsSchema,
  paymentMethodLabels,
  type BillingDetails,
  type CheckoutMethod,
  type CheckoutRecord,
  type OnlinePaymentMethod,
} from "@bpt-jersey/domain/payments";
import {
  formatSortCode,
  type InvoiceView,
  type PaymentInstructions,
} from "../../lib/billing-client";
import { getPaymentOptions, listPaymentActivity, preparePayment } from "../../lib/payment-client";
import { PaymentMethodPicker } from "./payment-method-picker";

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
const emptyBilling: BillingDetails = {
  name: "",
  email: "",
  line1: "",
  line2: "",
  city: "",
  postalCode: "",
  countryCode: "JE",
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
  const id = useId();
  const [method, setMethod] = useState<CheckoutMethod>("bank_transfer");
  const [billing, setBilling] = useState(emptyBilling);
  const [enabled, setEnabled] = useState<readonly OnlinePaymentMethod[]>([]);
  const [optionsState, setOptionsState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<CheckoutRecord | null>(null);
  const submission = useRef<{ fingerprint: string; requestId: string } | null>(null);
  useEffect(() => {
    let active = true;
    setOptionsState("loading");
    getPaymentOptions().then(
      (options) => {
        if (active) {
          setEnabled(options.methods);
          setOptionsState("ready");
        }
      },
      () => {
        if (active) {
          setEnabled([]);
          setOptionsState("error");
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const online = method !== "bank_transfer";
  const available = online && enabled.includes(method);
  const isCard = method === "debit_card" || method === "credit_card";
  function field(
    key: keyof BillingDetails,
    label: string,
    autoComplete: string,
    options: { optional?: boolean; type?: string; wide?: boolean } = {},
  ) {
    return (
      <label
        className={`bpt-checkout-field${options.wide ? " bpt-checkout-field-wide" : ""}`}
        htmlFor={`${id}-${key}`}
      >
        {label}
        {options.optional ? " (optional)" : ""}
        <input
          autoComplete={autoComplete}
          id={`${id}-${key}`}
          type={options.type ?? "text"}
          maxLength={
            key === "email"
              ? 254
              : key === "postalCode"
                ? 20
                : key === "name"
                  ? 120
                  : key === "city"
                    ? 100
                    : 160
          }
          required={!options.optional}
          value={billing[key]}
          onChange={(e) => {
            setBilling({ ...billing, [key]: e.target.value });
            setSaved(null);
            setError("");
          }}
        />
      </label>
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!online || busy) return;
    const parsed = billingDetailsSchema.safeParse(billing);
    if (!parsed.success) {
      setError("Check your name, email and full billing address.");
      return;
    }
    const fingerprint = JSON.stringify({
      method,
      billing: parsed.data,
      invoiceId: view.invoice.invoiceId,
    });
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await preparePayment({
        invoiceId: view.invoice.invoiceId,
        method,
        billing: parsed.data,
        requestId: submission.current.requestId,
      });
      setSaved(result);
      if (["failed", "cancelled"].includes(result.status)) submission.current = null;
      if (result.status === "requires_action" && result.checkoutUrl) {
        const destination = new URL(result.checkoutUrl);
        if (destination.protocol !== "https:" || destination.username || destination.password)
          throw new Error("Payment destination is unavailable.");
        window.location.assign(destination.href);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Payment details could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bpt-checkout" aria-label={`Pay invoice ${view.invoice.invoiceReference}`}>
      <div className="bpt-checkout-layout">
        <div>
          <PaymentMethodPicker
            value={method}
            enabledMethods={enabled}
            disabled={busy}
            onChange={(value) => {
              setMethod(value);
              setSaved(null);
              setError("");
            }}
          />
          {optionsState === "loading" ? (
            <p className="bpt-checkout-help" role="status">
              Checking payment availability...
            </p>
          ) : null}
          {optionsState === "error" ? (
            <p className="bpt-checkout-help">
              Online payment services are unavailable. Bank transfer is still available.{" "}
              <button
                type="button"
                className="client-billing-retry"
                onClick={() => setAttempt((v) => v + 1)}
              >
                Retry payment options
              </button>
            </p>
          ) : null}
          {!online ? (
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
            <form className="bpt-checkout-form" onSubmit={(event) => void submit(event)}>
              {!available ? (
                <section className="bpt-payment-notice" role="status">
                  <h3>{paymentMethodLabels[method]} is coming soon</h3>
                  <p>
                    You can save your billing details for this invoice. To pay today, choose bank
                    transfer.
                  </p>
                </section>
              ) : (
                <p className="bpt-checkout-help">
                  Complete your payment on our payment provider&apos;s secure page. Return here to
                  check confirmation.
                </p>
              )}
              <fieldset disabled={busy}>
                <legend>Billing details</legend>
                <div className="bpt-billing-fields">
                  {field(
                    "name",
                    isCard ? "Name as it appears on your card" : "Full name",
                    isCard ? "cc-name" : "name",
                    { wide: true },
                  )}
                  {field("email", "Email for your invoice", "email", { type: "email", wide: true })}
                  {field("line1", "Address", "address-line1", { wide: true })}
                  {field("line2", "Apartment, suite or building", "address-line2", {
                    optional: true,
                    wide: true,
                  })}
                  {field("city", "Town or city", "address-level2")}
                  {field("postalCode", "Postcode", "postal-code")}
                  <label
                    className="bpt-checkout-field bpt-checkout-field-wide"
                    htmlFor={`${id}-country`}
                  >
                    Country or territory
                    <select
                      autoComplete="country"
                      id={`${id}-country`}
                      value={billing.countryCode}
                      onChange={(e) => {
                        setBilling({ ...billing, countryCode: e.target.value });
                        setSaved(null);
                      }}
                    >
                      <option value="JE">Jersey</option>
                      <option value="GB">United Kingdom</option>
                      <option value="GG">Guernsey</option>
                      <option value="IE">Ireland</option>
                      <option value="FR">France</option>
                      <option value="PT">Portugal</option>
                      <option value="ES">Spain</option>
                      <option value="BR">Brazil</option>
                      <option value="US">United States</option>
                      <option value="CA">Canada</option>
                      <option value="AU">Australia</option>
                    </select>
                  </label>
                </div>
              </fieldset>
              {isCard ? (
                <fieldset disabled aria-describedby={`${id}-card-help`}>
                  <legend>Card details</legend>
                  <div className="bpt-card-fields">
                    <label className="bpt-checkout-field bpt-checkout-field-wide">
                      Card number
                      <input
                        placeholder={
                          available
                            ? "Enter securely on the next page"
                            : "Secure card payment coming soon"
                        }
                        autoComplete="off"
                        disabled
                      />
                    </label>
                    <label className="bpt-checkout-field">
                      Expiry date
                      <input placeholder="MM / YY" autoComplete="off" disabled />
                    </label>
                    <label className="bpt-checkout-field">
                      Security code
                      <input placeholder="3 digits" autoComplete="off" disabled />
                    </label>
                  </div>
                  <p id={`${id}-card-help`} className="bpt-checkout-help">
                    {available
                      ? "Enter your card number, expiry and security code on the secure payment page after continuing."
                      : "Card fields will open with our payment provider. Please do not send card details to the academy."}
                  </p>
                </fieldset>
              ) : null}
              <p className="bpt-checkout-help">
                After payment is confirmed, your invoice will be available in your account. Invoice
                email delivery is being set up.
              </p>
              {error ? (
                <p className="bpt-checkout-error" role="alert">
                  {error}
                </p>
              ) : null}
              {saved ? (
                <section className="bpt-payment-notice" role="status">
                  <h3>{checkoutStatusLabels[saved.status]}</h3>
                  <p>
                    {saved.status === "succeeded"
                      ? "Refresh your account to see your recorded payment."
                      : saved.status === "unconfigured"
                        ? "Your billing details and chosen method have been saved. No payment has been taken."
                        : saved.status === "review_required"
                          ? "Contact the academy before trying another payment. We need to check this attempt."
                          : "Check your payment status before starting another payment."}
                  </p>
                </section>
              ) : null}
              <div className="bpt-checkout-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={
                    busy ||
                    optionsState === "loading" ||
                    (saved !== null && !["failed", "cancelled"].includes(saved.status))
                  }
                >
                  {busy
                    ? "Saving details..."
                    : available
                      ? `Pay ${money(view.balanceMinor)}`
                      : "Save payment details"}
                </button>
              </div>
            </form>
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
