"use client";

import { selectCurrentMembership } from "@bpt-jersey/domain/memberships/lifecycle";
import { useEffect, useId, useRef, useState } from "react";
import type {
  EditableSubscription,
  ManualSubscriptionInput,
  MemberSubscriptionContext,
} from "@bpt-jersey/domain/memberships/admin";
import type { PlanId } from "@bpt-jersey/domain/memberships";
import type { MemberProfileCards } from "@bpt-jersey/domain/members/profile";
import {
  getMemberSubscriptions,
  manageManualSubscription,
} from "../../../../lib/subscription-admin-client";
import {
  listManagedPlans,
  type ManagedMembershipPlan,
} from "../../../../lib/membership-admin-client";
import "../member-subscriptions.css";

type Current = MemberProfileCards["currentMembership"];
import { MemberRecordLoadError } from "../../../../lib/member-profile-client";

type State =
  | { status: "loading" | "error" }
  | {
      status: "ready";
      context: MemberSubscriptionContext;
      names: Map<string, string>;
      plans: readonly ManagedMembershipPlan[];
      current: Current;
    };
const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Jersey" }).format(
    new Date(value),
  );

const localDay = (iso: string | null | undefined) =>
  iso
    ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10)
    : "";
// Transit Free and pay-as-you-go plans never expire; every other plan needs an office expiry date.
const noExpiry = (plan: ManagedMembershipPlan | undefined) =>
  plan?.planId === "transit-free" || plan?.billingPeriod === "per-session";

/**
 * Temporary office shortcut while legacy members are registered one by one: set the plan and its
 * expiry directly. Assigning records no payment; the plan shows in the member's My plan.
 */
function ChangePlanForm({
  studentId,
  current,
  plans,
  onDone,
}: {
  studentId: string;
  current: EditableSubscription | undefined;
  plans: readonly ManagedMembershipPlan[];
  onDone: (saved: boolean) => void;
}) {
  const id = useId();
  const [planId, setPlanId] = useState<PlanId | "">(current?.planId ?? "");
  const [expiry, setExpiry] = useState(localDay(current?.endsAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; input: ManualSubscriptionInput } | null>(null);
  const lock = useRef(false);
  const plan = plans.find((item) => item.planId === planId);
  const needsExpiry = Boolean(plan) && !noExpiry(plan);
  async function save() {
    if (lock.current || !plan) return;
    setError("");
    const startsAt = current?.startsAt ?? new Date().toISOString();
    const endsAt = needsExpiry ? new Date(`${expiry}T23:59:59`) : null;
    if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= new Date(startsAt))) {
      setError("Enter an expiry date after the plan start.");
      return;
    }
    const transitFree = plan.planId === "transit-free";
    const settlement: ManualSubscriptionInput["settlement"] = transitFree
      ? { kind: "complimentary", reason: "Transit Free indefinite access" }
      : current && current.planId !== "transit-free"
        ? { kind: "unchanged" }
        : !current && plan.billingPeriod === "per-session"
          ? { kind: "pay-as-you-go" }
          : { kind: "complimentary", reason: "Plan set by the office for an existing member" };
    const fields = {
      studentId,
      membershipId: current?.membershipId ?? null,
      expectedUpdatedAt: current?.updatedAt ?? null,
      operation: current ? ("update" as const) : ("assign" as const),
      planId: plan.planId,
      startsAt,
      endsAt: endsAt?.toISOString() ?? null,
      settlement,
    };
    const key = JSON.stringify(fields);
    if (pending.current?.key !== key)
      pending.current = { key, input: { ...fields, requestId: crypto.randomUUID() } };
    lock.current = true;
    setBusy(true);
    try {
      await manageManualSubscription(pending.current.input);
      onDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to change the plan.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="member-subscription-editor member-subscription-form"
      aria-label="Change plan"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h4>Change plan</h4>
      <fieldset disabled={busy}>
        <label className="member-subscription-field" htmlFor={`${id}-plan`}>
          Plan
          <select
            id={`${id}-plan`}
            required
            value={planId}
            onChange={(event) => setPlanId(event.target.value as PlanId)}
          >
            <option value="" disabled>
              {plans.length ? "Select a plan" : "No active plans available"}
            </option>
            {plans.map((item) => (
              <option key={item.planId} value={item.planId}>
                {item.displayName}
                {noExpiry(item) ? " · no expiry" : ""}
              </option>
            ))}
          </select>
        </label>
        {needsExpiry ? (
          <label className="member-subscription-field" htmlFor={`${id}-expiry`}>
            Expiry date
            <input
              id={`${id}-expiry`}
              type="date"
              required
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </label>
        ) : plan ? (
          <p className="member-subscription-help">
            {plan.planId === "transit-free"
              ? "Transit Free never expires and has no charge."
              : "Pay as you go has no expiry date."}
          </p>
        ) : null}
        <div className="member-subscription-actions">
          <button className="member-record-button" type="submit" disabled={!plan}>
            {busy ? "Saving…" : "Save plan"}
          </button>
          <button className="member-record-link" type="button" onClick={() => onDone(false)}>
            Cancel
          </button>
        </div>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function PlanTab({
  studentId,
  onCurrentMembership,
  onUnavailable,
}: {
  studentId: string;
  onUnavailable: (error: MemberRecordLoadError) => void;
  onCurrentMembership: (current: Current) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([getMemberSubscriptions(studentId), listManagedPlans().catch(() => [])]).then(
      ([context, plans]) => {
        if (!active) return;
        const names = new Map(plans.map((plan) => [plan.planId as string, plan.displayName]));
        const selected = selectCurrentMembership(context.memberships);
        const current: Current = selected
          ? {
              membershipId: selected.membershipId,
              planName: names.get(selected.planId) ?? `Plan name unavailable (${selected.planId})`,
              status: selected.status as NonNullable<Current>["status"],
              validUntil: selected.endsAt?.slice(0, 10) ?? null,
            }
          : null;
        setState({
          status: "ready",
          context,
          names,
          plans: plans.filter((plan) => plan.active),
          current,
        });
        onCurrentMembership(current);
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
  }, [studentId, attempt, onCurrentMembership, onUnavailable]);
  return (
    <section aria-label="Membership history">
      <h3>Plan</h3>
      <div className="member-subscription-actions">
        <button
          className="member-record-link"
          type="button"
          aria-expanded={editing}
          disabled={state.status !== "ready"}
          onClick={() => {
            setSaved(false);
            setEditing((value) => !value);
          }}
        >
          Change Plan
        </button>
        <button
          className="member-record-button"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      {editing && state.status === "ready" ? (
        <ChangePlanForm
          studentId={studentId}
          current={selectCurrentMembership(state.context.memberships)}
          plans={state.plans}
          onDone={(changed) => {
            setEditing(false);
            if (!changed) return;
            setSaved(true);
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      {saved ? <p role="status">Plan saved. The member sees it in My plan.</p> : null}
      {state.status === "loading" ? (
        <div
          className="member-record-skeleton"
          role="status"
          aria-label="Loading membership history"
          aria-busy="true"
        >
          <span />
          <span />
        </div>
      ) : null}
      {state.status === "error" ? (
        <p className="member-record-notice" role="alert">
          Unable to load membership history. Refresh to try again; extensive history may require
          office support.
        </p>
      ) : null}
      {state.status === "ready" && state.context.memberships.length === 0 ? (
        <p role="status">No membership recorded yet. This live record has no membership history.</p>
      ) : null}
      {state.status === "ready" && state.context.memberships.length > 0 ? (
        <>
          <p role="status">
            {state.current ? `Current plan: ${state.current.planName}` : "No current membership"}
          </p>
          <ul className="member-live-records">
            {state.context.memberships.map((membership) => (
              <li key={membership.membershipId}>
                <h4>
                  {state.names.get(membership.planId) ??
                    `Plan name unavailable (${membership.planId})`}
                </h4>
                <dl className="member-record-facts">
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {membership.status.charAt(0).toUpperCase() + membership.status.slice(1)}
                    </dd>
                  </div>
                  <div>
                    <dt>Starts</dt>
                    <dd>{date(membership.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>Ends</dt>
                    <dd>{membership.endsAt ? date(membership.endsAt) : "No end date"}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p>Earlier membership history may still be in the imported archive.</p>
    </section>
  );
}
