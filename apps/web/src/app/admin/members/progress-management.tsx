"use client";

import { useEffect, useMemo, useState } from "react";
import {
  daysAtLevel,
  jerseyDateOf,
  minimumDaysOf,
  type LevelCatalogProjection,
  type ProgressManagement,
} from "@bpt-jersey/domain/levels";
import { seasonStartFor } from "@bpt-jersey/domain/members/engagement";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";

import { getLevelCatalog, voidPromotion } from "../../../lib/levels-client";
import {
  addManualAttendance,
  getProgressManagement,
  setAttendanceVoid,
  setProgressClassCount,
  setProgressLevel,
} from "../../../lib/progress-management-client";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function ProgressManagementTab({ rows }: { rows: readonly MemberOverviewRow[] }) {
  const today = jerseyDateOf(new Date().toISOString());
  const [query, setQuery] = useState("");
  const [member, setMember] = useState<MemberOverviewRow | null>(null);
  const [catalog, setCatalog] = useState<LevelCatalogProjection | null>(null);
  const [data, setData] = useState<ProgressManagement | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [definitionKey, setDefinitionKey] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [classes, setClasses] = useState(0);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"level" | "season">("level");
  const [addDate, setAddDate] = useState("");
  const [addReason, setAddReason] = useState("");

  useEffect(() => {
    getLevelCatalog().then(setCatalog, (failure: unknown) => setError(messageOf(failure)));
  }, []);

  useEffect(() => {
    if (member === null) return undefined;
    let live = true;
    setData(null);
    getProgressManagement(member.studentId).then(
      (next) => {
        if (!live) return;
        setData(next);
        setDefinitionKey(next.currentDefinitionKey ?? "");
        setStartedOn(next.startedOn ?? today);
        setClasses(next.classesAtLevel);
        setReason("");
      },
      (failure: unknown) => live && setError(messageOf(failure)),
    );
    return () => {
      live = false;
    };
  }, [member, reloadToken, today]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return rows.filter((row) => row.fullName.toLowerCase().includes(needle)).slice(0, 8);
  }, [rows, query]);

  const definitions = useMemo(
    () => [...(catalog?.definitions ?? [])].sort((a, b) => a.sequence - b.sequence),
    [catalog],
  );
  const current = definitions.find((definition) => definition.definitionKey === definitionKey);
  const next = current
    ? definitions.find((definition) => definition.sequence > current.sequence)
    : undefined;
  const minClasses = next?.criteria.minClasses ?? null;
  const minDays = next ? minimumDaysOf(next.criteria.minimumTime) : null;
  const days = daysAtLevel(`${startedOn}T00:00:00.000Z`, new Date().toISOString());
  const since =
    scope === "level"
      ? (data?.startedOn ?? "0000-01-01")
      : seasonStartFor(new Date().toISOString());
  const visible = (data?.attendance ?? []).filter((row) => row.date >= since);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setReloadToken((token) => token + 1);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!data || !member) return;
    const levelChanged =
      definitionKey !== data.currentDefinitionKey || startedOn !== data.startedOn;
    void run(() =>
      levelChanged
        ? setProgressLevel({
            studentId: member.studentId,
            definitionKey,
            startedOn,
            classes,
            reason,
          })
        : setProgressClassCount({ studentId: member.studentId, classes, reason }),
    );
  }

  function removeRow(kind: "attendance" | "manual", id: string) {
    if (!member) return;
    const why = window.prompt("Reason for removing this date (optional)");
    if (why === null) return;
    void run(() =>
      setAttendanceVoid({ studentId: member.studentId, kind, id, voided: true, reason: why }),
    );
  }

  function undoLevel() {
    if (!member || !data?.undoPromotionId) return;
    const why = window.prompt(
      "Why undo this level change? (at least 10 characters)",
      "Undone from Progress management",
    );
    if (!why) return;
    const promotionId = data.undoPromotionId;
    void run(() => voidPromotion({ studentId: member.studentId, promotionId, reason: why }));
  }

  return (
    <section className="admin-panel-card progress-manage" aria-label="Progress management">
      <div className="admin-filter-bar">
        <label className="admin-filter-control members-search">
          Member
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type at least 2 letters of a name"
            type="search"
            value={query}
          />
        </label>
      </div>
      {matches.length > 0 ? (
        <ul className="progress-manage-matches" aria-label="Matching members">
          {matches.map((row) => (
            <li key={row.studentId}>
              <button
                className="membership-table-button"
                onClick={() => {
                  setMember(row);
                  setQuery("");
                  setError(undefined);
                }}
                type="button"
              >
                {row.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="progress-manage-error" role="alert">
          {error}
        </p>
      ) : null}

      {member === null ? (
        <p className="admin-no-results" role="status">
          Search a member to see and correct their progress.
        </p>
      ) : data === null ? (
        <p className="admin-no-results" role="status">
          Loading {member.fullName}…
        </p>
      ) : !data.initialized ? (
        <p className="admin-no-results" role="status">
          {member.fullName} has no level yet. Open their level from their member record first.
        </p>
      ) : (
        <>
          <h3 className="progress-manage-name">{member.fullName}</h3>

          <div className="progress-manage-grid">
            <fieldset className="progress-manage-block">
              <legend>Current level</legend>
              <label className="admin-filter-control">
                Belt / stripe
                <select
                  onChange={(event) => {
                    setDefinitionKey(event.target.value);
                    setClasses(0); // D12: a new level restarts the count unless you type one.
                  }}
                  value={definitionKey}
                >
                  {definitions.map((definition) => (
                    <option key={definition.definitionKey} value={definition.definitionKey}>
                      {definition.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-filter-control">
                Started on
                <input
                  max={today}
                  onChange={(event) => setStartedOn(event.target.value)}
                  type="date"
                  value={startedOn}
                />
              </label>
              <p className="progress-manage-note">
                {days} days at this level
                {next && minDays !== null ? ` of ${minDays} required for ${next.name}` : ""}.
              </p>
              {data.undoPromotionId ? (
                <button
                  className="membership-table-button"
                  disabled={busy}
                  onClick={undoLevel}
                  type="button"
                >
                  Undo last level change
                </button>
              ) : null}
            </fieldset>

            <fieldset className="progress-manage-block">
              <legend>Classes at this level</legend>
              <label className="admin-filter-control">
                Classes up to today
                <input
                  min={0}
                  onChange={(event) =>
                    setClasses(Math.max(0, Math.floor(Number(event.target.value) || 0)))
                  }
                  type="number"
                  value={classes}
                />
              </label>
              {next && minClasses !== null ? (
                <>
                  <meter max={minClasses} min={0} value={Math.min(classes, minClasses)} />
                  <p className="progress-manage-note">
                    {classes} of {minClasses} classes for {next.name}
                  </p>
                </>
              ) : null}
              <label className="admin-filter-control">
                Reason (optional)
                <input
                  maxLength={300}
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                />
              </label>
              <button className="button" disabled={busy} onClick={save} type="button">
                {busy ? "Saving…" : "Save level and classes"}
              </button>
            </fieldset>
          </div>

          <section className="progress-manage-block" aria-label="Attendance">
            <div className="progress-manage-head">
              <h4>Attendance</h4>
              <div role="group" aria-label="Attendance range">
                <button
                  aria-pressed={scope === "level"}
                  className="membership-table-button"
                  onClick={() => setScope("level")}
                  type="button"
                >
                  This level
                </button>
                <button
                  aria-pressed={scope === "season"}
                  className="membership-table-button"
                  onClick={() => setScope("season")}
                  type="button"
                >
                  This season
                </button>
              </div>
            </div>
            <div className="admin-filter-bar">
              <label className="admin-filter-control">
                Add a date
                <input
                  max={today}
                  onChange={(event) => setAddDate(event.target.value)}
                  type="date"
                  value={addDate}
                />
              </label>
              <label className="admin-filter-control">
                Reason (optional)
                <input
                  maxLength={300}
                  onChange={(event) => setAddReason(event.target.value)}
                  value={addReason}
                />
              </label>
              <button
                className="button"
                disabled={busy || addDate === ""}
                onClick={() =>
                  void run(async () => {
                    await addManualAttendance({
                      studentId: member.studentId,
                      date: addDate,
                      reason: addReason,
                    });
                    setAddDate("");
                    setAddReason("");
                  })
                }
                type="button"
              >
                Add date
              </button>
            </div>
            {data.baselineCutoff ? (
              <p className="progress-manage-note">
                Dates before {data.baselineCutoff} are already inside the class count; adding one
                still counts for the streak and the season ranking.
              </p>
            ) : null}
            <p className="members-count" role="status">
              {visible.filter((row) => !row.voided && !row.openMat).length} counted classes shown
            </p>
            <ul className="progress-attendance">
              {visible.map((row) => (
                <li key={`${row.kind}:${row.id}`} className={row.voided ? "is-voided" : undefined}>
                  <span className="progress-attendance-date">{row.date}</span>
                  <span>{row.label}</span>
                  {row.openMat ? (
                    <span className="progress-tag">Open Mat · doesn&apos;t count</span>
                  ) : null}
                  {row.voided ? (
                    <span className="progress-tag">
                      Removed{row.reason ? `: ${row.reason}` : ""}
                    </span>
                  ) : null}
                  {row.voided ? (
                    <button
                      className="membership-table-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          setAttendanceVoid({
                            studentId: member.studentId,
                            kind: row.kind,
                            id: row.id,
                            voided: false,
                          }),
                        )
                      }
                      type="button"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      className="membership-table-button membership-table-button-danger"
                      disabled={busy}
                      onClick={() => removeRow(row.kind, row.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="progress-manage-block" aria-label="Change history">
            <h4>Change history</h4>
            {data.history.length === 0 ? (
              <p className="admin-no-results">No changes yet.</p>
            ) : (
              <ul className="progress-history">
                {data.history.map((change, index) => (
                  <li key={`${change.at}-${index}`}>
                    <strong>{change.summary}</strong>
                    <span>
                      {change.by} ·{" "}
                      {new Date(change.at).toLocaleString("en-GB", { timeZone: "Europe/Jersey" })}
                    </span>
                    {change.reason ? <span>Reason: {change.reason}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
