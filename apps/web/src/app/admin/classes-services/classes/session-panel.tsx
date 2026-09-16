"use client";

import { useState, type ReactElement } from "react";

import type {
  CreateSessionInput,
  SessionRecord,
  UpdateSessionInput,
} from "@bpt-jersey/domain/schedule";
import {
  localMidnightUtc,
  waitingListModes,
  type SessionBookingRules,
  type WaitingListMode,
} from "@bpt-jersey/domain/schedule/classes-services";

import {
  cancelSession,
  saveSession,
  updateSession,
  type ScheduleCatalogResponse,
} from "../../../../lib/schedule-client";
import { RegistrationsPanel } from "./registrations-panel";
import { localParts } from "./week-grid";

/** Only what the panel needs from a staff profile, so the tests can hand it plain rows. */
export type StaffOption = Readonly<{
  staffKey: string;
  role: string;
  active: boolean;
  status: string;
}>;

export type SessionPanelProps = Readonly<{
  mode: "create" | "edit";
  session?: SessionRecord | undefined;
  catalog: ScheduleCatalogResponse;
  staff: readonly StaffOption[];
  timezone: string;
  defaults?: Readonly<{ date: string; startTime: string }> | undefined;
  canEdit: boolean;
  onSaved: (session: SessionRecord) => void;
  onCancelled: (session: SessionRecord) => void;
  onClose: () => void;
}>;

type CancelUntil = "start" | "end" | "custom";

type Draft = Readonly<{
  date: string;
  startTime: string;
  endTime: string;
  locationId: string;
  programId: string;
  capacity: string;
  trainers: readonly string[];
  rulesMode: "defined" | "custom";
  bookUntil: string;
  cancelUntil: CancelUntil;
  cancelMinutes: string;
  advance: string;
  waitingList: WaitingListMode;
}>;

const defaultDurationMinutes = 60;
const dialogTitleId = "cs-session-panel-title";
const lockedHint = "Copy the class to change it";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function timeOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

function isoAt(date: string, time: string, timezone: string): string {
  return new Date(localMidnightUtc(date, timezone) + minutesOf(time) * 60_000).toISOString();
}

function timeFrom(iso: string, timezone: string): string {
  return timeOf(Math.round(localParts(iso, timezone).hour * 60));
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function draftFor(
  mode: "create" | "edit",
  session: SessionRecord | undefined,
  catalog: ScheduleCatalogResponse,
  timezone: string,
  defaults: Readonly<{ date: string; startTime: string }> | undefined,
): Draft {
  if (mode === "edit" && session) {
    const rules = session.bookingRules ?? "defined";
    const custom = rules !== "defined";
    const cancelUntil = custom ? rules.cancelUntil : "start";
    return {
      date: localParts(session.startAt, timezone).date,
      startTime: timeFrom(session.startAt, timezone),
      endTime: timeFrom(session.endAt, timezone),
      locationId: session.locationId,
      programId: session.programId,
      capacity: session.capacity === null ? "" : String(session.capacity),
      trainers: session.instructorIds ?? [session.instructorId],
      rulesMode: custom ? "custom" : "defined",
      bookUntil: custom ? String(rules.bookUntilMinutesBefore) : "0",
      cancelUntil: typeof cancelUntil === "string" ? cancelUntil : "custom",
      cancelMinutes: typeof cancelUntil === "string" ? "0" : String(cancelUntil.minutesBefore),
      advance: custom ? String(rules.advanceMinutes) : "0",
      waitingList: session.waitingList ?? "general",
    };
  }
  const date = defaults?.date ?? localParts(new Date().toISOString(), timezone).date;
  const startTime = defaults?.startTime ?? "17:00";
  return {
    date,
    startTime,
    endTime: timeOf(minutesOf(startTime) + defaultDurationMinutes),
    locationId: catalog.locations[0]?.locationId ?? "",
    programId: catalog.programs[0]?.programId ?? "",
    capacity: "",
    trainers: [],
    rulesMode: "defined",
    bookUntil: "0",
    cancelUntil: "start",
    cancelMinutes: "0",
    advance: "0",
    waitingList: "general",
  };
}

function rulesOf(draft: Draft): SessionBookingRules {
  if (draft.rulesMode === "defined") return "defined";
  return {
    bookUntilMinutesBefore: Number(draft.bookUntil) || 0,
    cancelUntil:
      draft.cancelUntil === "custom"
        ? { minutesBefore: Number(draft.cancelMinutes) || 0 }
        : draft.cancelUntil,
    advanceMinutes: Number(draft.advance) || 0,
  };
}

function sameRules(left: SessionBookingRules, right: SessionBookingRules): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function instantsOf(draft: Draft, timezone: string): { startAt: string; endAt: string } {
  const startAt = isoAt(draft.date, draft.startTime, timezone);
  let endMs = Date.parse(isoAt(draft.date, draft.endTime, timezone));
  if (endMs <= Date.parse(startAt)) endMs += 86_400_000;
  return { startAt, endAt: new Date(endMs).toISOString() };
}

export function SessionPanel({
  mode,
  session,
  catalog,
  staff,
  timezone,
  defaults,
  canEdit,
  onSaved,
  onCancelled,
  onClose,
}: SessionPanelProps): ReactElement {
  const [current, setCurrent] = useState<"create" | "edit">(mode);
  const [draft, setDraft] = useState<Draft>(() =>
    draftFor(mode, session, catalog, timezone, defaults),
  );
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = current === "edit" && session !== undefined;
  const locked = editing;

  function patch(change: Partial<Draft>): void {
    setDraft((previous) => ({ ...previous, ...change }));
  }

  function toggleTrainer(staffKey: string): void {
    setDraft((previous) => {
      const wanted = new Set(previous.trainers);
      if (wanted.has(staffKey)) wanted.delete(staffKey);
      else wanted.add(staffKey);
      return {
        ...previous,
        trainers: staff.map((row) => row.staffKey).filter((key) => wanted.has(key)),
      };
    });
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const { startAt, endAt } = instantsOf(draft, timezone);
    const capacity = draft.capacity.trim() === "" ? null : Number(draft.capacity);
    const instructorIds = draft.trainers;
    const bookingRules = rulesOf(draft);
    try {
      if (editing && session) {
        const changes: { -readonly [K in keyof UpdateSessionInput]: UpdateSessionInput[K] } = {
          sessionId: session.sessionId,
        };
        if (Date.parse(startAt) !== Date.parse(session.startAt)) changes.startAt = startAt;
        if (Date.parse(endAt) !== Date.parse(session.endAt)) changes.endAt = endAt;
        if (capacity !== session.capacity) changes.capacity = capacity;
        if ((instructorIds[0] ?? "") !== session.instructorId)
          changes.instructorId = instructorIds[0] ?? "";
        const currentTrainers = session.instructorIds ?? [session.instructorId];
        if (currentTrainers.join("|") !== instructorIds.join("|"))
          changes.instructorIds = instructorIds;
        if (!sameRules(bookingRules, session.bookingRules ?? "defined"))
          changes.bookingRules = bookingRules;
        if (draft.waitingList !== (session.waitingList ?? "general"))
          changes.waitingList = draft.waitingList;
        if (Object.keys(changes).length === 1) {
          onClose();
          return;
        }
        onSaved(await updateSession(changes));
        return;
      }
      const program = catalog.programs.find((row) => row.programId === draft.programId);
      const input: CreateSessionInput = {
        programId: draft.programId,
        locationId: draft.locationId,
        instructorId: instructorIds[0] ?? "",
        title: program?.name ?? "Class",
        startAt,
        endAt,
        capacity,
        instructorIds,
        bookingRules,
        waitingList: draft.waitingList,
      };
      onSaved(await saveSession(input));
    } catch (failure) {
      setError(messageOf(failure, "Unable to save the class"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancellation(): Promise<void> {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      onCancelled(await cancelSession(session.sessionId, reason.trim()));
    } catch (failure) {
      setError(messageOf(failure, "Unable to cancel the class"));
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !canEdit;

  return (
    <dialog open className="cs-dialog cs-session-dialog" aria-labelledby={dialogTitleId}>
      <h2 id={dialogTitleId}>Create classes/services</h2>
      {error === null ? null : (
        <p className="cs-notice" data-kind="error" role="alert">
          {error}
        </p>
      )}
      <div className="cs-session-body">
        <div className="cs-session-form">
          <h3>When</h3>
          <div className="cs-form-row">
            <label className="cs-field">
              <span>Date</span>
              <input
                type="date"
                value={draft.date}
                disabled={readOnly}
                onChange={(event) => patch({ date: event.target.value })}
              />
            </label>
            <label className="cs-field">
              <span>Start time</span>
              <input
                type="time"
                value={draft.startTime}
                disabled={readOnly}
                onChange={(event) => patch({ startTime: event.target.value })}
              />
            </label>
            <label className="cs-field">
              <span>End time</span>
              <input
                type="time"
                value={draft.endTime}
                disabled={readOnly}
                onChange={(event) => patch({ endTime: event.target.value })}
              />
            </label>
          </div>
          <h3>Class and location</h3>
          <div className="cs-form-row">
            <label className="cs-field">
              <span>Class/service location</span>
              <select
                value={draft.locationId}
                disabled={readOnly || locked}
                title={locked ? lockedHint : undefined}
                onChange={(event) => patch({ locationId: event.target.value })}
              >
                {catalog.locations.map((location) => (
                  <option key={location.locationId} value={location.locationId}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cs-field">
              <span>Class/service type</span>
              <select
                value={draft.programId}
                disabled={readOnly || locked}
                title={locked ? lockedHint : undefined}
                onChange={(event) => patch({ programId: event.target.value })}
              >
                {catalog.programs.map((program) => (
                  <option key={program.programId} value={program.programId}>
                    {program.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="cs-field">
              <label htmlFor="cs-capacity">Maximum capacity</label>
              <input
                id="cs-capacity"
                type="number"
                min={0}
                value={draft.capacity}
                disabled={readOnly}
                aria-describedby="cs-capacity-help"
                onChange={(event) => patch({ capacity: event.target.value })}
              />
              <small id="cs-capacity-help">Leave empty for no limit</small>
            </div>
          </div>
          <h3>Trainers</h3>
          <ul className="cs-trainers">
            {staff.map((row) => (
              <li key={row.staffKey}>
                <label className="cs-check">
                  <input
                    type="checkbox"
                    checked={draft.trainers.includes(row.staffKey)}
                    disabled={readOnly}
                    onChange={() => toggleTrainer(row.staffKey)}
                  />
                  {row.staffKey}
                </label>
              </li>
            ))}
          </ul>
          <h3>Booking rules</h3>
          <div className="cs-form-row">
            <label className="cs-field">
              <span>Booking and cancellation</span>
              <select
                value={draft.rulesMode}
                disabled={readOnly}
                onChange={(event) =>
                  patch({ rulesMode: event.target.value === "custom" ? "custom" : "defined" })
                }
              >
                <option value="defined">According to the defined rules</option>
                <option value="custom">Specific rules</option>
              </select>
            </label>
            <label className="cs-field">
              <span>Waiting list for registrations</span>
              <select
                value={draft.waitingList}
                disabled={readOnly}
                onChange={(event) => patch({ waitingList: event.target.value as WaitingListMode })}
              >
                {waitingListModes.map((option) => (
                  <option key={option} value={option}>
                    {option === "general" ? "General" : option === "on" ? "On" : "Off"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {draft.rulesMode === "custom" ? (
            <div className="cs-form-row">
              <label className="cs-field">
                <span>Allow bookings until (minutes before)</span>
                <input
                  type="number"
                  min={0}
                  value={draft.bookUntil}
                  disabled={readOnly}
                  onChange={(event) => patch({ bookUntil: event.target.value })}
                />
              </label>
              <label className="cs-field">
                <span>Allow cancellations until</span>
                <select
                  value={draft.cancelUntil}
                  disabled={readOnly}
                  onChange={(event) => patch({ cancelUntil: event.target.value as CancelUntil })}
                >
                  <option value="start">The start of the class</option>
                  <option value="end">The end of the class</option>
                  <option value="custom">A number of minutes before</option>
                </select>
              </label>
              {draft.cancelUntil === "custom" ? (
                <label className="cs-field">
                  <span>Allow cancellations until (minutes before)</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.cancelMinutes}
                    disabled={readOnly}
                    onChange={(event) => patch({ cancelMinutes: event.target.value })}
                  />
                </label>
              ) : null}
              <label className="cs-field">
                <span>Allow bookings with an advance of (minutes)</span>
                <input
                  type="number"
                  min={0}
                  value={draft.advance}
                  disabled={readOnly}
                  onChange={(event) => patch({ advance: event.target.value })}
                />
              </label>
            </div>
          ) : null}
          {confirming ? (
            <div className="cs-form-row cs-confirm">
              <label className="cs-field">
                <span>Reason</span>
                <input
                  type="text"
                  value={reason}
                  maxLength={200}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="cs-button cs-button-primary"
                disabled={busy || reason.trim().length < 2}
                onClick={() => void confirmCancellation()}
              >
                Confirm
              </button>
            </div>
          ) : null}
        </div>
        {editing && session ? <RegistrationsPanel session={session} canEdit={canEdit} /> : null}
      </div>
      <div className="cs-dialog-actions">
        {canEdit && editing ? (
          <>
            <button
              type="button"
              className="cs-button"
              onClick={() => setConfirming((previous) => !previous)}
            >
              Delete
            </button>
            <button type="button" className="cs-button" disabled title="Coming with announcements">
              Message
            </button>
            <button type="button" className="cs-button" onClick={() => setCurrent("create")}>
              Copy
            </button>
          </>
        ) : null}
        <button type="button" className="cs-button" onClick={onClose}>
          Cancel
        </button>
        {canEdit ? (
          <button
            type="button"
            className="cs-button cs-button-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {editing ? "Edit" : "Create"}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
