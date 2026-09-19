"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SubscriptionBilling } from "@bpt-jersey/domain/memberships/admin";
import { getMemberSubscriptionBilling } from "../../../../lib/subscription-admin-client";
import { SubscriptionBillingHistory } from "../member-subscription-editor";

import { MemberRecordLoadError } from "../../../../lib/member-profile-client";

type State = { status: "loading" | "error" } | { status: "ready"; billing: SubscriptionBilling[] };
export function PaymentsTab({
  studentId,
  onUnavailable,
}: {
  studentId: string;
  onUnavailable: (error: MemberRecordLoadError) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    getMemberSubscriptionBilling(studentId).then(
      (billing) => {
        if (active) setState({ status: "ready", billing });
      },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof MemberRecordLoadError && error.kind !== "error") {
          onUnavailable(error);
          return;
        }
        setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, attempt, onUnavailable]);
  return (
    <section aria-label="Recorded invoices and payments">
      <h3>Recorded invoices and payments</h3>
      <p>
        Invoices linked to this member’s memberships and their receipts. Family charges are
        available in Billing.
      </p>
      <div className="member-subscription-actions">
        <Link className="member-record-link" href="/admin/billing">
          Open Billing
        </Link>
        <button
          className="member-record-button"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      {state.status === "loading" ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading recorded payments"
          className="member-record-skeleton"
        >
          <span />
          <span />
        </div>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="member-record-notice">
          Unable to load recorded invoices and payments. Refresh to try again.
        </p>
      ) : null}
      {state.status === "ready" ? (
        state.billing.some((item) => item.invoices.length > 0) ? (
          <SubscriptionBillingHistory billing={state.billing} showHeading={false} />
        ) : (
          <p role="status">No invoices or payments recorded for this member&apos;s memberships.</p>
        )
      ) : null}
      {state.status === "ready"
        ? state.billing
            .filter((item) => item.complimentary)
            .map((item) => (
              <p key={item.membershipId}>
                Complimentary access recorded — not a payment.{item.reason ? ` ${item.reason}` : ""}
              </p>
            ))
        : null}
      <p>Earlier payments may still be in the imported archive.</p>
    </section>
  );
}
