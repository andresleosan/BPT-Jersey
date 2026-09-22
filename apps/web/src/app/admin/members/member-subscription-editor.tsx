"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  addSubscriptionMonth,
  type EditableSubscription,
  type ManualSubscriptionInput,
  type MemberSubscriptionContext,
  type SubscriptionBilling,
} from "@bpt-jersey/domain/memberships/admin";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import type { PlanId } from "@bpt-jersey/domain/memberships";
import {
  getMemberSubscriptions,
  getMemberSubscriptionBilling,
  manageManualSubscription,
} from "../../../lib/subscription-admin-client";
import { listManagedPlans, type ManagedMembershipPlan } from "../../../lib/membership-admin-client";
import "./member-subscriptions.css";

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const money = (minor: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const methodNames = { cash: "Cash", bank_transfer: "Bank transfer", other: "Other" };
const invoiceStates = {
  open: "Unpaid",
  partially_paid: "Partly paid",
  paid: "Paid",
  void: "Void",
};

export function SubscriptionBillingHistory({
  billing,
  showHeading = true,
}: {
  billing: readonly SubscriptionBilling[];
  showHeading?: boolean;
}) {
  const invoices = billing
    .flatMap((item) => item.invoices)
    .sort((a, b) => b.dueAt.localeCompare(a.dueAt));
  return (
    <section aria-label="Recorded payments" className="member-subscription-history">
      {showHeading ? <h4>Recorded invoices and payments</h4> : null}
      {invoices.length === 0 ? (
        <p>No invoices or payments have been recorded.</p>
      ) : (
        <ul>
          {invoices.map((invoice) => (
            <li key={invoice.invoiceId}>
              <div className="member-subscription-actions">
                <strong>{invoice.description}</strong>
                <span>
                  {invoiceStates[invoice.status]} · {money(invoice.totalMinor)}
                </span>
              </div>
              <p className="member-subscription-help">
                Due{" "}
                {new Date(invoice.dueAt).toLocaleDateString("en-GB", { timeZone: "Europe/Jersey" })}
              </p>
              {invoice.payments.map((payment) => (
                <p key={payment.paymentId}>
                  {money(payment.amountMinor)} received · {methodNames[payment.method]} ·{" "}
                  {new Date(payment.occurredAt).toLocaleDateString("en-GB", {
                    timeZone: "Europe/Jersey",
                  })}
                  <br />
                  <span className="member-subscription-help">Reference: {payment.reference}</span>
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubscriptionForm({
  studentId,
  subscription,
  billing,
  plans,
  onSaved,
  previousRecord,
}: {
  studentId: string;
  subscription?: EditableSubscription;
  billing?: SubscriptionBilling | undefined;
  plans: readonly ManagedMembershipPlan[];
  onSaved: () => void;
  previousRecord?: RegyfitMemberRecord | undefined;
}) {
  const id = useId();
  const [initialNow] = useState(() => new Date().toISOString());
  const currentInvoice = billing?.invoices.find(
    (invoice) => invoice.invoiceId === billing.currentInvoiceId,
  );
  const [operation, setOperation] = useState<ManualSubscriptionInput["operation"]>(
    subscription ? "update" : "assign",
  );
  const [planId, setPlanId] = useState<PlanId | "">(
    subscription?.planId ?? (previousRecord ? "" : plans[0]?.planId) ?? "",
  );
  const [startsAt, setStartsAt] = useState(localDateTime(subscription?.startsAt ?? initialNow));
  const [endsAt, setEndsAt] = useState(
    localDateTime(subscription ? subscription.endsAt : addSubscriptionMonth(initialNow)),
  );
  const [noEndDate, setNoEndDate] = useState(subscription?.endsAt === null);
  const [kind, setKind] = useState<ManualSubscriptionInput["settlement"]["kind"]>(
    subscription?.planId === "transit-free" ? "complimentary" : subscription ? "unchanged" : "paid",
  );
  const [amount, setAmount] = useState(
    (
      (currentInvoice?.totalMinor ??
        plans.find((plan) => plan.planId === planId)?.priceMinor ??
        0) / 100
    ).toFixed(2),
  );
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "other">("cash");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState(localDateTime(initialNow));
  const [reason, setReason] = useState(
    subscription?.planId === "transit-free"
      ? (billing?.reason ?? "Transit Free indefinite access")
      : "",
  );
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const pending = useRef<{ key: string; input: ManualSubscriptionInput } | null>(null);
  const paidHistory =
    currentInvoice?.status === "paid" || currentInvoice?.status === "partially_paid";
  const outstanding =
    currentInvoice?.status === "open" || currentInvoice?.status === "partially_paid";
  const cancelled = subscription?.status === "cancelled";
  const selectedPlan = plans.find((plan) => plan.planId === planId);
  const isTransitFree = planId === "transit-free";
  const paymentLocked = operation === "update" && paidHistory;

  function chooseOperation(next: "update" | "renew") {
    setOperation(next);
    setKind(isTransitFree ? "complimentary" : next === "update" ? "unchanged" : "paid");
    setError("");
    if (next === "renew") {
      const start = new Date(
        Math.max(Date.now(), subscription?.endsAt ? Date.parse(subscription.endsAt) : 0),
      ).toISOString();
      setStartsAt(localDateTime(start));
      setEndsAt(localDateTime(addSubscriptionMonth(start)));
      setNoEndDate(false);
      setAmount(((selectedPlan?.priceMinor ?? 0) / 100).toFixed(2));
    } else if (subscription) {
      setStartsAt(localDateTime(subscription.startsAt));
      setEndsAt(localDateTime(subscription.endsAt));
      setNoEndDate(subscription.endsAt === null);
      setAmount(((currentInvoice?.totalMinor ?? selectedPlan?.priceMinor ?? 0) / 100).toFixed(2));
    }
  }
  function choosePlan(next: PlanId) {
    setPlanId(next);
    const nextPlan = plans.find((plan) => plan.planId === next);
    setAmount(((nextPlan?.priceMinor ?? 0) / 100).toFixed(2));
    if (next === "transit-free") {
      setNoEndDate(true);
      setKind("complimentary");
      setReason("Transit Free indefinite access");
      return;
    }
    if (isTransitFree) {
      setNoEndDate(false);
      setEndsAt(localDateTime(addSubscriptionMonth(new Date(startsAt).toISOString())));
      setKind("paid");
      setReason("");
    }
  }

  async function save() {
    if (lock.current || !planId) return;
    setError("");
    const start = new Date(startsAt);
    const end = noEndDate ? null : new Date(endsAt);
    if (
      !Number.isFinite(start.getTime()) ||
      (end && (!Number.isFinite(end.getTime()) || end <= start))
    ) {
      setError("Enter a valid start date and an end date after it.");
      return;
    }
    const amountMinor = Math.round(Number(amount) * 100);
    if (
      (kind === "paid" || kind === "unpaid") &&
      (!/^\d+(\.\d{1,2})?$/.test(amount) || amountMinor <= 0 || amountMinor > 100_000_000)
    ) {
      setError("Enter an amount greater than £0, with up to two decimal places.");
      return;
    }
    const received = new Date(receivedAt);
    if (
      kind === "paid" &&
      (!Number.isFinite(received.getTime()) || received.getTime() > Date.now())
    ) {
      setError("Enter when the payment was received. It cannot be in the future.");
      return;
    }
    if (kind === "complimentary" && !reason.trim()) {
      setError("Enter a reason for free membership.");
      return;
    }
    if (kind === "previously-paid" && (!previousRecord || !paymentConfirmed || noEndDate)) {
      setError("Confirm the previous payment and its end date before linking access.");
      return;
    }
    const fields = {
      studentId,
      membershipId: subscription?.membershipId ?? null,
      expectedUpdatedAt: subscription?.updatedAt ?? null,
      operation,
      planId,
      startsAt:
        operation === "update" && startsAt === localDateTime(subscription?.startsAt ?? null)
          ? subscription!.startsAt
          : start.toISOString(),
      endsAt: noEndDate
        ? null
        : operation === "update" && endsAt === localDateTime(subscription?.endsAt ?? null)
          ? subscription!.endsAt
          : end!.toISOString(),
    };
    const key = JSON.stringify({
      fields,
      kind,
      amountMinor,
      method,
      reference,
      receivedAt,
      reason,
    });
    if (pending.current?.key !== key) {
      const requestId = crypto.randomUUID();
      const settlement: ManualSubscriptionInput["settlement"] =
        kind === "paid"
          ? {
              kind,
              amountMinor,
              method,
              reference: reference.trim() || `OFFICE-${requestId}`,
              occurredAt: received.toISOString(),
            }
          : kind === "unpaid"
            ? { kind, amountMinor }
            : kind === "previously-paid" && previousRecord
              ? { kind, recordId: previousRecord.recordId, paymentConfirmed: true }
              : kind === "complimentary"
                ? { kind, reason: reason.trim() }
                : { kind: "unchanged" };
      pending.current = { key, input: { ...fields, requestId, settlement } };
    }
    lock.current = true;
    setBusy(true);
    try {
      await manageManualSubscription(pending.current.input);
      pending.current = null;
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save subscription.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="member-subscription-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="member-subscription-actions">
        <h4>
          {subscription
            ? (plans.find((plan) => plan.planId === subscription.planId)?.displayName ??
              subscription.planId)
            : "Assign a subscription"}
        </h4>
        {subscription ? (
          <span className="member-subscription-status">
            {subscription.status === "overdue" ? "Payment due" : subscription.status}
            {billing?.complimentary ? " · Complimentary" : ""}
          </span>
        ) : null}
      </div>
      {billing?.complimentary && billing.reason ? <p>Free membership: {billing.reason}</p> : null}
      {billing?.previousPaymentRecordId ? (
        <p>
          Access is linked to a previous payment. Original receipts remain in the member archive.
        </p>
      ) : null}
      {previousRecord && !subscription ? (
        <div className="member-record-notice">
          <h4>Previous paid membership</h4>
          <p>
            {previousRecord.plan.membershipPlan ?? "Plan not recorded"} ·{" "}
            {previousRecord.plan.validFrom ?? "Start not recorded"} to{" "}
            {previousRecord.plan.validUntil ?? "End not recorded"}
          </p>
          <p>
            Choose the matching current plan and confirm the paid dates. Select Previously paid to
            retain the original receipts without recording another payment.
          </p>
        </div>
      ) : null}
      <fieldset disabled={busy || cancelled}>
        {subscription && !cancelled ? (
          <label className="member-subscription-field" htmlFor={`${id}-operation`}>
            Action
            <select
              id={`${id}-operation`}
              value={operation}
              onChange={(event) => chooseOperation(event.target.value as "update" | "renew")}
            >
              <option value="update">Change current subscription</option>
              <option value="renew" disabled={outstanding || isTransitFree}>
                Renew for a new period
              </option>
            </select>
          </label>
        ) : null}
        <label className="member-subscription-field" htmlFor={`${id}-plan`}>
          Subscription plan
          <select
            id={`${id}-plan`}
            required
            value={planId}
            onChange={(event) => choosePlan(event.target.value as PlanId)}
          >
            {!selectedPlan ? (
              <option value={planId} disabled>
                {planId || "No active plans available"}
              </option>
            ) : null}
            {plans.map((plan) => (
              <option key={plan.planId} value={plan.planId}>
                {plan.planId === "transit-free" ? (
                  "Transit Free · unlimited, indefinite"
                ) : (
                  <>
                    {plan.displayName} · {money(plan.priceMinor)} / {plan.billingPeriod}
                  </>
                )}
              </option>
            ))}
          </select>
        </label>
        <p className="member-subscription-help">
          You can assign any active plan. Changing a plan does not collect a payment.
        </p>
        <div className="member-subscription-grid">
          <label className="member-subscription-field" htmlFor={`${id}-start`}>
            Start date and time
            <input
              id={`${id}-start`}
              type="datetime-local"
              required
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </label>
          {!noEndDate ? (
            <label className="member-subscription-field" htmlFor={`${id}-end`}>
              End date and time
              <input
                id={`${id}-end`}
                type="datetime-local"
                required
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </label>
          ) : null}
        </div>
        <label className="member-subscription-checkbox">
          <input
            type="checkbox"
            checked={noEndDate}
            disabled={isTransitFree}
            onChange={(event) => setNoEndDate(event.target.checked)}
          />
          No end date
        </label>
        <p className="member-subscription-help">
          {isTransitFree
            ? "Transit Free never expires and has no recurring charge."
            : "Times use your device’s time zone. Set an end date to receive an expiry reminder."}
        </p>
        <label className="member-subscription-field" htmlFor={`${id}-settlement`}>
          Payment for this period
          <select
            id={`${id}-settlement`}
            value={kind}
            disabled={paymentLocked || isTransitFree}
            onChange={(event) => {
              const next = event.target.value as typeof kind;
              setKind(next);
              setPaymentConfirmed(false);
              if (next === "previously-paid") {
                setNoEndDate(false);
                setStartsAt(
                  previousRecord?.plan.validFrom ? `${previousRecord.plan.validFrom}T00:00` : "",
                );
                setEndsAt(
                  previousRecord?.plan.validUntil
                    ? new Date(Date.parse(previousRecord.plan.validUntil + "T00:00:00Z") + 86400000)
                        .toISOString()
                        .slice(0, 10) + "T00:00"
                    : "",
                );
              }
            }}
          >
            {operation === "update" ? (
              <option value="unchanged">Keep current payment status</option>
            ) : null}
            {previousRecord && operation === "assign" ? (
              <option value="previously-paid">Previously paid: link existing payment</option>
            ) : null}
            <option value="paid">Payment received</option>
            <option value="unpaid">Unpaid — amount due</option>
            <option value="complimentary">Complimentary — no payment required</option>
          </select>
        </label>
        {kind === "previously-paid" ? (
          <label className="member-subscription-checkbox">
            <input
              type="checkbox"
              required
              checked={paymentConfirmed}
              onChange={(event) => setPaymentConfirmed(event.target.checked)}
            />
            I have verified this member's previous payment, plan and paid period.
          </label>
        ) : null}
        {paymentLocked ? (
          <p className="member-subscription-help">
            Recorded payments are preserved. Choose Renew for a new period.{" "}
            {outstanding ? (
              <>
                Settle the outstanding balance in <Link href="/admin/billing">Billing</Link> first.
              </>
            ) : null}
          </p>
        ) : null}
        {kind === "paid" || kind === "unpaid" ? (
          <label className="member-subscription-field" htmlFor={`${id}-amount`}>
            Amount (£)
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              required
              value={amount}
              readOnly={operation === "update" && currentInvoice?.status === "open"}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
        ) : null}
        {kind === "paid" ? (
          <>
            <div className="member-subscription-grid">
              <label className="member-subscription-field" htmlFor={`${id}-method`}>
                Payment method
                <select
                  id={`${id}-method`}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as typeof method)}
                >
                  {Object.entries(methodNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="member-subscription-field" htmlFor={`${id}-received`}>
                Received on
                <input
                  id={`${id}-received`}
                  type="datetime-local"
                  required
                  value={receivedAt}
                  onChange={(event) => setReceivedAt(event.target.value)}
                />
              </label>
            </div>
            <label className="member-subscription-field" htmlFor={`${id}-reference`}>
              Payment reference (optional)
              <input
                id={`${id}-reference`}
                maxLength={120}
                pattern="[A-Za-z0-9][A-Za-z0-9._:\-]*"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                aria-describedby={`${id}-reference-help`}
              />
            </label>
            <p id={`${id}-reference-help`} className="member-subscription-help">
              Use letters, numbers, dots, colons, underscores or hyphens. Leave blank to generate a
              unique receipt reference.
            </p>
          </>
        ) : null}
        {kind === "complimentary" ? (
          <label className="member-subscription-field" htmlFor={`${id}-reason`}>
            Reason for free membership
            <input
              id={`${id}-reason`}
              required
              maxLength={240}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
        <div className="member-subscription-actions">
          <button className="admin-auth-button" type="submit" disabled={!selectedPlan}>
            {busy
              ? "Saving…"
              : operation === "assign"
                ? "Assign subscription"
                : operation === "renew"
                  ? "Renew subscription"
                  : "Save subscription"}
          </button>
        </div>
      </fieldset>
      {cancelled ? (
        <p>This subscription has been cancelled. Its payment history is preserved.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function MemberSubscriptionEditor({
  studentId,
  onStatusChange,
  previousRecord,
  role,
}: {
  studentId: string;
  onStatusChange?: (saved: boolean) => void;
  previousRecord?: RegyfitMemberRecord | undefined;
  /** D13: Transit Free is never offered to members; only an owner actor may assign it. */
  role?: string | null | undefined;
}) {
  const [data, setData] = useState<{
    context: MemberSubscriptionContext;
    plans: readonly ManagedMembershipPlan[];
    billing: SubscriptionBilling[];
  } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reload, setReload] = useState(0);
  function refresh() {
    onStatusChange?.(false);
    setData(null);
    setError("");
    setReload((value) => value + 1);
  }
  useEffect(() => {
    let active = true;
    void Promise.all([
      getMemberSubscriptions(studentId),
      listManagedPlans(),
      getMemberSubscriptionBilling(studentId),
    ]).then(
      ([context, plans, billing]) => {
        if (active) {
          setData({
            context,
            plans: plans.filter(
              (plan) => plan.active && (role === "owner" || plan.planId !== "transit-free"),
            ),
            billing,
          });
          onStatusChange?.(context.memberships.some((item) => item.status !== "cancelled"));
        }
      },
      (failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "Unable to load subscriptions.");
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, reload, onStatusChange, role]);
  function saved() {
    setSuccess("Subscription saved. Access follows the confirmed paid period.");
    refresh();
  }
  return (
    <section className="member-subscription-editor" aria-label="Member subscriptions">
      <div className="member-subscription-actions">
        <h3>Current subscription</h3>
        <button type="button" className="admin-auth-button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading subscriptions and payments…</p>
      ) : null}
      {success ? <p role="status">{success}</p> : null}
      {data ? (
        <>
          {data.plans.length === 0 ? (
            <p role="alert">
              No active subscription plans are available.{" "}
              <Link href="/admin/memberships">Manage membership plans</Link> before completing
              registration.
            </p>
          ) : null}
          {!data.context.memberships.some((item) => item.status !== "cancelled") ? (
            <SubscriptionForm
              studentId={studentId}
              plans={data.plans}
              onSaved={saved}
              previousRecord={previousRecord}
            />
          ) : null}
          {data.context.memberships.map((subscription) => (
            <SubscriptionForm
              key={`${subscription.membershipId}:${subscription.updatedAt}`}
              studentId={studentId}
              subscription={subscription}
              billing={data.billing.find((item) => item.membershipId === subscription.membershipId)}
              plans={data.plans}
              onSaved={saved}
            />
          ))}
          <SubscriptionBillingHistory billing={data.billing} />
        </>
      ) : null}
    </section>
  );
}

export function MemberSubscriptionPayments({ studentId }: { studentId: string }) {
  const [billing, setBilling] = useState<SubscriptionBilling[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void getMemberSubscriptionBilling(studentId).then(
      (data) => {
        if (active) setBilling(data);
      },
      (failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "Unable to load payments.");
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, attempt]);
  return (
    <section className="member-subscription-editor" aria-label="Current payment history">
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button
            className="admin-auth-button"
            type="button"
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Retry loading payments
          </button>
        </>
      ) : billing ? (
        <SubscriptionBillingHistory billing={billing} />
      ) : (
        <p role="status">Loading payments…</p>
      )}
    </section>
  );
}

export function MemberSubscriptionAction({
  studentId,
  role,
}: {
  studentId: string;
  role?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button
        className="admin-auth-button"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Close subscription" : "Edit subscription"}
      </button>
      {open ? (
        <div id={id}>
          <MemberSubscriptionEditor key={studentId} studentId={studentId} role={role} />
        </div>
      ) : null}
    </div>
  );
}
