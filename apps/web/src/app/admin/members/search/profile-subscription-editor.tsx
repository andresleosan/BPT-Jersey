"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import type { OfficeMemberRegistration } from "@bpt-jersey/domain/memberships/admin";
import {
  registerImportedMember,
  resolveImportedSubscription,
} from "../../../../lib/subscription-admin-client";
import {
  MemberSubscriptionEditor,
  MemberSubscriptionPayments,
} from "../member-subscription-editor";

type LookupState =
  | { status: "loading" }
  | { status: "matched"; studentId: string }
  | { status: "missing" }
  | { status: "error"; message: string };

function OfficeRegistration({
  record,
  onRegistered,
}: {
  record: RegyfitMemberRecord;
  onRegistered: (studentId: string) => void;
}) {
  const id = useId();
  const [birthDate, setBirthDate] = useState(record.birthDate ?? "");
  const [centre, setCentre] = useState<"Town" | "West" | "">("");
  const [time, setTime] = useState<"morning" | "afternoon" | "evening" | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; input: OfficeMemberRegistration } | null>(null);
  const lock = useRef(false);
  async function register() {
    if (lock.current || !centre || !time || !birthDate) return;
    const fields = {
      recordId: record.recordId,
      dateOfBirth: birthDate,
      trainingCenter: centre,
      trainingTimePreferences: [time],
    };
    const key = JSON.stringify(fields);
    if (pending.current?.key !== key)
      pending.current = { key, input: { ...fields, requestId: crypto.randomUUID() } };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await registerImportedMember(pending.current.input);
      onRegistered(result.studentId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to register this member.");
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
        void register();
      }}
    >
      <p>
        This imported member has no current subscription record. Confirm their details to register
        them for manual membership and payments.
      </p>
      <fieldset disabled={busy}>
        <label className="member-subscription-field" htmlFor={`${id}-dob`}>
          Date of birth
          <input
            id={`${id}-dob`}
            type="date"
            value={birthDate}
            readOnly={Boolean(record.birthDate)}
            required
            onChange={(event) => setBirthDate(event.target.value)}
          />
        </label>
        <div className="member-subscription-grid">
          <label className="member-subscription-field" htmlFor={`${id}-centre`}>
            Training centre
            <select
              id={`${id}-centre`}
              value={centre}
              required
              onChange={(event) => setCentre(event.target.value as typeof centre)}
            >
              <option value="" disabled>
                Select centre
              </option>
              <option>Town</option>
              <option>West</option>
            </select>
          </label>
          <label className="member-subscription-field" htmlFor={`${id}-time`}>
            Preferred training time
            <select
              id={`${id}-time`}
              value={time}
              required
              onChange={(event) => setTime(event.target.value as typeof time)}
            >
              <option value="" disabled>
                Select time
              </option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
        </div>
        <div className="member-subscription-actions">
          <button className="admin-auth-button" type="submit">
            {busy ? "Registering…" : "Register member and choose subscription"}
          </button>
        </div>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

/** Resolve by the stored source link or exact member number; never by name. */
export function ProfileSubscriptionEditor({
  record,
  paymentsOnly = false,
  role,
}: {
  record: RegyfitMemberRecord;
  paymentsOnly?: boolean;
  /** D13: forwarded to MemberSubscriptionEditor so only an owner actor can assign Transit Free. */
  role?: string | null | undefined;
}) {
  const [state, setState] = useState<LookupState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void resolveImportedSubscription(record.recordId).then(
      (result) => {
        if (active)
          setState(
            result.studentId
              ? { status: "matched", studentId: result.studentId }
              : { status: "missing" },
          );
      },
      (failure) => {
        if (active)
          setState({
            status: "error",
            message:
              failure instanceof Error
                ? failure.message
                : "Unable to load this member's subscription.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [record.recordId, attempt]);
  if (state.status === "matched")
    return paymentsOnly ? (
      <MemberSubscriptionPayments key={state.studentId} studentId={state.studentId} />
    ) : (
      <MemberSubscriptionEditor
        key={state.studentId}
        studentId={state.studentId}
        previousRecord={record}
        role={role}
      />
    );
  return (
    <section
      className="member-subscription-editor"
      aria-label={paymentsOnly ? "Current payment history" : "Current subscription"}
    >
      <h3>{paymentsOnly ? "Recorded payments" : "Current subscription"}</h3>
      {state.status === "loading" ? (
        <p role="status">Loading member record…</p>
      ) : state.status === "missing" ? (
        paymentsOnly ? (
          <p>
            No current billing record. Open Membership to register this member and record a payment.
          </p>
        ) : (
          <OfficeRegistration
            record={record}
            onRegistered={(studentId) => setState({ status: "matched", studentId })}
          />
        )
      ) : (
        <>
          <p role="alert">{state.message}</p>
          <button
            className="admin-auth-button"
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Retry loading member
          </button>
        </>
      )}
    </section>
  );
}
