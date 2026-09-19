"use client";

import Link from "next/link";
import { selectCurrentMembership } from "@bpt-jersey/domain/memberships/lifecycle";
import { useEffect, useState } from "react";
import type { MemberSubscriptionContext } from "@bpt-jersey/domain/memberships/admin";
import type { MemberProfileCards } from "@bpt-jersey/domain/members/profile";
import { getMemberSubscriptions } from "../../../../lib/subscription-admin-client";
import { listManagedPlans } from "../../../../lib/membership-admin-client";

type Current = MemberProfileCards["currentMembership"];
type State =
  | { status: "loading" | "error" }
  | {
      status: "ready";
      context: MemberSubscriptionContext;
      names: Map<string, string>;
      current: Current;
    };
const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Jersey" }).format(
    new Date(value),
  );

export function PlanTab({
  studentId,
  onCurrentMembership,
}: {
  studentId: string;
  onCurrentMembership: (current: Current) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
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
        setState({ status: "ready", context, names, current });
        onCurrentMembership(current);
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, attempt, onCurrentMembership]);
  return (
    <section aria-label="Membership history">
      <h3>Plan</h3>
      <div className="member-subscription-actions">
        <Link
          className="member-record-link"
          href={`/admin/memberships?${new URLSearchParams({ studentId })}`}
        >
          Open Memberships
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
