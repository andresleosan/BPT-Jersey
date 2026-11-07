"use client";

import { useId } from "react";
import {
  checkoutMethods,
  paymentMethodLabels,
  type CheckoutMethod,
  type OnlinePaymentMethod,
} from "@bpt-jersey/domain/payments";
import "./payment.css";

export function PaymentMethodPicker({
  value,
  onChange,
  enabledMethods = [],
  disabled = false,
  onChooseAtVenue,
}: {
  value: CheckoutMethod | "at_venue" | undefined;
  onChange: (method: CheckoutMethod) => void;
  enabledMethods?: readonly OnlinePaymentMethod[];
  disabled?: boolean;
  onChooseAtVenue?: () => void;
}) {
  const group = useId();
  return (
    <fieldset className="bpt-payment-methods" disabled={disabled}>
      <legend>How would you like to pay?</legend>
      <div className="bpt-payment-method-grid">
        {[...checkoutMethods, ...(onChooseAtVenue ? ["at_venue" as const] : [])].map((method) => {
          const available =
            method === "bank_transfer" || method === "at_venue" || enabledMethods.includes(method);
          return (
            <label className="bpt-payment-choice" data-selected={value === method} key={method}>
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
                  {available
                    ? method === "bank_transfer"
                      ? "Use your banking app"
                      : method === "at_venue"
                        ? "Pay at reception before class"
                        : "Continue to secure payment"
                    : "Coming soon"}
                </small>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Shared by existing transfer flows while their source-specific provider integration is pending. */
export function PendingOnlinePayment({
  method,
}: {
  method: Exclude<CheckoutMethod, "bank_transfer">;
}) {
  return (
    <section className="bpt-payment-notice" role="status">
      <h3>{paymentMethodLabels[method]} is coming soon</h3>
      <p>Choose bank transfer to complete this payment today. No online payment has been taken.</p>
    </section>
  );
}
