"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  BookingRecord,
  ClassRecord,
  CreateClassInput,
  CreateSessionInput,
  SessionRecord,
  UpdateClassInput,
} from "@bpt-jersey/domain/schedule";
import type { AdminDirectoryRow } from "@bpt-jersey/domain/members/directory";

import { listMemberships, type AdminMembership } from "../../../lib/membership-admin-client";
import { listMembers } from "../../../lib/members-client";
import {
  cancelBooking,
  cancelSession,
  generateSessions,
  getScheduleCatalog,
  listClasses,
  listSessionBookings,
  listSessions,
  requestBooking,
  saveClass,
  saveSession,
  updateClass,
  type ScheduleCatalogResponse,
} from "../../../lib/schedule-client";
import { listStaffProfiles, type StaffProfileProjection } from "../../../lib/staff-client";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import {
  ScheduleDialog,
  type ClassDraft,
  type ScheduleDialogState,
  type SessionDraft,
} from "./classes-dialog";

import "../admin.css";
import "./classes.css";

type LoadStatus = "loading" | "ready" | "error";
type Notice = Readonly<{ kind: "success" | "error"; message: string }>;
type BookingState =
  | Readonly<{ status: "idle" | "loading" | "error" }>
  | Readonly<{ status: "ready"; bookings: readonly BookingRecord[] }>;

const dayLabels = Object.freeze([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

function dateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function sessionQuery(fromDate: string, toDate: string) {
  return {
    from: fromDate + "T00:00:00.000Z",
    to: toDate + "T23:59:59.999Z",
  } as const;
}

function replaceById<T>(items: readonly T[], item: T, id: (value: T) => string): readonly T[] {
  const found = items.some((candidate) => id(candidate) === id(item));
  return Object.freeze(
    found
      ? items.map((candidate) => (id(candidate) === id(item) ? item : candidate))
      : [...items, item],
  );
}

function mergeSessions(
  current: readonly SessionRecord[],
  received: readonly SessionRecord[],
): readonly SessionRecord[] {
  return received.reduce(
    (result, session) => replaceById(result, session, (item) => item.sessionId),
    current,
  );
}

function newClassDraft(record?: ClassRecord): ClassDraft {
  if (record) {
    return Object.freeze({
      name: record.name,
      programId: record.programId,
      locationId: record.locationId,
      dayOfWeek: record.recurrenceRule.dayOfWeek,
      startTime: record.recurrenceRule.startTime,
      durationMinutes: record.recurrenceRule.durationMinutes,
      instructorIds: Object.freeze([...record.instructorIds]),
      capacity: record.capacity,
      minParticipants: record.minParticipants,
      active: record.active,
    });
  }
  return Object.freeze({
    name: "",
    programId: "",
    locationId: "",
    dayOfWeek: 1,
    startTime: "",
    durationMinutes: 60,
    instructorIds: Object.freeze([]),
    capacity: 20,
    minParticipants: 4,
    active: true,
  });
}

function newSessionDraft(): SessionDraft {
  return Object.freeze({
    classId: "",
    programId: "",
    locationId: "",
    instructorId: "",
    title: "",
    startAt: "",
    endAt: "",
    capacity: 20,
    minParticipants: 4,
    isSeminar: false,
  });
}

function localDateTimeToIso(value: string): string {
  const result = new Date(value);
  if (value.length === 0 || Number.isNaN(result.getTime())) throw new Error("Invalid date");
  return result.toISOString();
}

function formatSessionStart(value: string, timezone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid connected date";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

export function ClassesPage() {
  const initialRange = useMemo(() => {
    const today = new Date();
    return { fromDate: dateInputValue(today), toDate: dateInputValue(addDays(today, 30)) };
  }, []);
  const [range, setRange] = useState(initialRange);
  const [catalog, setCatalog] = useState<ScheduleCatalogResponse>();
  const [classes, setClasses] = useState<readonly ClassRecord[]>([]);
  const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
  const [members, setMembers] = useState<readonly AdminDirectoryRow[]>([]);
  const [memberPagePartial, setMemberPagePartial] = useState(false);
  const [memberships, setMemberships] = useState<readonly AdminMembership[]>([]);
  const [staff, setStaff] = useState<readonly StaffProfileProjection[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [sessionStatus, setSessionStatus] = useState<LoadStatus>("ready");
  const [notice, setNotice] = useState<Notice>();
  const [dialog, setDialog] = useState<ScheduleDialogState>();
  const [dialogError, setDialogError] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [bookingState, setBookingState] = useState<BookingState>({ status: "idle" });
  const [bookingStudentId, setBookingStudentId] = useState("");
  const [bookingMembershipId, setBookingMembershipId] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const bookingRequest = useRef(0);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getScheduleCatalog(),
      listClasses(),
      listSessions(sessionQuery(initialRange.fromDate, initialRange.toDate)),
      listMembers(50),
      listMemberships(),
      listStaffProfiles(),
    ]).then(
      ([nextCatalog, nextClasses, nextSessions, memberPage, nextMemberships, nextStaff]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setClasses(nextClasses);
        setSessions(nextSessions);
        setMembers(memberPage.rows);
        setMemberPagePartial(memberPage.nextCursor !== undefined);
        setMemberships(nextMemberships);
        setStaff(nextStaff);
        setLoadStatus("ready");
      },
      () => {
        if (active) setLoadStatus("error");
      },
    );
    return () => {
      active = false;
    };
  }, [initialRange]);

  const programNames = useMemo(
    () => new Map(catalog?.programs.map((item) => [item.programId, item.name]) ?? []),
    [catalog],
  );
  const locations = useMemo(
    () => new Map(catalog?.locations.map((item) => [item.locationId, item]) ?? []),
    [catalog],
  );
  const memberNames = useMemo(
    () => new Map(members.map((item) => [item.studentId, item.fullName])),
    [members],
  );
  const activeStaff = useMemo(
    () => staff.filter((item) => item.active && item.status === "active"),
    [staff],
  );
  const activeMembers = useMemo(
    () => members.filter((item) => item.active && item.status === "active"),
    [members],
  );
  const selectedSession = sessions.find((item) => item.sessionId === selectedSessionId);
  const availableMemberships = memberships.filter(
    (item) =>
      item.studentId === bookingStudentId && (item.status === "active" || item.status === "trial"),
  );

  function openDialog(next: ScheduleDialogState): void {
    setDialogError("");
    setDialog(next);
  }

  function closeDialog(): void {
    if (!dialogBusy) {
      setDialog(undefined);
      setDialogError("");
    }
  }

  async function refreshSessions(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSessionStatus("loading");
    try {
      setSessions(await listSessions(sessionQuery(range.fromDate, range.toDate)));
      setSessionStatus("ready");
    } catch {
      setSessionStatus("error");
    }
  }

  async function submitClass(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (dialog?.kind !== "class") return;
    const { draft } = dialog;
    if (
      !draft.programId ||
      !draft.locationId ||
      draft.instructorIds.length === 0 ||
      draft.minParticipants > draft.capacity
    ) {
      setDialogError("Complete the connected program, location, coach, and capacity fields.");
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    try {
      if (dialog.mode === "create") {
        const input: CreateClassInput = {
          programId: draft.programId,
          locationId: draft.locationId,
          name: draft.name.trim(),
          recurrenceRule: {
            dayOfWeek: draft.dayOfWeek,
            startTime: draft.startTime,
            durationMinutes: draft.durationMinutes,
          },
          instructorIds: draft.instructorIds,
          capacity: draft.capacity,
          minParticipants: draft.minParticipants,
        };
        const created = await saveClass(input);
        setClasses((current) => replaceById(current, created, (item) => item.classId));
        setNotice({ kind: "success", message: "Class created." });
      } else {
        if (!dialog.classId) throw new Error("Missing class");
        const input: UpdateClassInput = {
          classId: dialog.classId,
          name: draft.name.trim(),
          instructorIds: draft.instructorIds,
          capacity: draft.capacity,
          minParticipants: draft.minParticipants,
          active: draft.active,
        };
        const updated = await updateClass(input);
        setClasses((current) => replaceById(current, updated, (item) => item.classId));
        setNotice({ kind: "success", message: "Class updated." });
      }
      setDialog(undefined);
    } catch {
      setDialogError(
        dialog.mode === "create"
          ? "Unable to create the class. Review the fields and try again."
          : "Unable to update the class. Review the fields and try again.",
      );
    } finally {
      setDialogBusy(false);
    }
  }

  async function submitSession(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (dialog?.kind !== "session") return;
    const { draft } = dialog;
    if (
      !draft.programId ||
      !draft.locationId ||
      !draft.instructorId ||
      draft.minParticipants > draft.capacity
    ) {
      setDialogError("Complete the connected program, location, coach, and capacity fields.");
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    try {
      const input: CreateSessionInput = {
        ...(draft.classId ? { classId: draft.classId } : {}),
        programId: draft.programId,
        locationId: draft.locationId,
        instructorId: draft.instructorId,
        title: draft.title.trim(),
        startAt: localDateTimeToIso(draft.startAt),
        endAt: localDateTimeToIso(draft.endAt),
        capacity: draft.capacity,
        minParticipants: draft.minParticipants,
        isSeminar: draft.isSeminar,
      };
      const created = await saveSession(input);
      setSessions((current) => replaceById(current, created, (item) => item.sessionId));
      setNotice({ kind: "success", message: "Session created." });
      setDialog(undefined);
    } catch {
      setDialogError("Unable to create the session. Review the fields and try again.");
    } finally {
      setDialogBusy(false);
    }
  }

  async function submitGenerate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (dialog?.kind !== "generate") return;
    const source = classes.find((item) => item.classId === dialog.classId);
    const location = source ? locations.get(source.locationId) : undefined;
    if (!source || !location) {
      setDialogError("The connected class location is unavailable. Refresh before trying again.");
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    try {
      const generated = await generateSessions({
        classId: source.classId,
        fromDate: dialog.fromDate,
        toDate: dialog.toDate,
        timezone: location.timezone,
      });
      setSessions((current) => mergeSessions(current, generated));
      setNotice({
        kind: "success",
        message:
          String(generated.length) +
          (generated.length === 1 ? " session generated." : " sessions generated."),
      });
      setDialog(undefined);
    } catch {
      setDialogError("Unable to generate sessions. Review the date range and try again.");
    } finally {
      setDialogBusy(false);
    }
  }

  async function submitCancellation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (dialog?.kind !== "cancel-session" && dialog?.kind !== "cancel-booking") return;
    setDialogBusy(true);
    setDialogError("");
    try {
      if (dialog.kind === "cancel-session") {
        const cancelled = await cancelSession(dialog.sessionId, dialog.reason);
        setSessions((current) => replaceById(current, cancelled, (item) => item.sessionId));
        setNotice({ kind: "success", message: "Session cancelled." });
      } else {
        const cancelled = await cancelBooking({
          sessionId: dialog.booking.sessionId,
          studentId: dialog.booking.studentId,
          reason: dialog.reason,
        });
        setBookingState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                bookings: replaceById(current.bookings, cancelled, (item) => item.bookingId),
              }
            : current,
        );
        setNotice({ kind: "success", message: "Reservation cancelled." });
      }
      setDialog(undefined);
    } catch {
      setDialogError(
        dialog.kind === "cancel-session"
          ? "Unable to cancel the session. Its current backend rules may prevent this action."
          : "Unable to cancel the reservation. Its cutoff or current state may prevent this action.",
      );
    } finally {
      setDialogBusy(false);
    }
  }

  async function showBookings(session: SessionRecord): Promise<void> {
    const request = bookingRequest.current + 1;
    bookingRequest.current = request;
    setSelectedSessionId(session.sessionId);
    setBookingStudentId("");
    setBookingMembershipId("");
    setBookingState({ status: "loading" });
    try {
      const bookings = await listSessionBookings(session.sessionId);
      if (bookingRequest.current === request) setBookingState({ status: "ready", bookings });
    } catch {
      if (bookingRequest.current === request) setBookingState({ status: "error" });
    }
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedSession || !bookingStudentId || !bookingMembershipId) return;
    setBookingBusy(true);
    setNotice(undefined);
    try {
      const created = await requestBooking({
        sessionId: selectedSession.sessionId,
        studentId: bookingStudentId,
        membershipId: bookingMembershipId,
      });
      setBookingState((current) => ({
        status: "ready",
        bookings:
          current.status === "ready"
            ? replaceById(current.bookings, created, (item) => item.bookingId)
            : Object.freeze([created]),
      }));
      setNotice({ kind: "success", message: "Reservation created." });
      setBookingStudentId("");
      setBookingMembershipId("");
    } catch {
      setNotice({
        kind: "error",
        message:
          "Unable to create the reservation. Capacity, cutoff, membership, or quorum rules may prevent it.",
      });
    } finally {
      setBookingBusy(false);
    }
  }

  if (loadStatus === "loading") {
    return (
      <p className="admin-report-state" role="status">
        Loading connected class operations...
      </p>
    );
  }
  if (loadStatus === "error" || !catalog) {
    return (
      <section className="admin-module-page" aria-labelledby="classes-title">
        <AdminSectionHeader
          description="Class operations could not be loaded. No preview or synthetic records are shown."
          eyebrow="Classes / Connected source"
          title="Classes & sessions"
        />
        <p className="schedule-admin-notice schedule-admin-notice-error" role="alert">
          Unable to load connected class operations. Refresh and try again.
        </p>
      </section>
    );
  }

  return (
    <section className="admin-module-page schedule-admin-page" aria-labelledby="classes-title">
      <AdminSectionHeader
        actions={
          <>
            <button
              className="schedule-admin-button schedule-admin-button-secondary"
              onClick={() => openDialog({ kind: "session", draft: newSessionDraft() })}
              type="button"
            >
              Create session
            </button>
            <button
              className="schedule-admin-button"
              onClick={() => openDialog({ kind: "class", mode: "create", draft: newClassDraft() })}
              type="button"
            >
              Create class
            </button>
          </>
        }
        description="Configure recurring classes, materialize sessions, and manage connected reservations."
        eyebrow="Schedule / Live operations"
        title="Classes & sessions"
      />

      {notice ? (
        <p
          className={"schedule-admin-notice schedule-admin-notice-" + notice.kind}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <section aria-labelledby="catalog-title">
        <div className="schedule-admin-section-heading">
          <div>
            <p className="admin-eyebrow">Connected catalog</p>
            <h3 id="catalog-title">Town / West</h3>
          </div>
          <span>{catalog.programs.filter((program) => program.active).length} active programs</span>
        </div>
        <div className="schedule-admin-catalog">
          {catalog.locations.map((location) => (
            <article className="schedule-admin-location" key={location.locationId}>
              <div>
                <strong>{location.name}</strong>
                <span>{location.address}</span>
              </div>
              <AdminStatusBadge status={location.active ? "active" : "inactive"} />
              <small>{location.timezone}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel-card" aria-labelledby="class-list-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Recurring setup</p>
            <h3 id="class-list-title">Class catalog</h3>
          </div>
          <span className="admin-status-badge admin-status-active">Connected</span>
        </div>
        {classes.length === 0 ? (
          <p className="admin-empty-state">No connected classes are configured.</p>
        ) : (
          <div className="admin-data-table-wrap">
            <table className="admin-data-table">
              <caption className="visually-hidden">Configured classes</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Program / center</th>
                  <th scope="col">Recurrence</th>
                  <th scope="col">Capacity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((item) => (
                  <tr key={item.classId}>
                    <td data-label="Class">
                      <strong>{item.name}</strong>
                      <small className="schedule-admin-block">
                        {item.instructorIds.join(", ")}
                      </small>
                    </td>
                    <td data-label="Program / center">
                      {programNames.get(item.programId) ?? "Program unavailable"}
                      <small className="schedule-admin-block">
                        {locations.get(item.locationId)?.name ?? "Location unavailable"}
                      </small>
                    </td>
                    <td data-label="Recurrence">
                      {dayLabels[item.recurrenceRule.dayOfWeek - 1]} ·{" "}
                      {item.recurrenceRule.startTime}
                      <small className="schedule-admin-block">
                        {item.recurrenceRule.durationMinutes} minutes
                      </small>
                    </td>
                    <td data-label="Capacity">
                      {item.minParticipants} min / {item.capacity} max
                    </td>
                    <td data-label="Status">
                      <AdminStatusBadge status={item.active ? "active" : "inactive"} />
                    </td>
                    <td data-label="Actions">
                      <div className="schedule-admin-row-actions">
                        <button
                          aria-label={"Edit " + item.name}
                          className="schedule-admin-text-button"
                          onClick={() =>
                            openDialog({
                              kind: "class",
                              mode: "edit",
                              classId: item.classId,
                              draft: newClassDraft(item),
                            })
                          }
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          aria-label={"Generate sessions for " + item.name}
                          className="schedule-admin-text-button"
                          disabled={!item.active}
                          onClick={() =>
                            openDialog({
                              kind: "generate",
                              classId: item.classId,
                              fromDate: range.fromDate,
                              toDate: range.toDate,
                            })
                          }
                          type="button"
                        >
                          Generate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-panel-card" aria-labelledby="session-list-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Operational window</p>
            <h3 id="session-list-title">Sessions</h3>
          </div>
          <span
            className={
              "admin-status-badge " +
              (sessionStatus === "error" ? "admin-status-cancelled" : "admin-status-active")
            }
          >
            {sessionStatus === "loading"
              ? "Loading"
              : sessionStatus === "error"
                ? "Unavailable"
                : "Connected"}
          </span>
        </div>
        <form
          aria-label="Session date range"
          className="schedule-admin-range"
          onSubmit={(event) => void refreshSessions(event)}
        >
          <label>
            From
            <input
              onChange={(event) =>
                setRange((current) => ({ ...current, fromDate: event.target.value }))
              }
              required
              type="date"
              value={range.fromDate}
            />
          </label>
          <label>
            To
            <input
              onChange={(event) =>
                setRange((current) => ({ ...current, toDate: event.target.value }))
              }
              required
              type="date"
              value={range.toDate}
            />
          </label>
          <button
            className="schedule-admin-button schedule-admin-button-secondary"
            disabled={sessionStatus === "loading"}
            type="submit"
          >
            Refresh sessions
          </button>
        </form>
        {sessionStatus === "error" ? (
          <p className="schedule-admin-notice schedule-admin-notice-error" role="alert">
            Unable to refresh sessions. Existing rows were not replaced.
          </p>
        ) : null}
        {sessions.length === 0 ? (
          <p className="admin-empty-state">No connected sessions exist in this window.</p>
        ) : (
          <div className="admin-data-table-wrap">
            <table className="admin-data-table">
              <caption className="visually-hidden">Scheduled sessions</caption>
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Starts</th>
                  <th scope="col">Center</th>
                  <th scope="col">Capacity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.sessionId}>
                    <td data-label="Session">
                      <strong>{session.title}</strong>
                      <small className="schedule-admin-block">
                        {programNames.get(session.programId) ?? "Program unavailable"}
                      </small>
                    </td>
                    <td data-label="Starts">
                      {formatSessionStart(
                        session.startAt,
                        locations.get(session.locationId)?.timezone,
                      )}
                    </td>
                    <td data-label="Center">
                      {locations.get(session.locationId)?.name ?? "Location unavailable"}
                    </td>
                    <td data-label="Capacity">
                      {session.minParticipants} min / {session.capacity} max
                    </td>
                    <td data-label="Status">
                      <AdminStatusBadge status={session.status} />
                    </td>
                    <td data-label="Actions">
                      <div className="schedule-admin-row-actions">
                        <button
                          aria-label={"View reservations for " + session.title}
                          className="schedule-admin-text-button"
                          onClick={() => void showBookings(session)}
                          type="button"
                        >
                          Reservations
                        </button>
                        {session.status === "scheduled" || session.status === "active" ? (
                          <button
                            aria-label={"Cancel " + session.title}
                            className="schedule-admin-text-button schedule-admin-danger-text"
                            onClick={() =>
                              openDialog({
                                kind: "cancel-session",
                                sessionId: session.sessionId,
                                label: session.title,
                                reason: "",
                              })
                            }
                            type="button"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedSession ? (
        <section
          className="admin-panel-card schedule-admin-roster"
          aria-labelledby="reservation-title"
        >
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">Selected session</p>
              <h3 id="reservation-title">Reservations</h3>
              <p>{selectedSession.title}</p>
            </div>
            <AdminStatusBadge status={selectedSession.status} />
          </div>
          <form
            aria-label="Create reservation"
            className="schedule-admin-booking-form"
            onSubmit={(event) => void submitBooking(event)}
          >
            <label>
              Canonical student
              <select
                onChange={(event) => {
                  setBookingStudentId(event.target.value);
                  setBookingMembershipId("");
                }}
                required
                value={bookingStudentId}
              >
                <option value="">Select a student</option>
                {activeMembers.map((member) => (
                  <option key={member.studentId} value={member.studentId}>
                    {member.fullName} · {member.trainingCenter}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Eligible membership
              <select
                disabled={!bookingStudentId}
                onChange={(event) => setBookingMembershipId(event.target.value)}
                required
                value={bookingMembershipId}
              >
                <option value="">Select a membership</option>
                {availableMemberships.map((membership) => (
                  <option key={membership.membershipId} value={membership.membershipId}>
                    {membership.planId} · {membership.status}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="schedule-admin-button"
              disabled={bookingBusy || !bookingMembershipId}
              type="submit"
            >
              {bookingBusy ? "Booking..." : "Create reservation"}
            </button>
          </form>
          {memberPagePartial ? (
            <p className="admin-report-state">
              Showing the first connected directory page. Use member search if the student is not
              listed.
            </p>
          ) : null}
          {bookingState.status === "loading" ? (
            <p role="status">Loading connected reservations...</p>
          ) : null}
          {bookingState.status === "error" ? (
            <p className="schedule-admin-notice schedule-admin-notice-error" role="alert">
              Unable to load reservations for this session.
            </p>
          ) : null}
          {bookingState.status === "ready" && bookingState.bookings.length === 0 ? (
            <p className="admin-empty-state">No connected reservations for this session.</p>
          ) : null}
          {bookingState.status === "ready" && bookingState.bookings.length > 0 ? (
            <ul className="schedule-admin-booking-list">
              {bookingState.bookings.map((booking) => (
                <li key={booking.bookingId}>
                  <div>
                    <strong>
                      {memberNames.get(booking.studentId) ??
                        "Student unavailable in loaded directory"}
                    </strong>
                    <span>
                      {memberships.find(
                        (membership) => membership.membershipId === booking.membershipId,
                      )?.planId ?? "Membership unavailable"}
                    </span>
                  </div>
                  <AdminStatusBadge status={booking.status} />
                  {booking.status !== "cancelled" ? (
                    <button
                      className="schedule-admin-text-button schedule-admin-danger-text"
                      onClick={() =>
                        openDialog({
                          kind: "cancel-booking",
                          booking,
                          label: memberNames.get(booking.studentId) ?? "this student",
                          reason: "",
                        })
                      }
                      type="button"
                    >
                      Cancel reservation
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {dialog ? (
        <ScheduleDialog
          activeStaff={activeStaff}
          busy={dialogBusy}
          catalog={catalog}
          classes={classes}
          dialog={dialog}
          error={dialogError}
          onChange={setDialog}
          onClose={closeDialog}
          onSubmitCancellation={(event) => void submitCancellation(event)}
          onSubmitClass={(event) => void submitClass(event)}
          onSubmitGenerate={(event) => void submitGenerate(event)}
          onSubmitSession={(event) => void submitSession(event)}
        />
      ) : null}
    </section>
  );
}

export default function ClassesRoute() {
  return <ClassesPage />;
}
