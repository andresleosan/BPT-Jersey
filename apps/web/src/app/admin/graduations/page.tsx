"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  graduationNoteSchema,
  type GraduationBoard,
  type GraduationBoardRow,
} from "@bpt-jersey/domain/graduations";

import {
  decideGraduation,
  graduationErrorMessage,
  listGraduationBoard,
} from "../../../lib/graduations-client";
import { ConfirmDialog } from "../members/profile/manage-view";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";
import "./graduations.css";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; board: GraduationBoard }>
  | Readonly<{ status: "error" }>;
type Result = Readonly<{ kind: "status" | "alert"; text: string }>;

const sections = [
  { stage: "next", title: "Next graduation", empty: "Nobody is one class away yet." },
  { stage: "today", title: "Today's graduations", empty: "No graduation classes today." },
  { stage: "approval", title: "Graduation approval", empty: "Nothing waiting for a decision." },
] as const;

const classTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
// The server dates the promotion with the UTC day of the class (`occurredAt.slice(0, 10)`).
const classDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const noteRefused = "Use up to 280 characters of plain text.";

function rowKey(row: GraduationBoardRow): string {
  return `${row.stage}:${row.studentId}`;
}

export default function GraduationsRoute() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [promoting, setPromoting] = useState<GraduationBoardRow | null>(null);
  const [notYetFor, setNotYetFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);

  const reload = useCallback(async () => {
    try {
      const board = await listGraduationBoard();
      setState({ status: "ready", board });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The decided row usually leaves the list, so focus goes to the outcome instead of nowhere.
  useEffect(() => {
    if (result !== null) resultRef.current?.focus();
  }, [result]);

  async function decide(
    row: GraduationBoardRow,
    decision: "promote" | "not-yet",
    trimmedNote?: string,
  ): Promise<void> {
    const sessionId = row.graduationClass?.sessionId;
    if (inFlight.current || sessionId === undefined) return;
    inFlight.current = true;
    setBusy(true);
    setResult(null);
    let outcome: Result;
    try {
      await decideGraduation({
        studentId: row.studentId,
        sessionId,
        decision,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      outcome = {
        kind: "status",
        text: decision === "promote" ? "Promoted." : "Saved — back to Next graduation.",
      };
    } catch (error) {
      outcome = { kind: "alert", text: graduationErrorMessage(error) };
    }
    await reload();
    setPromoting(null);
    setNotYetFor(null);
    setNote("");
    setResult(outcome);
    inFlight.current = false;
    setBusy(false);
  }

  function openNotYet(row: GraduationBoardRow): void {
    setNotYetFor(rowKey(row));
    setNote("");
    setNoteError(null);
  }

  function closeNotYet(openerId: string): void {
    setNotYetFor(null);
    document.getElementById(openerId)?.focus();
  }

  function submitNotYet(event: FormEvent<HTMLFormElement>, row: GraduationBoardRow): void {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed !== "" && !graduationNoteSchema.safeParse(trimmed).success) {
      setNoteError(noteRefused);
      return;
    }
    setNoteError(null);
    void decide(row, "not-yet", trimmed);
  }

  function renderRow(row: GraduationBoardRow, canDecide: boolean) {
    const key = rowKey(row);
    const formOpen = notYetFor === key;
    const noteId = `graduation-note-${row.studentId}`;
    const formId = `graduation-not-yet-form-${row.studentId}`;
    const notYetId = `graduation-not-yet-${row.studentId}`;
    return (
      <li className="admin-panel-card graduations-row" key={key}>
        <div className="graduations-row-main">
          <h4>{row.fullName}</h4>
          <p className="graduations-levels">
            {row.current.name} <span aria-hidden="true">→</span>
            <span className="graduations-visually-hidden"> to </span> {row.target.name}
          </p>
          <p className="graduations-counts">
            {`Classes ${row.classesDone}/${row.minClasses ?? "—"} · Days ${row.daysDone}/${row.minDays ?? "—"}`}
          </p>
          {row.stage === "approval" ? (
            <>
              <p>
                {row.graduationClass === null
                  ? "Graduation class not recorded"
                  : `Graduation class: ${classTime.format(new Date(row.graduationClass.occurredAt))} ${row.graduationClass.title}`}
              </p>
              {row.lastNotYetNote ? (
                <p className="graduations-note">Last note: {row.lastNotYetNote}</p>
              ) : null}
            </>
          ) : (
            <p>
              {row.likelyNext === null
                ? "Next class not predicted"
                : `Likely next class: ${classTime.format(new Date(row.likelyNext.startAt))} ${row.likelyNext.title}`}
            </p>
          )}
        </div>
        {row.stage === "approval" ? (
          <div className="graduations-row-actions">
            <AdminStatusBadge status="Pending" />
            {canDecide && row.graduationClass !== null ? (
              <div className="graduations-buttons">
                <button
                  className="admin-auth-button"
                  disabled={busy || formOpen}
                  onClick={() => setPromoting(row)}
                  type="button"
                >
                  Promote
                </button>
                <button
                  aria-controls={formOpen ? formId : undefined}
                  aria-expanded={formOpen}
                  className="ibjjf-button"
                  disabled={busy}
                  id={notYetId}
                  onClick={() => (formOpen ? closeNotYet(notYetId) : openNotYet(row))}
                  type="button"
                >
                  Not yet
                </button>
              </div>
            ) : (
              <p className="graduations-muted">Owner decides</p>
            )}
          </div>
        ) : null}
        {formOpen ? (
          <form
            aria-label={`Not yet for ${row.fullName}`}
            className="graduations-not-yet"
            id={formId}
            onSubmit={(event) => submitNotYet(event, row)}
          >
            <label htmlFor={noteId}>
              What to work on (the member will see this)
              <textarea
                aria-describedby={noteError ? `${noteId}-error` : `${noteId}-help`}
                aria-invalid={noteError ? true : undefined}
                autoFocus
                id={noteId}
                maxLength={280}
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </label>
            {noteError ? (
              <p className="ibjjf-error" id={`${noteId}-error`}>
                {noteError}
              </p>
            ) : (
              <p className="graduations-muted" id={`${noteId}-help`}>
                Optional, up to 280 characters.
              </p>
            )}
            <div className="graduations-buttons">
              <button className="admin-auth-button" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save Not yet"}
              </button>
              <button
                className="ibjjf-button"
                disabled={busy}
                onClick={() => closeNotYet(notYetId)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </li>
    );
  }

  const board = state.status === "ready" ? state.board : null;

  return (
    <section aria-label="Graduations" className="admin-module-page graduations-page">
      <AdminSectionHeader
        description={
          board === null || board.canDecide
            ? "Who graduates next, who graduates today and who is waiting for your decision."
            : "Who graduates next, who graduates today and who is waiting for the owner's decision."
        }
        eyebrow="Mat / Levels"
        title="Graduations"
      />

      {result === null ? null : (
        <p
          className={result.kind === "status" ? "ibjjf-notice" : "ibjjf-error"}
          ref={resultRef}
          role={result.kind}
          tabIndex={-1}
        >
          {result.text}
        </p>
      )}

      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="Loading graduations" className="graduations-skeleton" />
      ) : state.status === "error" ? (
        <div className="graduations-load-error">
          <p className="ibjjf-error" role="alert">
            Graduations could not be loaded. Try again in a moment.
          </p>
          <button className="ibjjf-button" onClick={() => void reload()} type="button">
            Try again
          </button>
        </div>
      ) : (
        sections.map((section) => {
          const rows = state.board.rows.filter((row) => row.stage === section.stage);
          const headingId = `graduations-${section.stage}`;
          return (
            <section aria-labelledby={headingId} className="graduations-section" key={section.stage}>
              <h3 id={headingId}>
                {section.title} <span className="graduations-count">{rows.length}</span>
              </h3>
              {rows.length === 0 ? (
                <p className="graduations-muted">{section.empty}</p>
              ) : (
                <ul className="graduations-list">
                  {rows.map((row) => renderRow(row, state.board.canDecide))}
                </ul>
              )}
            </section>
          );
        })
      )}

      {promoting !== null && promoting.graduationClass !== null ? (
        <ConfirmDialog
          busy={busy}
          confirmDisabled={false}
          confirmLabel={busy ? "Promoting…" : "Promote"}
          onCancel={() => setPromoting(null)}
          onConfirm={() => void decide(promoting, "promote")}
          title={`Promote ${promoting.fullName} to ${promoting.target.name}? Dated ${classDay.format(new Date(`${promoting.graduationClass.occurredAt.slice(0, 10)}T12:00:00Z`))}.`}
        >
          <p>The new level starts on the day of the graduation class.</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
