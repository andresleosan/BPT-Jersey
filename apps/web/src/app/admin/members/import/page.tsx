"use client";

import {
  trainingCenters,
  trainingTimePreferences,
  type TrainingCenter,
  type TrainingTimePreference,
} from "@bpt-jersey/domain";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import {
  confirmMemberImport,
  createMemberImportSession,
  isMemberImportExpiryValid,
  previewMemberImport,
  reviewMemberImportMatches,
  uploadMemberImportFiles,
  validateMemberImportFiles,
  type CanonicalMemberImportPreview,
  type MemberImportFile,
  type MemberImportWriteResult,
} from "../../../../lib/member-import-client";

import "../../admin.css";

type ImportStatus = "idle" | "working" | "preview" | "complete";

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function ImportCounts({ preview }: { preview: CanonicalMemberImportPreview }) {
  const counts = preview.receipt.classificationCounts;
  const existingMatches = counts["same-id-compatible"] + counts["explicit-existing-student-match"];
  return (
    <dl className="member-import-counts">
      <div>
        <dt>New adults</dt>
        <dd>{pluralize(counts["createable-adult"], "new adult")}</dd>
      </div>
      <div>
        <dt>Existing matches</dt>
        <dd>{pluralize(existingMatches, "existing match")}</dd>
      </div>
      <div>
        <dt>Minors awaiting family</dt>
        <dd>{pluralize(counts["minor-requires-family-match"], "minor")}</dd>
      </div>
      <div>
        <dt>Missing fields</dt>
        <dd>{pluralize(counts["missing-required-fields"], "missing-field row")}</dd>
      </div>
      <div>
        <dt>Identity conflicts</dt>
        <dd>{pluralize(counts["identity-conflict"], "identity conflict")}</dd>
      </div>
      <div>
        <dt>Duplicate numbers</dt>
        <dd>{pluralize(counts["duplicate-membership-number"], "duplicate number")}</dd>
      </div>
      <div>
        <dt>Cross-tenant rows</dt>
        <dd>{pluralize(counts["cross-tenant"], "cross-tenant row")}</dd>
      </div>
      <div>
        <dt>Invalid rows</dt>
        <dd>{pluralize(counts["invalid-record"], "invalid row")}</dd>
      </div>
    </dl>
  );
}

function WriteSummary({ result }: { result: MemberImportWriteResult }) {
  return (
    <dl className="member-import-counts member-import-success-counts">
      <div>
        <dt>Created</dt>
        <dd>{result.created} created</dd>
      </div>
      <div>
        <dt>Matched</dt>
        <dd>{result.matched} matched</dd>
      </div>
    </dl>
  );
}

function createOperationId(): string {
  return globalThis.crypto.randomUUID();
}

export function MemberImportPage() {
  const [files, setFiles] = useState<readonly MemberImportFile[]>([]);
  const [trainingCenter, setTrainingCenter] = useState<TrainingCenter>("Town");
  const [preferences, setPreferences] = useState<readonly TrainingTimePreference[]>(["evening"]);
  const [sessionId, setSessionId] = useState<string>();
  const [operationId, setOperationId] = useState<string>();
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string>();
  const [preview, setPreview] = useState<CanonicalMemberImportPreview>();
  const [result, setResult] = useState<MemberImportWriteResult>();
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [reviewDecisions, setReviewDecisions] = useState<
    Readonly<Record<string, "accept" | "reject">>
  >({});
  const [clock, setClock] = useState(() => Date.now());
  const generationRef = useRef(0);
  const operationIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const expiry = preview?.receipt.expiresAt ?? sessionExpiresAt;
    if (!expiry) return;
    const delay = Math.max(0, Date.parse(expiry) - Date.now());
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [preview?.receipt.expiresAt, sessionExpiresAt]);

  function resetAttempt(selected: readonly MemberImportFile[]): void {
    setSessionId(undefined);
    setOperationId(undefined);
    setSessionExpiresAt(undefined);
    setPreview(undefined);
    setResult(undefined);
    setProgress(0);
    setReviewDecisions({});
    setStatus("idle");
    operationIdRef.current = selected.length === 0 ? undefined : createOperationId();
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>): void {
    generationRef.current += 1;
    const selected = validateMemberImportFiles(Array.from(event.target.files ?? []));
    setFiles(selected);
    resetAttempt(selected);
    setError(
      selected.length === 0
        ? "Choose between one and five PDF files, each no larger than 10 MiB."
        : "",
    );
  }

  function togglePreference(preference: TrainingTimePreference): void {
    generationRef.current += 1;
    setPreferences((current) =>
      current.includes(preference)
        ? current.filter((value) => value !== preference)
        : [...current, preference],
    );
    resetAttempt(files);
    setError("");
  }

  function changeTrainingCenter(nextTrainingCenter: TrainingCenter): void {
    generationRef.current += 1;
    setTrainingCenter(nextTrainingCenter);
    resetAttempt(files);
    setError("");
  }

  async function handlePreview(): Promise<void> {
    if (files.length === 0 || preferences.length === 0 || status === "working") return;
    const generation = generationRef.current;
    const selectedFiles = files;
    const currentOperationId = operationIdRef.current ?? createOperationId();
    operationIdRef.current = currentOperationId;
    const isCurrent = () => generation === generationRef.current;
    setError("");
    setPreview(undefined);
    setResult(undefined);
    setProgress(0);
    setStatus("working");
    try {
      const session = await createMemberImportSession(selectedFiles, {
        operationId: currentOperationId,
        trainingCenter,
        trainingTimePreferences: preferences,
      });
      if (!isCurrent()) return;
      setSessionId(session.sessionId);
      setOperationId(currentOperationId);
      setSessionExpiresAt(session.expiresAt);
      await uploadMemberImportFiles(selectedFiles, session, (completed, total) => {
        if (isCurrent()) setProgress(Math.round((completed / total) * 100));
      });
      if (!isCurrent()) return;
      const nextPreview = await previewMemberImport(session.sessionId, currentOperationId);
      if (!isCurrent()) return;
      setPreview(nextPreview);
      const restoredDecisions: Record<string, "accept" | "reject"> = {};
      for (const match of nextPreview.reviewMatches) {
        if (match.decision === "accepted") restoredDecisions[match.rowMac] = "accept";
        if (match.decision === "rejected") restoredDecisions[match.rowMac] = "reject";
      }
      setReviewDecisions(Object.freeze(restoredDecisions));
      setStatus("preview");
    } catch {
      if (!isCurrent()) return;
      setError("Unable to prepare member import. Please try again.");
      setStatus("idle");
    }
  }

  async function handleReview(): Promise<void> {
    if (!sessionId || !operationId || !preview || status === "working") return;
    const decisions = preview.reviewMatches.map((match) => ({
      rowMac: match.rowMac,
      decision: reviewDecisions[match.rowMac],
    }));
    if (decisions.some((decision) => decision.decision === undefined)) return;
    const generation = generationRef.current;
    setError("");
    setStatus("working");
    try {
      const reviewed = await reviewMemberImportMatches(
        sessionId,
        operationId,
        decisions as readonly Readonly<{
          rowMac: string;
          decision: "accept" | "reject";
        }>[],
      );
      if (generation !== generationRef.current) return;
      setPreview(reviewed);
      setStatus("preview");
    } catch {
      if (generation !== generationRef.current) return;
      setError("Unable to review member matches. Please try again.");
      setStatus("preview");
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!sessionId || !operationId || !preview || !preview.confirmable || status === "working")
      return;
    const generation = generationRef.current;
    if (!isMemberImportExpiryValid(preview.receipt.expiresAt, Date.now())) {
      setPreview(undefined);
      setSessionId(undefined);
      setOperationId(undefined);
      setSessionExpiresAt(undefined);
      setStatus("idle");
      setError("This import preview has expired. Select the reports again to continue.");
      return;
    }
    setError("");
    setStatus("working");
    try {
      const writeResult = await confirmMemberImport(sessionId, operationId, preview.receipt);
      if (generation !== generationRef.current) return;
      setPreview(undefined);
      setResult(writeResult);
      setStatus("complete");
      operationIdRef.current = undefined;
    } catch {
      if (generation !== generationRef.current) return;
      setError("Unable to confirm member import. Please try again.");
      setStatus("preview");
    }
  }

  const currentExpiry = preview?.receipt.expiresAt ?? sessionExpiresAt;
  const expired = currentExpiry !== undefined && !isMemberImportExpiryValid(currentExpiry, clock);
  const canPreview =
    files.length > 0 && preferences.length > 0 && status !== "working" && result === undefined;
  const canConfirm =
    files.length > 0 &&
    sessionId !== undefined &&
    operationId !== undefined &&
    preview !== undefined &&
    status === "preview" &&
    preview.confirmable &&
    !expired;
  const canReview =
    preview !== undefined &&
    preview.reviewMatches.length > 0 &&
    preview.reviewMatches.every((match) => reviewDecisions[match.rowMac] !== undefined) &&
    preview.reviewMatches.some((match) => match.decision === "pending") &&
    status === "preview" &&
    !expired;

  return (
    <section aria-labelledby="member-import-title" className="admin-member-page member-import-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">Members / Import records</p>
        <h2 id="member-import-title">Import member reports</h2>
        <p>
          Upload approved PDF reports, review only canonical classifications, and confirm into the
          academy directory.
        </p>
      </header>
      <section className="member-import-card" aria-labelledby="member-import-files-title">
        <h3 id="member-import-files-title">1. Select reports and training defaults</h3>
        <p className="member-import-help">
          PDF only. Choose up to five files, with a 10 MiB limit per file.
        </p>
        <label className="member-import-file-label" htmlFor="member-import-training-center">
          Training center
        </label>
        <select
          id="member-import-training-center"
          value={trainingCenter}
          disabled={status === "working" || status === "preview"}
          onChange={(event) => changeTrainingCenter(event.target.value as TrainingCenter)}
        >
          {trainingCenters.map((center) => (
            <option key={center} value={center}>
              {center}
            </option>
          ))}
        </select>
        <fieldset disabled={status === "working" || status === "preview"}>
          <legend>Training times</legend>
          {trainingTimePreferences.map((preference) => (
            <label key={preference}>
              <input
                type="checkbox"
                checked={preferences.includes(preference)}
                onChange={() => togglePreference(preference)}
              />
              {preference[0]?.toUpperCase()}
              {preference.slice(1)}
            </label>
          ))}
        </fieldset>
        <label className="member-import-file-label" htmlFor="member-import-files">
          Member report PDFs
        </label>
        <input
          accept=".pdf,application/pdf"
          id="member-import-files"
          multiple
          onChange={handleFiles}
          type="file"
        />
        {files.length > 0 ? (
          <ul className="member-import-file-list" aria-label="Selected reports">
            {files.map((file) => (
              <li key={`${file.fileName}-${file.sizeBytes}`}>
                <span>{file.fileName}</span>
                <span>{Math.ceil(file.sizeBytes / 1024)} KiB</span>
              </li>
            ))}
          </ul>
        ) : null}
        {preferences.length === 0 ? (
          <p className="member-import-conflict" role="alert">
            Choose at least one training time.
          </p>
        ) : null}
        <button
          className="admin-auth-button"
          disabled={!canPreview}
          onClick={() => void handlePreview()}
          type="button"
        >
          {status === "working" ? "Preparing preview..." : "Preview import"}
        </button>
        {status === "working" && progress > 0 ? (
          <p aria-live="polite" className="member-import-progress" role="status">
            Uploading reports: {progress}%
          </p>
        ) : null}
      </section>
      {error ? (
        <p aria-live="assertive" className="regyfit-no-results" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <section className="member-import-card" aria-labelledby="member-import-preview-title">
          <h3 id="member-import-preview-title">2. Review canonical preview</h3>
          <p aria-live="polite" className="member-import-status" role="status">
            Preview ready
          </p>
          <ImportCounts preview={preview} />
          {preview.reviewMatches.length > 0 ? (
            <section aria-labelledby="member-import-match-review-title">
              <h4 id="member-import-match-review-title">Review existing matches</h4>
              {preview.reviewMatches.map((match) => (
                <article key={match.rowMac} className="member-import-card">
                  <p>Source: {match.sourceName}</p>
                  <dl>
                    <dt>Candidate name</dt>
                    <dd>{match.candidate.fullName}</dd>
                    <dt>Training center</dt>
                    <dd>{match.candidate.trainingCenter}</dd>
                    <dt>Membership reference</dt>
                    <dd>{match.candidate.membershipReference ?? "Not provided"}</dd>
                  </dl>
                  <button
                    aria-pressed={reviewDecisions[match.rowMac] === "accept"}
                    disabled={status === "working" || match.decision !== "pending"}
                    onClick={() =>
                      setReviewDecisions((current) =>
                        Object.freeze({ ...current, [match.rowMac]: "accept" }),
                      )
                    }
                    type="button"
                  >
                    Accept match for {match.sourceName}
                  </button>
                  <button
                    aria-pressed={reviewDecisions[match.rowMac] === "reject"}
                    disabled={status === "working" || match.decision !== "pending"}
                    onClick={() =>
                      setReviewDecisions((current) =>
                        Object.freeze({ ...current, [match.rowMac]: "reject" }),
                      )
                    }
                    type="button"
                  >
                    Reject match for {match.sourceName}
                  </button>
                </article>
              ))}
              <button disabled={!canReview} onClick={() => void handleReview()} type="button">
                Review matches
              </button>
            </section>
          ) : null}
          {!preview.confirmable && preview.reviewMatches.length === 0 ? (
            <p aria-live="assertive" className="member-import-conflict" role="alert">
              This preview cannot be confirmed. Resolve every classified conflict and start a new
              import.
            </p>
          ) : null}
          {expired ? (
            <p aria-live="assertive" className="member-import-conflict" role="alert">
              This import preview has expired. Select the reports again to continue.
            </p>
          ) : null}
        </section>
      ) : null}
      <section className="member-import-card" aria-labelledby="member-import-confirm-title">
        <h3 id="member-import-confirm-title">3. Confirm import</h3>
        <p className="member-import-help">
          Confirmation is available only after a conflict-free canonical preview.
        </p>
        <button
          className="admin-auth-button"
          disabled={!canConfirm}
          onClick={() => void handleConfirm()}
          type="button"
        >
          Confirm import
        </button>
      </section>
      {result ? (
        <section
          className="member-import-card member-import-result"
          aria-labelledby="member-import-result-title"
        >
          <h3 id="member-import-result-title">4. Import complete</h3>
          <p aria-live="polite" className="member-import-status" role="status">
            Import complete
          </p>
          <WriteSummary result={result} />
        </section>
      ) : null}
    </section>
  );
}

export default function MemberImportRoute() {
  return <MemberImportPage />;
}
