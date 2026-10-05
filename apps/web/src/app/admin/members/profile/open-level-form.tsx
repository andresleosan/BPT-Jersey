"use client";

import { useRef, useState, type FormEvent } from "react";
import type { LevelCatalogProjection } from "@bpt-jersey/domain/levels";
import { openStudentLevel, levelsSafeErrors } from "../../../../lib/levels-client";
import { safeMessage } from "./safe-message";

export function OpenLevelForm({
  studentId,
  catalog,
  today,
  onDone,
  ownerCanSetProgress = false,
}: Readonly<{
  studentId: string;
  catalog: LevelCatalogProjection;
  today: string;
  onDone: (notice: string) => void;
  ownerCanSetProgress?: boolean;
}>) {
  const [definitionKey, setDefinitionKey] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [newLevelClasses, setNewLevelClasses] = useState("");
  const [newLevelDays, setNewLevelDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const levels = [...catalog.definitions].sort((left, right) => left.sequence - right.sequence);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // One request in flight. The `disabled` attribute below is not enough on its own: two clicks
    // dispatched before React re-renders both read the same stale `busy`, so the flag is a ref,
    // which is written before the await. The callable does not deduplicate (Task 12, carried), so
    // a second submit would open a second audited record on a real member.
    if (inFlight.current) return;
    if (definitionKey === "" || startedOn === "" || notes.trim().length < 3) {
      setError("Choose a level, a start date and write a short note.");
      return;
    }
    if (ownerCanSetProgress && (newLevelClasses !== "" || newLevelDays !== "")) {
      const wholeCount = (value: string, max: number) =>
        /^(0|[1-9]\d*)$/u.test(value) && Number(value) <= max;
      if (!wholeCount(newLevelClasses, 10_000) || !wholeCount(newLevelDays, 100_000)) {
        setError("Enter both progress counts as whole numbers, or leave both blank.");
        return;
      }
    }
    // Set only once the submit is going through, so a refused form can be corrected and sent.
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await openStudentLevel({
        studentId, definitionKey, startedOn, decisionNotes: notes.trim(),
        ...(ownerCanSetProgress && newLevelClasses !== "" && newLevelDays !== ""
          ? { newLevelClasses: Number(newLevelClasses), newLevelDays: Number(newLevelDays) }
          : {}),
      });
      // The flag is NOT cleared here (Critical-3): `onDone` puts the view back into `loading` and
      // this form unmounts with the reload, so nothing is left clickable over the stale data.
      onDone("Level opened.");
    } catch (failure) {
      setError(safeMessage(failure, levelsSafeErrors.open));
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-labelledby="ibjjf-open-title"
      className="ibjjf-form"
      onSubmit={(event) => void submit(event)}
    >
      <h3 id="ibjjf-open-title">Open level</h3>
      <label htmlFor="ibjjf-open-level">
        Level
        <select
          id="ibjjf-open-level"
          onChange={(event) => setDefinitionKey(event.target.value)}
          value={definitionKey}
        >
          <option value="">Select a level</option>
          {levels.map((level) => (
            <option key={level.definitionKey} value={level.definitionKey}>
              {level.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="ibjjf-open-date">
        Start date
        <input
          id="ibjjf-open-date"
          max={today}
          onChange={(event) => setStartedOn(event.target.value)}
          type="date"
          value={startedOn}
        />
      </label>
      <label htmlFor="ibjjf-open-notes">
        Notes
        <textarea
          id="ibjjf-open-notes"
          maxLength={1000}
          onChange={(event) => setNotes(event.target.value)}
          value={notes}
        />
      </label>
      {ownerCanSetProgress ? (
        <>
          <label htmlFor="ibjjf-open-classes">
            Classes completed at this level through today
            <input
              id="ibjjf-open-classes"
              max={10000}
              min={0}
              onChange={(event) => setNewLevelClasses(event.target.value)}
              step={1}
              type="number"
              value={newLevelClasses}
            />
          </label>
          <label htmlFor="ibjjf-open-days">
            Days completed at this level through today
            <input
              id="ibjjf-open-days"
              max={100000}
              min={0}
              onChange={(event) => setNewLevelDays(event.target.value)}
              step={1}
              type="number"
              value={newLevelDays}
            />
          </label>
          <p className="ibjjf-muted">
            Enter both counts to set the starting progress. Leave both blank to count attendance
            and time from the start date.
          </p>
        </>
      ) : null}
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button className="admin-auth-button" disabled={busy} type="submit">
        Open level
      </button>
    </form>
  );
}
