"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { MemberImportPreview } from "@bpt-jersey/domain";

import {
  confirmMemberImport,
  createMemberImportSession,
  isMemberImportExpiryValid,
  previewMemberImport,
  uploadMemberImportFiles,
  validateMemberImportFiles,
  type MemberImportFile,
  type MemberImportWriteResult,
} from "../../../../lib/member-import-client";
import { AdminGate } from "../../admin-gate";

import "../../admin.css";

type ImportStatus = "idle" | "working" | "preview" | "complete";

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function ImportCounts({ preview }: { preview: MemberImportPreview }) {
  return (
    <dl className="member-import-counts">
      <div>
        <dt>Additions</dt>
        <dd>{pluralize(preview.additions.length, "addition")}</dd>
      </div>
      <div>
        <dt>Updates</dt>
        <dd>{pluralize(preview.updates.length, "update")}</dd>
      </div>
      <div>
        <dt>Duplicates</dt>
        <dd>{pluralize(preview.duplicates.length, "duplicate")}</dd>
      </div>
      <div>
        <dt>Conflicts</dt>
        <dd>{pluralize(preview.conflicts.length, "conflict")}</dd>
      </div>
    </dl>
  );
}

function WriteSummary({ result }: { result: MemberImportWriteResult }) {
  return (
    <dl className="member-import-counts member-import-success-counts">
      <div>
        <dt>Imported</dt>
        <dd>{result.imported} imported</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>{result.updated} updated</dd>
      </div>
      <div>
        <dt>Conflicts</dt>
        <dd>{pluralize(result.conflicts, "conflict")}</dd>
      </div>
    </dl>
  );
}

export function MemberImportPage() {
  const [files, setFiles] = useState<readonly MemberImportFile[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string>();
  const [preview, setPreview] = useState<MemberImportPreview>();
  const [result, setResult] = useState<MemberImportWriteResult>();
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const generationRef = useRef(0);

  useEffect(() => {
    const expiry = preview?.expiresAt ?? sessionExpiresAt;
    if (!expiry) return;
    const delay = Math.max(0, Date.parse(expiry) - Date.now());
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [preview?.expiresAt, sessionExpiresAt]);

  function handleFiles(event: ChangeEvent<HTMLInputElement>): void {
    generationRef.current += 1;
    const selected = validateMemberImportFiles(Array.from(event.target.files ?? []));
    setFiles(selected);
    setSessionId(undefined);
    setSessionExpiresAt(undefined);
    setPreview(undefined);
    setResult(undefined);
    setProgress(0);
    setError(
      selected.length === 0
        ? "Choose between one and five PDF files, each no larger than 10 MiB."
        : "",
    );
    setStatus("idle");
  }

  async function handlePreview(): Promise<void> {
    if (files.length === 0 || status === "working") return;
    const generation = generationRef.current;
    const selectedFiles = files;
    const isCurrent = () => generation === generationRef.current;
    setError("");
    setPreview(undefined);
    setResult(undefined);
    setProgress(0);
    setStatus("working");
    try {
      const session = await createMemberImportSession(selectedFiles);
      if (!isCurrent()) return;
      setSessionId(session.sessionId);
      setSessionExpiresAt(session.expiresAt);
      await uploadMemberImportFiles(selectedFiles, session, (completed, total) => {
        if (isCurrent()) setProgress(Math.round((completed / total) * 100));
      });
      if (!isCurrent()) return;
      const nextPreview = await previewMemberImport(session.sessionId);
      if (!isCurrent()) return;
      setPreview(nextPreview);
      setStatus("preview");
    } catch {
      if (!isCurrent()) return;
      setError("Unable to prepare member import. Please try again.");
      setStatus("idle");
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!sessionId || !preview || preview.conflicts.length > 0 || status === "working") return;
    const generation = generationRef.current;
    const currentSessionId = sessionId;
    const currentPreviewId = preview.previewId;
    if (!isMemberImportExpiryValid(preview.expiresAt, Date.now())) {
      setPreview(undefined);
      setSessionId(undefined);
      setSessionExpiresAt(undefined);
      setStatus("idle");
      setError("This import preview has expired. Select the reports again to continue.");
      return;
    }
    setError("");
    setStatus("working");
    try {
      const writeResult = await confirmMemberImport(currentSessionId, currentPreviewId);
      if (generation !== generationRef.current) return;
      setPreview(undefined);
      setResult(writeResult);
      setStatus("complete");
    } catch {
      if (generation !== generationRef.current) return;
      setError("Unable to confirm member import. Please try again.");
      setStatus("preview");
    }
  }

  const currentExpiry = preview?.expiresAt ?? sessionExpiresAt;
  const expired = currentExpiry !== undefined && !isMemberImportExpiryValid(currentExpiry, clock);
  const canPreview = files.length > 0 && status !== "working" && result === undefined;
  const canConfirm =
    files.length > 0 &&
    sessionId !== undefined &&
    preview !== undefined &&
    status === "preview" &&
    preview.conflicts.length === 0 &&
    !expired;

  return (
    <section aria-labelledby="member-import-title" className="admin-member-page member-import-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">Members / Import records</p>
        <h2 id="member-import-title">Import member reports</h2>
        <p>
          Upload approved PDF reports, review the changes, and confirm them into the academy
          directory.
        </p>
      </header>
      <section className="member-import-card" aria-labelledby="member-import-files-title">
        <h3 id="member-import-files-title">1. Select reports</h3>
        <p className="member-import-help">
          PDF only. Choose up to five files, with a 10 MiB limit per file.
        </p>
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
          <h3 id="member-import-preview-title">2. Review preview</h3>
          <p aria-live="polite" className="member-import-status" role="status">
            Preview ready
          </p>
          <ImportCounts preview={preview} />
          {preview.conflicts.length > 0 ? (
            <p aria-live="assertive" className="member-import-conflict" role="alert">
              Resolve {pluralize(preview.conflicts.length, "conflict")} before confirming this
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
          Confirmation is available only after a conflict-free preview.
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
  if (process.env.NODE_ENV === "test") return <MemberImportPage />;
  return (
    <AdminGate>
      <MemberImportPage />
    </AdminGate>
  );
}
