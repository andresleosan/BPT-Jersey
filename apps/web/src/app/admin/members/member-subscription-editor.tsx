"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type {
  EditableSubscription,
  MemberSubscriptionContext,
  SubscriptionEdit,
} from "@bpt-jersey/domain/memberships/admin";
import type { PlanId } from "@bpt-jersey/domain/memberships";
import { editSubscription, getMemberSubscriptions } from "../../../lib/subscription-admin-client";
import { listManagedPlans, type ManagedMembershipPlan } from "../../../lib/membership-admin-client";
import "./member-subscriptions.css";

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function SubscriptionForm({
  subscription,
  plans,
  onSaved,
}: {
  subscription: EditableSubscription;
  plans: readonly ManagedMembershipPlan[];
  onSaved: (record: EditableSubscription) => void;
}) {
  const id = useId();
  const [planId, setPlanId] = useState<PlanId>(subscription.planId);
  const [endsAt, setEndsAt] = useState(localDateTime(subscription.endsAt));
  const [noEndDate, setNoEndDate] = useState(subscription.endsAt === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; input: SubscriptionEdit } | null>(null);
  const lock = useRef(false);
  const cancelled = subscription.status === "cancelled";
  async function save(operation: "save" | "extend-month") {
    if (lock.current) return;
    if (operation === "save" && !noEndDate && (!endsAt || !Number.isFinite(Date.parse(endsAt)))) {
      setError("Enter an end date or select No end date.");
      return;
    }
    const fields = {
      membershipId: subscription.membershipId,
      expectedUpdatedAt: subscription.updatedAt,
      ...(operation === "save"
        ? {
            operation,
            planId,
            endsAt: noEndDate
              ? null
              : endsAt === localDateTime(subscription.endsAt)
                ? subscription.endsAt
                : new Date(endsAt).toISOString(),
          }
        : { operation }),
    };
    const key = JSON.stringify(fields);
    if (pending.current?.key !== key)
      pending.current = {
        key,
        input: { ...fields, requestId: crypto.randomUUID() } as SubscriptionEdit,
      };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await editSubscription(pending.current.input);
      pending.current = null;
      onSaved(result);
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
        void save("save");
      }}
    >
      <p>
        <strong>
          {plans.find((plan) => plan.planId === subscription.planId)?.displayName ??
            subscription.planId}
        </strong>{" "}
        · {subscription.status}
      </p>
      <p>
        Started {new Date(subscription.startsAt).toLocaleDateString("en-GB")}.{" "}
        {subscription.endsAt
          ? `Ends ${new Date(subscription.endsAt).toLocaleString("en-GB")}.`
          : "No end date set. Set one to receive an expiry reminder."}
      </p>
      <fieldset disabled={busy || cancelled}>
        <label htmlFor={`${id}-plan`}>Subscription plan</label>
        <select
          id={`${id}-plan`}
          value={planId}
          onChange={(event) => setPlanId(event.target.value as PlanId)}
        >
          {!plans.some((plan) => plan.planId === planId) ? (
            <option value={planId} disabled>
              {planId} (unavailable)
            </option>
          ) : null}
          {plans.map((plan) => (
            <option key={plan.planId} value={plan.planId}>
              {plan.displayName} · £{(plan.priceMinor / 100).toFixed(2)} / {plan.billingPeriod}
            </option>
          ))}
        </select>
        <label className="member-subscription-checkbox">
          <input
            type="checkbox"
            checked={noEndDate}
            onChange={(event) => setNoEndDate(event.target.checked)}
          />{" "}
          No end date
        </label>
        {!noEndDate ? (
          <>
            <label htmlFor={`${id}-end`}>End date and time (your local time)</label>
            <input
              id={`${id}-end`}
              type="datetime-local"
              required
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </>
        ) : null}
        <div className="member-subscription-actions">
          <button
            className="admin-auth-button"
            type="submit"
            disabled={!plans.some((plan) => plan.planId === planId)}
          >
            {busy ? "Saving…" : "Save subscription"}
          </button>
          <button
            className="admin-auth-button"
            type="button"
            onClick={() => void save("extend-month")}
          >
            Extend current subscription 1 month
          </button>
        </div>
      </fieldset>
      {cancelled ? (
        <p>Cancelled subscriptions cannot be edited.</p>
      ) : (
        <p className="member-subscription-help">
          Extending uses the current plan and adds a calendar month from the later of today or the
          current end date. It does not record a payment.
        </p>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function MemberSubscriptionEditor({ studentId }: { studentId: string }) {
  const [data, setData] = useState<{
    context: MemberSubscriptionContext;
    plans: readonly ManagedMembershipPlan[];
  } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reload, setReload] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([getMemberSubscriptions(studentId), listManagedPlans()]).then(
      ([context, plans]) => {
        if (active)
          setData({
            context,
            plans: plans.filter((plan) => context.eligiblePlanIds.includes(plan.planId)),
          });
      },
      () => {
        if (active) setError("Unable to load subscriptions. Please refresh and try again.");
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, reload]);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="member-subscription-editor"
      aria-label="Member subscriptions"
    >
      <div className="member-subscription-actions">
        <h3>{data ? `${data.context.fullName} — subscriptions` : "Subscriptions"}</h3>
        <button
          type="button"
          className="admin-auth-button"
          onClick={() => {
            setData(null);
            setError("");
            setSuccess("");
            setReload((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading subscriptions…</p>
      ) : null}
      {success ? <p role="status">{success}</p> : null}
      {data?.context.memberships.length === 0 ? (
        <p>
          No subscription yet. <Link href="/admin/memberships">Create a subscription</Link>.
        </p>
      ) : null}
      {data?.context.memberships.map((subscription) => (
        <SubscriptionForm
          key={`${subscription.membershipId}:${subscription.updatedAt}`}
          subscription={subscription}
          plans={data.plans}
          onSaved={(record) => {
            setData((current) =>
              current
                ? {
                    ...current,
                    context: {
                      ...current.context,
                      memberships: current.context.memberships.map((item) =>
                        item.membershipId === record.membershipId ? record : item,
                      ),
                    },
                  }
                : current,
            );
            setSuccess("Subscription updated.");
          }}
        />
      ))}
    </section>
  );
}

export function MemberSubscriptionAction({ studentId }: { studentId: string }) {
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
          <MemberSubscriptionEditor key={studentId} studentId={studentId} />
        </div>
      ) : null}
    </div>
  );
}
