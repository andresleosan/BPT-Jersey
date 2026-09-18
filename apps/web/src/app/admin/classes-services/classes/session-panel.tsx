"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

import type {
  CreateSessionInput,
  SessionRecord,
  UpdateSessionInput,
} from "@bpt-jersey/domain/schedule";
import {
  localInstant,
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
import { trainerName, trainerOptions, type StaffOption } from "./trainer-options";
import { localParts } from "./week-grid";

export type { StaffOption } from "./trainer-options";

export type SessionPanelProps = Readonly<{
  mode: "create" | "edit";
  session?: SessionRecord | undefined;
  catalog: ScheduleCatalogResponse;
  staff: readonly StaffOption[];
  timezone: string;
  defaults?: Readonly<{ date: string; startTime: string }> | undefined;
  canEdit: boolean;
  canReadMemberships: boolean;
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
  minParticipants: string;
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
  return new Date(localInstant(date, time, timezone)).toISOString();
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
      minParticipants: String(session.minParticipants ?? 4),
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
    minParticipants: "4",
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
  return {
    startAt: isoAt(draft.date, draft.startTime, timezone),
    endAt: isoAt(draft.date, draft.endTime, timezone),
  };
}

export function SessionPanel({
  mode,
  session,
  catalog,
  staff,
  timezone,
  defaults,
  canEdit,
  canReadMemberships,
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

  const [view, setView] = useState<"details" | "registrations">("details");
  const [registrationsLoaded, setRegistrationsLoaded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const editing = current === "edit" && session !== undefined;
  const locked = editing;

  function patch(change: Partial<Draft>): void {
    setDraft((previous) => ({ ...previous, ...change }));
  }

  const trainers = trainerOptions(staff).filter((row) => row.active && row.status === "active");
  const trainerKeys = [...new Set([...trainers.map((row) => row.staffKey), ...draft.trainers])];

  function toggleTrainer(staffKey: string): void {
    setDraft((previous) => {
      const wanted = new Set(previous.trainers);
      if (wanted.has(staffKey)) wanted.delete(staffKey);
      else wanted.add(staffKey);
      return {
        ...previous,
        trainers: [...wanted],
      };
    });
  }

  const capacityValue = Number(draft.capacity);
  const capacityInvalid =
    draft.capacity.trim() === "" ||
    !Number.isInteger(capacityValue) ||
    capacityValue < 1 ||
    capacityValue > 300;

  const minimumValue = Number(draft.minParticipants);
  const minimumInvalid =
    draft.minParticipants.trim() === "" ||
    !Number.isInteger(minimumValue) ||
    minimumValue < 0 ||
    minimumValue > 300;
  const minimumExceedsCapacity =
    !capacityInvalid && !minimumInvalid && minimumValue > capacityValue;
  const minimumError = minimumInvalid
    ? "Enter a minimum number of participants between 0 and 300"
    : minimumExceedsCapacity
      ? "Minimum participants cannot exceed maximum capacity"
      : null;

  async function submit(): Promise<void> {
    if (!canEdit || blocked) return;
    setBusy(true);
    setError(null);

    const capacity = capacityValue;
    const instructorIds = draft.trainers;
    const bookingRules = rulesOf(draft);
    try {
      const { startAt, endAt } = instantsOf(draft, timezone);
      if (editing && session) {
        const changes: { -readonly [K in keyof UpdateSessionInput]: UpdateSessionInput[K] } = {
          sessionId: session.sessionId,
        };
        if (Date.parse(startAt) !== Date.parse(session.startAt)) changes.startAt = startAt;
        if (Date.parse(endAt) !== Date.parse(session.endAt)) changes.endAt = endAt;
        if (capacity !== session.capacity) changes.capacity = capacity;
        if (minimumValue !== session.minParticipants) changes.minParticipants = minimumValue;
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
        minParticipants: minimumValue,
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
    if (!session || !canEdit || busy || reason.trim().length < 2) return;
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

  const readOnly = !canEdit || busy;
  const missingDateTime = !draft.date || !draft.startTime || !draft.endTime;
  const endsBeforeStart = minutesOf(draft.endTime) <= minutesOf(draft.startTime);
  const noTrainer = draft.trainers.length === 0;
  const blocked =
    busy ||
    missingDateTime ||
    endsBeforeStart ||
    noTrainer ||
    capacityInvalid ||
    minimumError !== null;

  return (
    <dialog
      ref={dialogRef}
      className="cs-dialog cs-session-dialog"
      aria-labelledby={dialogTitleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="cs-session-header">
        <div className="cs-session-heading">
          <div>
            <p className="cs-session-eyebrow">Classes &amp; services</p>
            <h2 id={dialogTitleId} ref={titleRef} tabIndex={-1}>
              {editing ? (canEdit ? "Edit session" : "Session details") : "Create session"}
            </h2>
          </div>
          <button
            type="button"
            className="cs-button"
            aria-label="Close session"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {editing ? (
          <div className="cs-session-switcher" aria-label="Session view">
            <button
              type="button"
              aria-pressed={view === "details"}
              disabled={busy}
              onClick={() => setView("details")}
            >
              Session details
            </button>
            <button
              type="button"
              aria-pressed={view === "registrations"}
              disabled={busy}
              onClick={() => {
                setRegistrationsLoaded(true);
                setView("registrations");
              }}
            >
              Registrations
            </button>
          </div>
        ) : null}
      </header>
      <div className="cs-session-scroll">
        {error === null ? null : (
          <p className="cs-notice" data-kind="error" role="alert">
            {error}
          </p>
        )}
        <div className="cs-session-body">
          <div className="cs-session-form" hidden={view !== "details"}>
            <h3>When</h3>
            <div className="cs-form-row cs-session-when">
              <label className="cs-field">
                <span>Date</span>
                <input
                  type="date"
                  value={draft.date}
                  aria-invalid={!draft.date}
                  aria-describedby={missingDateTime ? "cs-session-time-error" : undefined}
                  disabled={readOnly}
                  onChange={(event) => patch({ date: event.target.value })}
                />
              </label>
              <label className="cs-field">
                <span>Start time</span>
                <input
                  type="time"
                  value={draft.startTime}
                  aria-invalid={!draft.startTime}
                  aria-describedby={missingDateTime ? "cs-session-time-error" : undefined}
                  disabled={readOnly}
                  onChange={(event) => patch({ startTime: event.target.value })}
                />
              </label>
              <label className="cs-field">
                <span>End time</span>
                <input
                  type="time"
                  value={draft.endTime}
                  aria-invalid={!draft.endTime}
                  aria-describedby={missingDateTime ? "cs-session-time-error" : undefined}
                  disabled={readOnly}
                  onChange={(event) => patch({ endTime: event.target.value })}
                />
              </label>
            </div>
            {missingDateTime ? (
              <p id="cs-session-time-error" className="cs-notice" data-kind="error" role="alert">
                Enter a date, start time and end time.
              </p>
            ) : null}
            {endsBeforeStart ? (
              <p className="cs-notice" data-kind="error" role="alert">
                End time must be after the start time
              </p>
            ) : null}
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
            </div>
            {locked && canEdit ? (
              <p className="cs-session-help">To change the class or location, use Copy session.</p>
            ) : null}
            <h3>Session capacity</h3>
            <div className="cs-form-row">
              <div className="cs-field">
                <label htmlFor="cs-min-participants">Minimum participants</label>
                <input
                  id="cs-min-participants"
                  type="number"
                  inputMode="numeric"
                  required
                  min={0}
                  max={capacityInvalid ? 300 : capacityValue}
                  step={1}
                  value={draft.minParticipants}
                  disabled={readOnly}
                  aria-invalid={canEdit && minimumError !== null}
                  aria-describedby={
                    canEdit && minimumError !== null
                      ? "cs-min-participants-help cs-min-participants-error"
                      : "cs-min-participants-help"
                  }
                  onChange={(event) => patch({ minParticipants: event.target.value })}
                />
                <small id="cs-min-participants-help">
                  Minimum confirmed members needed for the session to run. 0 means no minimum.
                </small>
                {canEdit && minimumError !== null ? (
                  <p
                    id="cs-min-participants-error"
                    className="cs-notice"
                    data-kind="error"
                    role="alert"
                  >
                    {minimumError}
                  </p>
                ) : null}
              </div>
              <div className="cs-field">
                <label htmlFor="cs-capacity">Maximum capacity</label>
                <input
                  id="cs-capacity"
                  type="number"
                  inputMode="numeric"
                  required
                  min={1}
                  max={300}
                  step={1}
                  value={draft.capacity}
                  disabled={readOnly}
                  aria-invalid={canEdit && capacityInvalid}
                  aria-describedby={
                    canEdit && capacityInvalid
                      ? "cs-capacity-help cs-capacity-error"
                      : "cs-capacity-help"
                  }
                  onChange={(event) => patch({ capacity: event.target.value })}
                />
                <small id="cs-capacity-help">Maximum members who can book (1–300)</small>
                {canEdit && capacityInvalid ? (
                  <p id="cs-capacity-error" className="cs-notice" data-kind="error" role="alert">
                    Enter a maximum capacity between 1 and 300
                  </p>
                ) : null}
              </div>
            </div>
            <h3>Trainers</h3>
            <ul className="cs-trainers">
              {trainerKeys.map((key) => (
                <li key={key}>
                  <label className="cs-check">
                    <input
                      type="checkbox"
                      checked={draft.trainers.includes(key)}
                      disabled={readOnly}
                      onChange={() => toggleTrainer(key)}
                    />
                    {trainerName(key)}
                  </label>
                </li>
              ))}
            </ul>
            {canEdit && noTrainer ? (
              <p className="cs-notice" data-kind="error" role="alert">
                Choose at least one trainer
              </p>
            ) : null}
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
                  onChange={(event) =>
                    patch({ waitingList: event.target.value as WaitingListMode })
                  }
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
                    step={1}
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
                      step={1}
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
                    step={1}
                    value={draft.advance}
                    disabled={readOnly}
                    onChange={(event) => patch({ advance: event.target.value })}
                  />
                </label>
              </div>
            ) : null}
            {canEdit && editing ? (
              <div className="cs-session-secondary">
                <button
                  type="button"
                  className="cs-button"
                  disabled={busy}
                  onClick={() => {
                    setCurrent("create");
                    setConfirming(false);
                    setError(null);
                    setView("details");
                    setRegistrationsLoaded(false);
                    titleRef.current?.focus({ preventScroll: true });
                    const scroll = dialogRef.current?.querySelector(".cs-session-scroll");
                    if (scroll) scroll.scrollTop = 0;
                  }}
                >
                  Copy session
                </button>
                <button
                  type="button"
                  className="cs-button"
                  disabled={busy}
                  aria-expanded={confirming}
                  onClick={() => setConfirming((previous) => !previous)}
                >
                  {confirming ? "Keep session" : "Cancel session"}
                </button>
              </div>
            ) : null}
            {confirming ? (
              <div className="cs-form-row cs-session-cancellation">
                <label className="cs-field">
                  <span>Reason</span>
                  <input
                    type="text"
                    value={reason}
                    disabled={busy}
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
                  {busy ? "Cancelling…" : "Confirm cancellation"}
                </button>
              </div>
            ) : null}
          </div>
          {editing && session && registrationsLoaded ? (
            <div hidden={view !== "registrations"}>
              <RegistrationsPanel
                session={session}
                canEdit={canEdit && !busy}
                canReadMemberships={canReadMemberships}
              />
            </div>
          ) : null}
        </div>
      </div>
      <footer className="cs-dialog-actions cs-session-footer">
        <button type="button" className="cs-button" disabled={busy} onClick={onClose}>
          {canEdit && view === "details" ? "Discard changes" : "Close"}
        </button>
        {view === "registrations" ? (
          <button
            type="button"
            className="cs-button cs-button-primary"
            disabled={busy}
            onClick={() => setView("details")}
          >
            Back to details
          </button>
        ) : canEdit ? (
          <button
            type="button"
            className="cs-button cs-button-primary"
            disabled={blocked}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Create session"}
          </button>
        ) : null}
      </footer>
    </dialog>
  );
}
