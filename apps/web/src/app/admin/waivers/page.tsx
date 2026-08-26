"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { WaiverClauseKey, WaiverVersionProjection } from "@bpt-jersey/domain/consents";
import {
  getCurrentWaiverAdmin,
  publishWaiverVersion,
  withdrawCurrentWaiver,
} from "../../../lib/waiver-client";
import "../../account/waiver/waiver.css";

type ClauseDraft = { key: WaiverClauseKey; heading: string; body: string; required: boolean };
const initialClauses: ClauseDraft[] = [
  { key: "photoVideo", heading: "Photo and video", body: "", required: false },
  { key: "medicalTreatment", heading: "Medical treatment", body: "", required: false },
  { key: "hygiene", heading: "Hygiene", body: "", required: false },
  { key: "dataProtection", heading: "Data protection", body: "", required: false },
];

export default function AdminWaiversPage() {
  const [current, setCurrent] = useState<WaiverVersionProjection | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [versionLabel, setVersionLabel] = useState("");
  const [title, setTitle] = useState("");
  const [introduction, setIntroduction] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [clauses, setClauses] = useState<ClauseDraft[]>(initialClauses);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const versionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void getCurrentWaiverAdmin()
      .then((value) => {
        if (active) {
          setCurrent(value);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  function updateClause(index: number, patch: Partial<ClauseDraft>): void {
    setClauses((value) =>
      value.map((clause, currentIndex) =>
        currentIndex === index ? { ...clause, ...patch } : clause,
      ),
    );
    setError("");
    setMessage("");
  }

  async function publish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !versionLabel.trim() ||
      !title.trim() ||
      !introduction.trim() ||
      !effectiveAt ||
      !reviewConfirmed ||
      clauses.some((clause) => !clause.body.trim())
    ) {
      setError("Complete the version, effective time and wording for all four clauses.");
      versionRef.current?.focus();
      return;
    }
    const effectiveDate = new Date(effectiveAt);
    if (Number.isNaN(effectiveDate.getTime())) {
      setError("Enter a valid effective date and time.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await publishWaiverVersion({
        versionLabel: versionLabel.trim(),
        title: title.trim(),
        introduction: introduction.trim(),
        effectiveAt: effectiveDate.toISOString(),
        clauses: clauses.map((clause) => ({ ...clause, body: clause.body.trim() })),
        confirmReviewed: true,
      });
      setCurrent(next);
      setMessage("Waiver version published.");
    } catch {
      setError("Unable to publish the waiver version. Review the fields and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(): Promise<void> {
    if (!current) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await withdrawCurrentWaiver(current.waiverVersionId);
      setCurrent(null);
      setMessage("Current waiver withdrawn without deleting history.");
    } catch {
      setError("Unable to withdraw the current waiver. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="waiver-admin" aria-labelledby="waiver-admin-title">
      <header className="waiver-admin-header">
        <p className="admin-page-eyebrow">Registration governance</p>
        <h2 id="waiver-admin-title">Waiver versions</h2>
        <p>
          Publish one immutable current version. Revisions supersede prior text; withdrawal retains
          the full history.
        </p>
      </header>

      <div className="waiver-legal-warning" role="note">
        <strong>No legal wording is bundled.</strong>
        <p>
          Paste only operator-approved text. This pilot screen does not provide legal advice or
          activate production consent.
        </p>
      </div>

      {loadState === "loading" ? <p aria-live="polite">Loading current waiver...</p> : null}
      {loadState === "error" ? (
        <p className="waiver-message waiver-message-error" role="alert">
          Unable to load the current waiver. Please try again.
        </p>
      ) : null}
      {loadState === "ready" ? (
        <div className="waiver-admin-grid">
          <section className="waiver-current-card" aria-labelledby="current-waiver-title">
            <p className="account-eyebrow">Current publication</p>
            <h3 id="current-waiver-title">{current ? current.title : "No published waiver"}</h3>
            {current ? (
              <>
                <p className="waiver-version">{current.versionLabel}</p>
                <p>Effective {new Date(current.effectiveAt).toLocaleString("en-GB")}</p>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void withdraw()}
                  type="button"
                >
                  Withdraw current version
                </button>
              </>
            ) : (
              <p>Client registration remains closed until a reviewed version is published.</p>
            )}
          </section>

          <form
            className="waiver-publish-form"
            noValidate
            onSubmit={(event) => void publish(event)}
          >
            <div className="waiver-form-heading">
              <p className="account-eyebrow">New immutable version</p>
              <h3>Publish reviewed wording</h3>
            </div>
            <div className="waiver-admin-fields">
              <label>
                Version label
                <input
                  aria-describedby={error ? "waiver-admin-error" : undefined}
                  aria-invalid={error && !versionLabel.trim() ? "true" : "false"}
                  autoComplete="off"
                  onChange={(event) => {
                    setVersionLabel(event.target.value);
                    setError("");
                  }}
                  ref={versionRef}
                  value={versionLabel}
                />
              </label>
              <label>
                Effective date and time
                <input
                  aria-describedby={error ? "waiver-admin-error" : undefined}
                  aria-invalid={error && !effectiveAt ? "true" : "false"}
                  onChange={(event) => {
                    setEffectiveAt(event.target.value);
                    setError("");
                  }}
                  type="datetime-local"
                  value={effectiveAt}
                />
              </label>
              <label className="waiver-admin-wide">
                Waiver title
                <input
                  aria-describedby={error ? "waiver-admin-error" : undefined}
                  aria-invalid={error && !title.trim() ? "true" : "false"}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setError("");
                  }}
                  value={title}
                />
              </label>
              <label className="waiver-admin-wide">
                Introduction
                <textarea
                  aria-describedby={error ? "waiver-admin-error" : undefined}
                  aria-invalid={error && !introduction.trim() ? "true" : "false"}
                  onChange={(event) => {
                    setIntroduction(event.target.value);
                    setError("");
                  }}
                  rows={4}
                  value={introduction}
                />
              </label>
            </div>
            <div className="waiver-admin-clauses">
              {clauses.map((clause, index) => (
                <fieldset key={clause.key}>
                  <legend>{clause.heading}</legend>
                  <label>
                    {clause.heading} wording
                    <textarea
                      aria-describedby={error ? "waiver-admin-error" : undefined}
                      aria-invalid={error && !clause.body.trim() ? "true" : "false"}
                      onChange={(event) => updateClause(index, { body: event.target.value })}
                      rows={6}
                      value={clause.body}
                    />
                  </label>
                  <label className="waiver-required-toggle">
                    <input
                      checked={clause.required}
                      onChange={(event) => updateClause(index, { required: event.target.checked })}
                      type="checkbox"
                    />{" "}
                    {clause.heading} is required
                  </label>
                </fieldset>
              ))}
            </div>
            <label className="waiver-review-confirmation">
              <input
                aria-describedby={error ? "waiver-admin-error" : undefined}
                checked={reviewConfirmed}
                onChange={(event) => {
                  setReviewConfirmed(event.target.checked);
                  setError("");
                }}
                type="checkbox"
              />{" "}
              I confirm this wording is approved for the synthetic pilot
            </label>
            {error ? (
              <p
                className="waiver-message waiver-message-error"
                id="waiver-admin-error"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="waiver-message waiver-message-success" role="status">
                {message}
              </p>
            ) : null}
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? "Publishing..." : "Publish immutable version"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
