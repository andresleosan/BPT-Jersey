"use client";

import { useRef, useState, type FormEvent } from "react";

import { useClientSession } from "../../../lib/client-auth";
import {
  FamilyPlanUnavailableError,
  requestMemberPlanPerson,
} from "../../../lib/family-plan-client";

const centreOptions = ["Town", "West"] as const;
const timeOptions = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
] as const;

type Kind = "child" | "self";
type Time = (typeof timeOptions)[number]["value"];

/**
 * "Add a child" and "Train yourself": both send a request the office confirms (plan task 2.3).
 * Nothing is created here. The whole block hides itself if its callable is not deployed.
 */
export function PlanPersonRequests({ canTrainYourself }: Readonly<{ canTrainYourself: boolean }>) {
  const { session } = useClientSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const [hidden, setHidden] = useState(false);
  const [kind, setKind] = useState<Kind>("child");
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [centre, setCentre] = useState<(typeof centreOptions)[number]>("Town");
  const [times, setTimes] = useState<Time[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();

  if (hidden) return null;

  function open(next: Kind): void {
    setKind(next);
    setFullName("");
    setDateOfBirth("");
    setCentre("Town");
    setTimes([]);
    setNotice(undefined);
    dialog.current?.showModal();
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if ((kind === "child" && fullName.trim().length < 2) || !dateOfBirth || times.length === 0) {
      setNotice({ kind: "error", text: "Add every detail and at least one training time." });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      await requestMemberPlanPerson({
        kind,
        // The server takes the account holder's own name for "Train yourself".
        fullName:
          kind === "child" ? fullName.trim() : session?.displayName?.trim() || "Account holder",
        dateOfBirth,
        trainingCenter: centre,
        trainingTimePreferences: times,
      });
      dialog.current?.close();
      setNotice({ kind: "success", text: "Request sent. The office will confirm it shortly." });
    } catch (error) {
      if (error instanceof FamilyPlanUnavailableError) {
        dialog.current?.close();
        setHidden(true);
        return;
      }
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "We couldn't send your request. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="client-plan-people" aria-labelledby="plan-people-title">
      <h2 id="plan-people-title">Add someone</h2>
      <div className="client-plan-people-actions">
        <button className="client-plan-people-card" onClick={() => open("child")} type="button">
          <strong>Add a child</strong>
          <span>Ask the office to add a child under 18 to your account.</span>
        </button>
        {canTrainYourself ? (
          <button className="client-plan-people-card" onClick={() => open("self")} type="button">
            <strong>Train yourself</strong>
            <span>Ask the office to add you as a member on this account.</span>
          </button>
        ) : null}
      </div>
      {/* Mounted empty so the confirmation is announced when it arrives. */}
      <p className="client-membership-notice client-membership-notice-success" role="status">
        {notice?.kind === "success" ? notice.text : ""}
      </p>

      <dialog
        aria-labelledby="plan-people-form-title"
        className="client-plan-people-dialog"
        ref={dialog}
      >
        <form className="client-plan-people-form" onSubmit={(event) => void submit(event)}>
          <h2 id="plan-people-form-title">{kind === "child" ? "Add a child" : "Train yourself"}</h2>
          {kind === "child" ? (
            <>
              <label htmlFor="plan-person-name">Full name</label>
              <input
                autoComplete="off"
                id="plan-person-name"
                maxLength={160}
                onChange={(event) => setFullName(event.target.value)}
                value={fullName}
              />
            </>
          ) : null}
          <label htmlFor="plan-person-dob">Date of birth</label>
          <input
            id="plan-person-dob"
            onChange={(event) => setDateOfBirth(event.target.value)}
            type="date"
            value={dateOfBirth}
          />
          <label htmlFor="plan-person-centre">Centre</label>
          <select
            id="plan-person-centre"
            onChange={(event) => setCentre(event.target.value as (typeof centreOptions)[number])}
            value={centre}
          >
            {centreOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <fieldset className="client-plan-people-times">
            <legend>Training times</legend>
            {timeOptions.map((option) => (
              <label htmlFor={`plan-person-${option.value}`} key={option.value}>
                <input
                  checked={times.includes(option.value)}
                  id={`plan-person-${option.value}`}
                  onChange={() =>
                    setTimes((current) =>
                      current.includes(option.value)
                        ? current.filter((item) => item !== option.value)
                        : [...current, option.value],
                    )
                  }
                  type="checkbox"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          {notice?.kind === "error" ? (
            <p className="client-membership-notice client-membership-notice-error" role="alert">
              {notice.text}
            </p>
          ) : null}
          <div className="client-plan-people-buttons">
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? "Sending..." : "Send request"}
            </button>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => dialog.current?.close()}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
