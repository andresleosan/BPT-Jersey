"use client";

import { useEffect, useState } from "react";

import { lookupMemberIdentity } from "../../../../lib/members-client";
import { MemberSubscriptionEditor } from "../member-subscription-editor";

type LookupState =
  | { status: "loading" }
  | { status: "matched"; studentId: string }
  | { status: "missing" }
  | { status: "error" };

/** Resolve the selected profile by its exact member number, never by name. */
export function ProfileSubscriptionEditor({ memberNumber }: { memberNumber: string | undefined }) {
  const [state, setState] = useState<LookupState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!memberNumber?.trim()) return;
    void lookupMemberIdentity("membership-number", memberNumber).then(
      (result) => {
        if (active) {
          setState(
            result.matched
              ? { status: "matched", studentId: result.row.studentId }
              : { status: "missing" },
          );
        }
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [memberNumber, attempt]);

  if (memberNumber?.trim() && state.status === "matched") {
    return <MemberSubscriptionEditor key={state.studentId} studentId={state.studentId} />;
  }

  return (
    <section className="member-subscription-editor" aria-label="Current subscription">
      <h3>Current subscription</h3>
      {!memberNumber?.trim() ? (
        <p>
          This profile has no member number. Link it to a member record before editing a
          subscription.
        </p>
      ) : state.status === "loading" ? (
        <p role="status">Loading this member&apos;s subscription…</p>
      ) : state.status === "missing" ? (
        <p>
          No linked member record was found for this member number. Link this imported profile to
          the member directory before editing its subscription.
        </p>
      ) : (
        <p role="alert">Unable to load this member&apos;s subscription. Please try again.</p>
      )}
      {memberNumber?.trim() && state.status !== "loading" ? (
        <button
          className="admin-auth-button"
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Retry loading subscription
        </button>
      ) : null}
    </section>
  );
}
