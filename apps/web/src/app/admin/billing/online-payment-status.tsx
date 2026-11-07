"use client";

import { useEffect, useState } from "react";
import {
  onlinePaymentMethods,
  paymentMethodLabels,
  type OnlinePaymentMethod,
} from "@bpt-jersey/domain/payments";
import { getPaymentOptions } from "../../../lib/payment-client";

export function OnlinePaymentStatus() {
  const [methods, setMethods] = useState<readonly OnlinePaymentMethod[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    setMethods(null);
    getPaymentOptions().then(
      (result) => {
        if (active) setMethods(result.methods);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <section className="admin-panel-card" aria-labelledby="online-payments-title">
      <h3 id="online-payments-title">Online payments</h3>
      {error ? (
        <p role="alert">
          Payment service status could not be loaded. The payment backend may still need publishing.
        </p>
      ) : methods === null ? (
        <p role="status">Loading payment service status...</p>
      ) : (
        <ul>
          {onlinePaymentMethods.map((method) => (
            <li key={method}>
              {paymentMethodLabels[method]}:{" "}
              {methods.includes(method) ? "Connected" : "Not connected"}
            </li>
          ))}
        </ul>
      )}
      <p>
        Confirmed online payments appear in Payments with their method and provider reference. Saved
        choices and incomplete payments appear separately in Online payment activity.
      </p>
      <p>
        Invoice email delivery is awaiting configuration. Receipts are prepared after confirmed
        payments; no invoice emails are sent yet.
      </p>
      <button
        className="button button-secondary"
        type="button"
        onClick={() => setAttempt((v) => v + 1)}
      >
        Refresh payment setup
      </button>
    </section>
  );
}
