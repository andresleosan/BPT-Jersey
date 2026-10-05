"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  manualProgressLimits,
  type LevelCatalogProjection,
  type ProgressManagement,
} from "@bpt-jersey/domain/levels";
import type { StudentLevelCard } from "../../../../lib/levels-client";
import {
  getProgressManagement,
  setProgressClassCount,
} from "../../../../lib/progress-management-client";
import { ProgressCountFields, readManualProgress } from "./progress-count-fields";

export function CurrentProgressForm({
  studentId,
  catalog,
  card,
  mayDiscardRatings,
  onDone,
}: Readonly<{
  studentId: string;
  catalog: LevelCatalogProjection;
  card: Extract<StudentLevelCard, { state: "initialized" }>;
  mayDiscardRatings: () => boolean;
  onDone: (notice: string) => void;
}>) {
  const [classes, setClasses] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const limits = manualProgressLimits(catalog.definitions, card.currentDefinition.definitionKey);
  const levelName =
    catalog.definitions.find(
      (definition) => definition.definitionKey === card.currentDefinition.definitionKey,
    )?.name ?? "the current level";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = readManualProgress(limits, classes, days);
    if (parsed.error !== null) {
      setError(parsed.error);
      return;
    }
    if (classes === "" && days === "") {
      setError("Enter a class count or a day count.");
      return;
    }
    if (!mayDiscardRatings()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await setProgressClassCount({
        studentId,
        definitionKey: card.currentDefinition.definitionKey,
        ...parsed.input,
      });
      onDone("Progress saved. The level is unchanged and the adjustment is in Progress history.");
    } catch (failure) {
      // The client exposes only expected callable errors and its fixed fallback.
      setError(
        failure instanceof Error ? failure.message : "Unable to save progress. Please try again.",
      );
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-labelledby="ibjjf-current-progress-title"
      aria-busy={busy}
      className="ibjjf-form"
      onSubmit={(event) => void save(event)}
    >
      <h3 id="ibjjf-current-progress-title">Adjust current progress</h3>
      <p className="ibjjf-muted">
        Set the totals for {levelName}. The level and its start date stay the same.
      </p>
      <dl className="ibjjf-current-counts">
        <div>
          <dt>Classes now</dt>
          <dd>
            {card.criteria.classes.completed}
            {card.criteria.classes.required === null ? "" : ` / ${card.criteria.classes.required}`}
          </dd>
        </div>
        <div>
          <dt>Days now</dt>
          <dd>
            {card.criteria.time.elapsedDays}
            {card.criteria.time.requiredDays === null
              ? ""
              : ` / ${card.criteria.time.requiredDays}`}
          </dd>
        </div>
      </dl>
      <ProgressCountFields
        id="ibjjf-current"
        limits={limits}
        classes={classes}
        days={days}
        onClassesChange={setClasses}
        onDaysChange={setDays}
        disabled={busy}
      />
      <p className="ibjjf-muted">
        Leave either field blank to keep its count. New attendance and elapsed days continue to add
        automatically. The adjustment is dated and saved in the history.
      </p>
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="admin-auth-button"
        disabled={busy || (limits.classes === null && limits.days === null)}
        type="submit"
      >
        {busy ? "Saving progress…" : "Save progress"}
      </button>
    </form>
  );
}

const historyDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Jersey",
});

export function ProgressAdjustmentHistory({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<ProgressManagement["history"] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open || history !== null) return;
    let active = true;
    setError(false);
    getProgressManagement(studentId).then(
      (data) => {
        if (active) setHistory(data.history);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, open, history, attempt]);
  return (
    <details
      className="ibjjf-progress-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Progress history</summary>
      {open && history === null && !error ? <p role="status">Loading progress history…</p> : null}
      {error ? (
        <div>
          <p className="ibjjf-error" role="alert">
            Unable to load progress history.
          </p>
          <button
            className="ibjjf-button"
            onClick={() => {
              setError(false);
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            Retry history
          </button>
        </div>
      ) : null}
      {history?.length === 0 ? (
        <p className="ibjjf-muted">No manual progress adjustments recorded.</p>
      ) : null}
      {history === null || history.length === 0 ? null : (
        <ol className="ibjjf-adjustment-list">
          {history.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time dateTime={entry.at}>
                {Number.isNaN(Date.parse(entry.at))
                  ? "Date not recorded"
                  : historyDate.format(new Date(entry.at))}
              </time>
              <div>
                <p>{entry.summary}</p>
                <p className="ibjjf-muted">{entry.by}</p>
                {entry.reason ? <p>{entry.reason}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
