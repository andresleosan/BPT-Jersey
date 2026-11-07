"use client";

import { useId } from "react";
import {
  checkoutMethods,
  paymentMethodLabels,
  type CheckoutMethod,
} from "@bpt-jersey/domain/payments";
import { PaymentBrandIcon, PaymentCardBrands } from "./payment-brands";
import "./payment.css";

export function PaymentMethodPicker({
  value,
  onChange,
  disabled = false,
  onChooseAtVenue,
}: {
  value: CheckoutMethod | "at_venue" | undefined;
  onChange: (method: CheckoutMethod) => void;
  disabled?: boolean;
  onChooseAtVenue?: () => void;
}) {
  const group = useId();
  return (
    <fieldset className="bpt-payment-methods" disabled={disabled}>
      <legend>How would you like to pay?</legend>
      <div className="bpt-payment-method-grid">
        {[...checkoutMethods, ...(onChooseAtVenue ? ["at_venue" as const] : [])].map((method) => {
          return (
            <label
              className="bpt-payment-choice"
              data-method={method}
              data-selected={value === method}
              key={method}
            >
              <input
                type="radio"
                name={group}
                value={method}
                checked={value === method}
                onChange={() => (method === "at_venue" ? onChooseAtVenue?.() : onChange(method))}
              />
              <span>
                <strong>
                  {method === "at_venue" ? "Pay at the academy" : paymentMethodLabels[method]}
                </strong>
                <small>
                  {method === "bank_transfer"
                    ? "Use your banking app"
                    : method === "at_venue"
                      ? "Pay at reception before class"
                      : method === "card"
                        ? "Card details and billing address"
                        : "Pay with your digital wallet"}
                </small>
                {method === "wallet" ? (
                  <span className="bpt-wallet-brand-row" aria-hidden="true">
                    <PaymentBrandIcon brand="apple_pay" decorative />
                    <PaymentBrandIcon brand="google_pay" decorative />
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <PaymentCardBrands />
    </fieldset>
  );
}
