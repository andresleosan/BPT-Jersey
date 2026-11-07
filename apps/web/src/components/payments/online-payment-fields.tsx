"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  billingDetailsSchema,
  paymentMethodLabels,
  type BillingDetails,
  type OnlineCheckoutMethod,
} from "@bpt-jersey/domain/payments";
import { PaymentBrandIcon } from "./payment-brands";
import "./payment.css";

const initialBilling: BillingDetails = {
  name: "",
  email: "",
  line1: "",
  line2: "",
  city: "",
  postalCode: "",
  countryCode: "JE",
};
const providerPending =
  "The payment provider is not connected yet. No payment has been taken. Please use bank transfer to pay today.";

export type OnlinePaymentSubmission =
  | { method: "card"; billing: BillingDetails }
  | { method: "apple_pay" | "google_pay" };

function WalletPaymentFields({
  onPay,
  disabled,
}: {
  onPay: ((payment: OnlinePaymentSubmission) => Promise<string>) | undefined;
  disabled: boolean;
}) {
  const [wallet, setWallet] = useState<"apple_pay" | "google_pay" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  async function next() {
    if (inFlight.current || disabled) return;
    setError("");
    setMessage("");
    if (!wallet) {
      setError("Choose Apple Pay or Google Pay to continue.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      setMessage(onPay ? await onPay({ method: wallet }) : providerPending);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Payment could not be started. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="bpt-checkout-form bpt-online-payment-fields">
      <fieldset disabled={busy || disabled}>
        <legend>Choose your digital wallet</legend>
        <div className="bpt-payment-method-grid">
          {(["apple_pay", "google_pay"] as const).map((method) => (
            <button
              key={method}
              className="bpt-payment-choice bpt-wallet-choice"
              type="button"
              aria-label={paymentMethodLabels[method]}
              aria-pressed={wallet === method}
              data-selected={wallet === method}
              onClick={() => {
                setWallet(method);
                setError("");
                setMessage("");
              }}
            >
              <PaymentBrandIcon brand={method} decorative />
            </button>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p className="bpt-checkout-error" role="alert">{error}</p>
      ) : null}
      {message ? (
        <p className="bpt-payment-notice" role="status">{message}</p>
      ) : null}
      <div className="bpt-checkout-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || disabled}
          onClick={() => void next()}
        >
          {busy ? "Opening payment..." : "Next"}
        </button>
      </div>
    </div>
  );
}

/** Shared fields also work inside registration/shop forms without introducing nested forms.
 * Raw card inputs are uncontrolled, unnamed and cleared before the async hand-off. A provider
 * SDK must own/replace them for real payment collection; onPay never receives raw card data. */
type OnlinePaymentFieldsProps = {
  method: OnlineCheckoutMethod;
  amountMinor: number;
  onPay?: (payment: OnlinePaymentSubmission) => Promise<string>;
  disabled?: boolean;
};

export function OnlinePaymentFields(props: OnlinePaymentFieldsProps) {
  return props.method === "wallet" ? (
    <WalletPaymentFields onPay={props.onPay} disabled={props.disabled ?? false} />
  ) : (
    <CardPaymentFields {...props} />
  );
}

function CardPaymentFields({
  amountMinor,
  onPay,
  disabled = false,
}: OnlinePaymentFieldsProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const cardNumber = useRef<HTMLInputElement>(null);
  const cardExpiry = useRef<HTMLInputElement>(null);
  const cardCode = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [billing, setBilling] = useState(initialBilling);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    amountMinor / 100,
  );

  useEffect(() => {
    const inputs = [cardNumber.current, cardExpiry.current, cardCode.current];
    return () => {
      for (const input of inputs) if (input) input.value = "";
    };
  }, []);

  function clearCardFields() {
    for (const input of [cardNumber.current, cardExpiry.current, cardCode.current]) {
      if (input) {
        input.value = "";
        input.setCustomValidity("");
      }
    }
  }
  function validateCard() {
    const number = cardNumber.current;
    const expiry = cardExpiry.current;
    if (!number || !expiry) return false;
    const digits = number.value.replace(/[ -]/gu, "");
    let sum = 0;
    for (let index = digits.length - 1, double = false; index >= 0; index--, double = !double) {
      let digit = Number(digits[index]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    number.setCustomValidity(
      /^\d{12,19}$/u.test(digits) && !/^0+$/u.test(digits) && sum % 10 === 0
        ? ""
        : "Enter a valid card number.",
    );
    if (!number.reportValidity()) return false;
    const date = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/u.exec(expiry.value.trim());
    const now = new Date();
    const year = date ? (date[2]!.length === 2 ? 2000 + Number(date[2]) : Number(date[2])) : 0;
    const month = date ? Number(date[1]) : 0;
    const valid =
      date &&
      (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1));
    expiry.setCustomValidity(valid ? "" : "Enter a current expiry date, such as MM / YY.");
    return expiry.reportValidity();
  }
  async function pay() {
    if (inFlight.current || disabled) return;
    setError("");
    setMessage("");
    const inputs = root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input, select",
    );
    if (inputs) for (const input of inputs) if (!input.reportValidity()) return;
    if (!validateCard()) return;
    const parsed = billingDetailsSchema.safeParse(billing);
    if (!parsed.success) {
      setError("Check your name, email and full billing address.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    // Card values never enter React state, a callable, persistence, logs or the callback payload.
    clearCardFields();
    try {
      setMessage(onPay ? await onPay({ method: "card", billing: parsed.data }) : providerPending);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Payment could not be started. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function field(
    key: keyof BillingDetails,
    label: string,
    autoComplete: string,
    optional = false,
    wide = false,
  ) {
    return (
      <label
        className={`bpt-checkout-field${wide ? " bpt-checkout-field-wide" : ""}`}
        htmlFor={`${id}-${key}`}
      >
        {label}
        {optional ? " (optional)" : ""}
        <input
          id={`${id}-${key}`}
          type={key === "email" ? "email" : "text"}
          autoComplete={autoComplete}
          required={!optional}
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
          value={billing[key]}
          onChange={(event) => {
            setBilling({ ...billing, [key]: event.target.value });
            setMessage("");
            setError("");
          }}
        />
      </label>
    );
  }
  return (
    <div
      className="bpt-checkout-form bpt-online-payment-fields"
      ref={root}
      role="group"
      aria-label="Card payment details"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          !event.nativeEvent.isComposing &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault();
          event.stopPropagation();
          void pay();
        }
      }}
    >
      <fieldset disabled={busy || disabled}>
        <legend>Billing details</legend>
        <div className="bpt-billing-fields">
          {field(
            "name",
            "Name as it appears on your card",
            "cc-name",
            false,
            true,
          )}
          {field("email", "Email for your invoice", "email", false, true)}
          {field("line1", "Address", "address-line1", false, true)}
          {field("line2", "Apartment, suite or building", "address-line2", true, true)}
          {field("city", "Town or city", "address-level2")}
          {field("postalCode", "Postcode", "postal-code")}
          <label className="bpt-checkout-field bpt-checkout-field-wide" htmlFor={`${id}-country`}>
            Country or territory
            <select
              id={`${id}-country`}
              autoComplete="country"
              value={billing.countryCode}
              onChange={(event) => {
                setBilling({ ...billing, countryCode: event.target.value });
                setMessage("");
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
        <fieldset disabled={busy || disabled} aria-describedby={`${id}-card-help`}>
          <legend>Card details</legend>
          <div className="bpt-card-fields">
            <label className="bpt-checkout-field bpt-checkout-field-wide" htmlFor={`${id}-number`}>
              Card number
              <input
                id={`${id}-number`}
                ref={cardNumber}
                autoComplete="cc-number"
                inputMode="numeric"
                maxLength={27}
                placeholder="Card number"
                required
                onInput={(event) => event.currentTarget.setCustomValidity("")}
              />
            </label>
            <label className="bpt-checkout-field" htmlFor={`${id}-expiry`}>
              Expiry date
              <input
                id={`${id}-expiry`}
                ref={cardExpiry}
                autoComplete="cc-exp"
                inputMode="numeric"
                maxLength={9}
                placeholder="MM / YY"
                required
                onInput={(event) => {
                  const input = event.currentTarget;
                  const digits = input.value.replace(/\D/gu, "").slice(0, 6);
                  input.value =
                    digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
                  input.setCustomValidity("");
                }}
              />
            </label>
            <label className="bpt-checkout-field" htmlFor={`${id}-code`}>
              Security code
              <input
                id={`${id}-code`}
                ref={cardCode}
                type="password"
                autoComplete="cc-csc"
                inputMode="numeric"
                pattern="[0-9]{3}"
                maxLength={3}
                placeholder="3 digits"
                required
              />
            </label>
          </div>
          <p id={`${id}-card-help`} className="bpt-checkout-help">
            Card details stay in this form and are cleared when you choose Pay. Secure payment is
            handled by the payment provider.
          </p>
        </fieldset>
      {error ? (
        <p className="bpt-checkout-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="bpt-payment-notice" role="status">
          {message}
        </p>
      ) : null}
      <div className="bpt-checkout-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || disabled}
          onClick={() => void pay()}
        >
          {busy ? "Opening payment..." : `Pay ${amount}`}
        </button>
      </div>
    </div>
  );
}
