"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  ClauseResponses,
  ConsentProjection,
  WaiverClauseKey,
  WaiverRegistrationProjection,
} from "@bpt-jersey/domain/consents";
import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";
import {
  acceptWaiver,
  getWaiverEvidenceDownload,
  getWaiverRegistration,
  revokeWaiverConsent,
} from "../../../lib/waiver-client";
import "./waiver.css";

const officialWaiverDocumentUrl =
  "/legal/Brazilian%20Power%20Team%20Jersey%20Waiver%20and%20Release%20of%20Liability.pdf";

type DecisionDraft = Partial<Record<WaiverClauseKey, "accepted" | "declined">>;

function WaiverContent() {
  const [registration, setRegistration] = useState<WaiverRegistrationProjection>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [decisions, setDecisions] = useState<DecisionDraft>({});
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const firstDecisionRef = useRef<HTMLInputElement>(null);
  const typedNameRef = useRef<HTMLInputElement>(null);
  const [officialDocumentReviewed, setOfficialDocumentReviewed] = useState(false);

  useEffect(() => {
    let active = true;
    void getWaiverRegistration()
      .then((value) => {
        if (!active) return;
        setRegistration(value);
        setSelectedStudentId(value.subjects[0]?.studentId ?? "");
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const currentVersion = registration?.currentVersion ?? null;
  const subject = registration?.subjects.find(
    (candidate) => candidate.studentId === selectedStudentId,
  );
  const consent = subject?.consent ?? null;

  function updateConsent(next: ConsentProjection): void {
    setRegistration((current) =>
      current
        ? {
            ...current,
            subjects: current.subjects.map((candidate) =>
              candidate.studentId === next.studentId ? { ...candidate, consent: next } : candidate,
            ),
          }
        : current,
    );
  }
  function selectSubject(studentId: string): void {
    setOfficialDocumentReviewed(false);
    setSelectedStudentId(studentId);
    setDecisions({});
    setTypedName("");
    setMessage("");
    setError("");
    setEvidenceUrl("");
  }
  function setDecision(key: WaiverClauseKey, value: "accepted" | "declined"): void {
    setDecisions((current) => ({ ...current, [key]: value }));
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!currentVersion || !subject) return;
    const missing = currentVersion.clauses.find((clause) => decisions[clause.key] === undefined);
    if (missing) {
      setError("Complete all clause decisions before accepting the waiver.");
      firstDecisionRef.current?.focus();
      return;
    }
    const declinedRequired = currentVersion.clauses.find(
      (clause) => clause.required && decisions[clause.key] !== "accepted",
    );
    if (declinedRequired) {
      setError(`${declinedRequired.heading} must be accepted for this waiver version.`);
      document.getElementById(`waiver-${declinedRequired.key}-accept`)?.focus();
      return;
    }
    if (!officialDocumentReviewed) {
      setError("Confirm that you have read the official waiver document.");
      document.getElementById("official-waiver-reviewed")?.focus();
      return;
    }
    if (!typedName.trim()) {
      setError("Type your full name to confirm the authenticated acceptance.");
      typedNameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await acceptWaiver({
        studentId: subject.studentId,
        waiverVersionId: currentVersion.waiverVersionId,
        contentHash: currentVersion.contentHash,
        typedName: typedName.trim(),
        clauseResponses: decisions as ClauseResponses,
      });
      updateConsent(next);
      setMessage("Acceptance recorded.");
    } catch {
      setError("Unable to update waiver registration. Please review the version and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareDownload(): Promise<void> {
    if (!consent) return;
    setBusy(true);
    setError("");
    setEvidenceUrl("");
    try {
      setEvidenceUrl((await getWaiverEvidenceDownload(consent.consentId)).downloadUrl);
    } catch {
      setError("Unable to open waiver evidence. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(): Promise<void> {
    if (!consent) return;
    setBusy(true);
    setError("");
    setMessage("");
    setEvidenceUrl("");
    try {
      updateConsent(await revokeWaiverConsent(consent.consentId));
      setMessage("Acceptance revocation recorded.");
    } catch {
      setError("Unable to revoke this acceptance. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "loading")
    return (
      <main className="waiver-page" aria-busy="true">
        <p className="account-eyebrow">BPT Jersey / Waiver</p>
        <h1>Loading waiver registration</h1>
      </main>
    );
  if (loadState === "error")
    return (
      <main className="waiver-page" aria-labelledby="waiver-title">
        <p className="account-eyebrow">BPT Jersey / Waiver</p>
        <h1 id="waiver-title">Waiver registration</h1>
        <p className="waiver-message waiver-message-error" role="alert">
          Unable to load waiver registration. Please try again.
        </p>
      </main>
    );

  return (
    <main className="waiver-page" id="main-content" aria-labelledby="waiver-title">
      <header className="waiver-hero">
        <a href="/account" className="waiver-back-link">
          <span aria-hidden="true">&larr;</span> Back to account
        </a>
        <p className="account-eyebrow">BPT Jersey / Registration evidence</p>
        <h1 id="waiver-title">Waiver registration</h1>
        <p>
          Review the current text, make every clause decision and create a private signed evidence
          PDF.
        </p>
      </header>

      {!currentVersion ? (
        <section className="waiver-empty">
          <h2>Registration unavailable</h2>
          <p>No waiver is currently published.</p>
        </section>
      ) : null}
      {currentVersion && registration?.subjects.length === 0 ? (
        <section className="waiver-empty">
          <h2>No eligible participant</h2>
          <p>
            Complete an adult profile or ask the academy to link your guardian account to a minor.
          </p>
        </section>
      ) : null}

      {currentVersion && subject ? (
        <div className="waiver-layout">
          <aside className="waiver-subject-card" aria-labelledby="waiver-subject-title">
            <p className="account-eyebrow">Signing for</p>
            <h2 id="waiver-subject-title">{subject.displayName}</h2>
            <p>
              {subject.participantType === "minor"
                ? "Linked minor / guardian signature"
                : "Adult student / self signature"}
            </p>
            {registration && registration.subjects.length > 1 ? (
              <label htmlFor="waiver-subject">
                Participant
                <select
                  id="waiver-subject"
                  value={subject.studentId}
                  onChange={(event) => selectSubject(event.target.value)}
                >
                  {registration.subjects.map((candidate) => (
                    <option key={candidate.studentId} value={candidate.studentId}>
                      {candidate.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <dl>
              <div>
                <dt>Version</dt>
                <dd>{currentVersion.versionLabel}</dd>
              </div>
              <div>
                <dt>Effective</dt>
                <dd>{new Date(currentVersion.effectiveAt).toLocaleString("en-GB")}</dd>
              </div>
            </dl>
          </aside>
          <section className="waiver-official-source" aria-labelledby="official-waiver-title">
            <div className="waiver-official-source-heading">
              <p className="waiver-version">Official source document</p>
              <h2 id="official-waiver-title">
                Brazilian Power Team Jersey Waiver and Release of Liability
              </h2>
              <p>
                Read this exact document before completing the acknowledgements and signing below.
              </p>
              <a href={officialWaiverDocumentUrl} target="_blank" rel="noreferrer noopener">
                Open the official waiver document
              </a>
            </div>
            <iframe
              className="waiver-official-iframe"
              src={officialWaiverDocumentUrl}
              title="Official waiver document"
            />
          </section>

          <section className="waiver-document" aria-labelledby="waiver-document-title">
            <div className="waiver-document-heading">
              <p className="waiver-version">Version {currentVersion.versionLabel}</p>
              <h2 id="waiver-document-title">{currentVersion.title}</h2>
              <p>{currentVersion.introduction}</p>
            </div>

            {consent?.status === "accepted" ? (
              <div className="waiver-status-card waiver-status-active">
                <p className="waiver-status-label">Current status</p>
                <h3>Waiver accepted</h3>
                <p>
                  Signed on {new Date(consent.signedAt).toLocaleString("en-GB")}. The evidence
                  remains private and is opened through a short-lived link.
                </p>
                <div className="waiver-actions">
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void prepareDownload()}
                    type="button"
                  >
                    Prepare evidence download
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => void revoke()}
                    type="button"
                  >
                    Revoke this acceptance
                  </button>
                </div>
                {evidenceUrl ? (
                  <a
                    className="waiver-evidence-link"
                    href={evidenceUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    Open signed evidence PDF
                  </a>
                ) : null}
              </div>
            ) : consent?.status === "revoked" ? (
              <div className="waiver-status-card waiver-status-revoked">
                <p className="waiver-status-label">Current status</p>
                <h3>Waiver revoked</h3>
                <p>
                  This historical acceptance and its evidence were retained. A new published version
                  is required for renewal.
                </p>
              </div>
            ) : (
              <form className="waiver-form" noValidate onSubmit={(event) => void submit(event)}>
                <label className="waiver-official-confirmation">
                  <input
                    checked={officialDocumentReviewed}
                    id="official-waiver-reviewed"
                    onChange={(event) => {
                      setOfficialDocumentReviewed(event.target.checked);
                      setError("");
                    }}
                    type="checkbox"
                  />
                  I have read and agree to the official waiver document above.
                </label>
                {currentVersion.clauses.map((clause, index) => {
                  const missing = Boolean(error && decisions[clause.key] === undefined);
                  return (
                    <fieldset className="waiver-clause" key={clause.key}>
                      <legend id={`waiver-${clause.key}-legend`}>
                        {clause.heading}
                        <span>{clause.required ? "Required" : "Optional"}</span>
                      </legend>
                      <p>{clause.body}</p>
                      <div
                        aria-describedby={error ? "waiver-form-error" : undefined}
                        aria-invalid={missing ? "true" : "false"}
                        aria-labelledby={`waiver-${clause.key}-legend`}
                        className="waiver-decision-group"
                        role="radiogroup"
                      >
                        <label>
                          <input
                            checked={decisions[clause.key] === "accepted"}
                            id={`waiver-${clause.key}-accept`}
                            name={`waiver-${clause.key}`}
                            onChange={() => setDecision(clause.key, "accepted")}
                            ref={index === 0 ? firstDecisionRef : undefined}
                            type="radio"
                          />{" "}
                          Accept {clause.heading}
                        </label>
                        <label>
                          <input
                            checked={decisions[clause.key] === "declined"}
                            name={`waiver-${clause.key}`}
                            onChange={() => setDecision(clause.key, "declined")}
                            type="radio"
                          />{" "}
                          Decline {clause.heading}
                        </label>
                      </div>
                    </fieldset>
                  );
                })}
                <div className="waiver-signature-field">
                  <label htmlFor="waiver-typed-name">Type your full name</label>
                  <p id="waiver-signature-help">
                    It must match the name on your authenticated account.
                  </p>
                  <input
                    aria-describedby={
                      error ? "waiver-signature-help waiver-form-error" : "waiver-signature-help"
                    }
                    aria-invalid={error && !typedName.trim() ? "true" : "false"}
                    autoComplete="name"
                    id="waiver-typed-name"
                    onChange={(event) => {
                      setTypedName(event.target.value);
                      setError("");
                    }}
                    ref={typedNameRef}
                    type="text"
                    value={typedName}
                  />
                </div>
                <button
                  className="button button-primary waiver-submit"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Creating private evidence..." : "Accept and create evidence"}
                </button>
              </form>
            )}
          </section>
        </div>
      ) : null}

      {error ? (
        <p className="waiver-message waiver-message-error" id="waiver-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="waiver-message waiver-message-success" role="status">
          {message}
        </p>
      ) : null}
    </main>
  );
}

export default function WaiverPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/waiver">
        <WaiverContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
