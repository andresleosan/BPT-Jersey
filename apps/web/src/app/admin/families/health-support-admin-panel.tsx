"use client";

import { useState, type FormEvent } from "react";

import {
  getHealthAdminProfile,
  reviewHealthProfileChangeRequest,
  saveHealthProfile,
  type HealthProfileAdminProjection,
  type MinimumOperationalSupportCode,
} from "../../../lib/health-client";

type HealthSupportAdminPanelProps = Readonly<{
  instanceId: string;
  studentId: string;
  studentName: string;
}>;

const supportOptions: readonly Readonly<{ value: MinimumOperationalSupportCode; label: string }>[] =
  [
    { value: "none", label: "No additional support" },
    { value: "mobility", label: "Mobility support" },
    { value: "sensory", label: "Sensory support" },
    { value: "communication", label: "Communication support" },
    { value: "supervision", label: "Additional supervision" },
  ];

function supportLabel(code: MinimumOperationalSupportCode): string {
  return supportOptions.find((option) => option.value === code)?.label ?? "Support recorded";
}

function dateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function dateTimestamp(value: string): string | null {
  return value ? value + "T23:59:59.000Z" : null;
}

export function HealthSupportAdminPanel({
  instanceId,
  studentId,
  studentName,
}: HealthSupportAdminPanelProps) {
  const [profile, setProfile] = useState<HealthProfileAdminProjection | undefined>();
  const [opened, setOpened] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [support, setSupport] = useState<readonly MinimumOperationalSupportCode[]>(["none"]);
  const [summary, setSummary] = useState("");
  const [staffLabel, setStaffLabel] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadProfile(): Promise<void> {
    setOpened(true);
    setLoadState("loading");
    setError("");
    try {
      const result = await getHealthAdminProfile(studentId);
      setProfile(result);
      if (result) {
        setSupport(result.minimumOperationalSupport);
        setSummary(result.conditionSummary ?? "");
        setStaffLabel(result.staffReferenceLabel ?? "");
        setExpiresOn(dateInputValue(result.expiresAt));
      }
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setError("Unable to load health support. Please try again.");
    }
  }

  function openForm(): void {
    setSupport(profile?.minimumOperationalSupport ?? ["none"]);
    setSummary(profile?.conditionSummary ?? "");
    setStaffLabel(profile?.staffReferenceLabel ?? "");
    setExpiresOn(dateInputValue(profile?.expiresAt ?? null));
    setMessage("");
    setError("");
    setFormOpen(true);
  }

  function toggleSupport(value: MinimumOperationalSupportCode): void {
    setSupport((current) => {
      if (value === "none") return ["none"];
      const withoutNone = current.filter((code) => code !== "none");
      return withoutNone.includes(value)
        ? withoutNone.filter((code) => code !== value)
        : [...withoutNone, value];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (support.length === 0) {
      setError("Choose at least one support option.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await saveHealthProfile({
        studentId,
        minimumOperationalSupport: support,
        conditionSummary: summary,
        staffReferenceLabel: staffLabel,
        expiresAt: dateTimestamp(expiresOn),
      });
      setProfile(result);
      setFormOpen(false);
      setMessage("Health support saved.");
    } catch {
      setError("Unable to save health support. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject"): Promise<void> {
    const requestId = profile?.pendingChangeRequest?.requestId;
    if (!requestId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await reviewHealthProfileChangeRequest(requestId, decision);
      const refreshed = await getHealthAdminProfile(studentId);
      setProfile(refreshed);
      setMessage(
        decision === "approve"
          ? "The requested change was approved."
          : "The requested change was rejected.",
      );
    } catch {
      setError("Unable to review the health support request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="health-admin-panel" aria-labelledby={instanceId}>
      <div className="health-admin-heading">
        <div>
          <p className="admin-eyebrow">Restricted support</p>
          <h4 id={instanceId}>{studentName}</h4>
        </div>
        {!opened && (
          <button className="family-text-button" onClick={() => void loadProfile()} type="button">
            Open support review
          </button>
        )}
      </div>

      {loadState === "loading" && (
        <p className="health-admin-muted" aria-busy="true">
          Loading support details...
        </p>
      )}
      {loadState === "error" && (
        <p className="family-message family-message-error" role="alert">
          {error}
        </p>
      )}
      {opened && loadState === "ready" && !profile && (
        <>
          <p className="health-admin-muted">
            No support profile has been recorded for this student.
          </p>
          {!formOpen && (
            <button className="admin-auth-button" onClick={openForm} type="button">
              Add support profile
            </button>
          )}
        </>
      )}
      {profile && (
        <>
          <div className="health-admin-summary">
            <div>
              <span>Support</span>
              <strong>{profile.minimumOperationalSupport.map(supportLabel).join(", ")}</strong>
            </div>
            <div>
              <span>Staff reference</span>
              <strong>{profile.staffReferenceLabel ?? "None"}</strong>
            </div>
            <div>
              <span>Review state</span>
              <strong>{profile.reviewState.replace("-", " ")}</strong>
            </div>
          </div>
          {profile.conditionSummary && (
            <p className="health-admin-note">{profile.conditionSummary}</p>
          )}
          {profile.pendingChangeRequest && (
            <div className="health-admin-pending">
              <p className="admin-eyebrow">Pending guardian request</p>
              <ul>
                {profile.pendingChangeRequest.proposedMinimumOperationalSupport.map((code) => (
                  <li key={code}>{supportLabel(code)}</li>
                ))}
              </ul>
              {profile.pendingChangeRequest.proposedConditionSummary && (
                <p>{profile.pendingChangeRequest.proposedConditionSummary}</p>
              )}
              <div className="health-admin-actions">
                <button
                  className="admin-auth-button"
                  disabled={busy}
                  onClick={() => void decide("approve")}
                  type="button"
                >
                  Approve request
                </button>
                <button
                  className="family-text-button"
                  disabled={busy}
                  onClick={() => void decide("reject")}
                  type="button"
                >
                  Reject request
                </button>
              </div>
            </div>
          )}
          {!formOpen && (
            <button className="family-text-button" onClick={openForm} type="button">
              Edit support profile
            </button>
          )}
        </>
      )}
      {formOpen && (
        <form className="health-admin-form" onSubmit={(event) => void submit(event)}>
          <fieldset>
            <legend>Minimum operational support</legend>
            <div className="health-admin-options">
              {supportOptions.map((option) => (
                <label key={option.value}>
                  <input
                    checked={support.includes(option.value)}
                    onChange={() => toggleSupport(option.value)}
                    type="checkbox"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="family-field" htmlFor={instanceId + "-summary"}>
            Context for staff
            <textarea
              id={instanceId + "-summary"}
              maxLength={1000}
              onChange={(event) => setSummary(event.target.value)}
              value={summary}
            />
          </label>
          <label className="family-field" htmlFor={instanceId + "-staff"}>
            Staff reference label
            <input
              id={instanceId + "-staff"}
              maxLength={25}
              onChange={(event) => setStaffLabel(event.target.value)}
              value={staffLabel}
            />
          </label>
          <label className="family-field" htmlFor={instanceId + "-expiry"}>
            Review date
            <input
              id={instanceId + "-expiry"}
              onChange={(event) => setExpiresOn(event.target.value)}
              type="date"
              value={expiresOn}
            />
          </label>
          {error && (
            <p className="family-message family-message-error" role="alert">
              {error}
            </p>
          )}
          <div className="health-admin-actions">
            <button className="admin-auth-button" disabled={busy} type="submit">
              {busy ? "Saving..." : "Save support profile"}
            </button>
            <button
              className="family-text-button"
              disabled={busy}
              onClick={() => setFormOpen(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && (
        <p className="family-message family-message-success" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
