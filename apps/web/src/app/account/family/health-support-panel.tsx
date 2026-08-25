"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  cancelHealthProfileChangeRequest,
  createHealthProfileChangeRequest,
  getHealthProfile,
  type HealthProfileRedactedProjection,
  type HealthSupportRequestState,
  type MinimumOperationalSupportCode,
} from "../../../lib/health-client";

type HealthSupportPanelProps = Readonly<{
  studentId: string;
  studentName: string;
  instanceId: string;
}>;

const supportOptions: readonly Readonly<{ value: MinimumOperationalSupportCode; label: string }>[] =
  [
    { value: "none", label: "No additional support" },
    { value: "mobility", label: "Mobility support" },
    { value: "sensory", label: "Sensory support" },
    { value: "communication", label: "Communication support" },
    { value: "supervision", label: "Additional supervision" },
  ];

function readableSupport(code: MinimumOperationalSupportCode): string {
  return supportOptions.find((option) => option.value === code)?.label ?? "Support recorded";
}

function toDateLabel(value: string | null): string {
  if (!value) return "No review date set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Review date recorded"
    : "Review by " + date.toLocaleDateString("en-GB");
}

export function HealthSupportPanel({
  studentId,
  studentName,
  instanceId,
}: HealthSupportPanelProps) {
  const [profile, setProfile] = useState<HealthProfileRedactedProjection | undefined>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [requestState, setRequestState] = useState<HealthSupportRequestState | undefined>();
  const [requestId, setRequestId] = useState<string | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [support, setSupport] = useState<readonly MinimumOperationalSupportCode[]>([]);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void getHealthProfile(studentId)
      .then((result) => {
        if (!active) return;
        setProfile(result);
        setLoadState("ready");
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [studentId]);

  function openRequestForm() {
    if (!profile) return;
    setSupport(profile.minimumOperationalSupport);
    setSummary(profile.conditionSummary ?? "");
    setMessage(undefined);
    setError(undefined);
    setFormOpen(true);
  }

  function toggleSupport(value: MinimumOperationalSupportCode) {
    setSupport((current) => {
      if (value === "none") return ["none"];
      const withoutNone = current.filter((code) => code !== "none");
      return withoutNone.includes(value)
        ? withoutNone.filter((code) => code !== value)
        : [...withoutNone, value];
    });
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || support.length === 0) {
      setError("Choose at least one support option.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const request = await createHealthProfileChangeRequest({
        studentId,
        proposedMinimumOperationalSupport: support,
        proposedConditionSummary: summary,
        proposedExpiresAt: profile.expiresAt,
      });
      setRequestId(request.requestId);
      setRequestState(request.status);
      setFormOpen(false);
      setMessage("Your request was sent to the academy team for review.");
    } catch {
      setError("Unable to submit the health support request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (!requestId) return;
    setBusy(true);
    setError(undefined);
    try {
      const request = await cancelHealthProfileChangeRequest(requestId);
      setRequestState(request.status);
      setMessage("The pending request was cancelled.");
      setRequestId(undefined);
    } catch {
      setError("Unable to cancel the health support request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="health-support-panel" aria-labelledby={instanceId}>
      <div className="health-support-heading">
        <div>
          <p className="account-eyebrow">Minimum operational support</p>
          <h4 id={instanceId}>Support for {studentName}</h4>
        </div>
        {profile && (
          <span className={"health-support-status health-support-status-" + profile.reviewState}>
            {profile.reviewState.replace("-", " ")}
          </span>
        )}
      </div>

      {loadState === "loading" && (
        <p className="health-support-muted" aria-busy="true">
          Loading support details…
        </p>
      )}
      {loadState === "error" && (
        <p className="health-support-message health-support-message-error" role="alert">
          Unable to load support details.
        </p>
      )}
      {loadState === "ready" && !profile && (
        <p className="health-support-muted">No support profile has been recorded.</p>
      )}
      {profile && (
        <>
          <ul className="health-support-list">
            {profile.minimumOperationalSupport.map((code) => (
              <li key={code}>{readableSupport(code)}</li>
            ))}
          </ul>
          {profile.conditionSummary && (
            <p className="health-support-summary">{profile.conditionSummary}</p>
          )}
          <p className="health-support-review">{toDateLabel(profile.expiresAt)}</p>

          {requestState === "pending" && (
            <div className="health-support-pending">
              <p role="status">A change request is awaiting academy review.</p>
              <button
                className="health-support-secondary"
                disabled={busy}
                onClick={() => void cancelRequest()}
                type="button"
              >
                Cancel request
              </button>
            </div>
          )}
          {requestState !== "pending" && !formOpen && (
            <button
              className="health-support-primary"
              disabled={busy}
              onClick={openRequestForm}
              type="button"
            >
              Request a change
            </button>
          )}
          {formOpen && (
            <form className="health-support-form" onSubmit={(event) => void submitRequest(event)}>
              <fieldset>
                <legend>What support should the academy review?</legend>
                <div className="health-support-options">
                  {supportOptions.map((option) => (
                    <label className="health-support-option" key={option.value}>
                      <input
                        checked={support.includes(option.value)}
                        onChange={() => toggleSupport(option.value)}
                        type="checkbox"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="health-support-field" htmlFor={instanceId + "-summary"}>
                <span>Context for the academy team (optional)</span>
                <textarea
                  id={instanceId + "-summary"}
                  maxLength={1000}
                  onChange={(event) => setSummary(event.target.value)}
                  value={summary}
                />
              </label>
              {error && (
                <p className="health-support-message health-support-message-error" role="alert">
                  {error}
                </p>
              )}
              <div className="health-support-actions">
                <button className="health-support-primary" disabled={busy} type="submit">
                  {busy ? "Sending…" : "Send for review"}
                </button>
                <button
                  className="health-support-secondary"
                  disabled={busy}
                  onClick={() => setFormOpen(false)}
                  type="button"
                >
                  Keep current details
                </button>
              </div>
            </form>
          )}
          {message && (
            <p className="health-support-message health-support-message-success" role="status">
              {message}
            </p>
          )}
          {error && !formOpen && (
            <p className="health-support-message health-support-message-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
