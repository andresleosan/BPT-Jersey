"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AttendanceState as CanonicalAttendanceState,
  RecordCheckoutInput,
  SessionOperationalStatus,
  SessionOperationalView,
} from "@bpt-jersey/domain/schedule";

import {
  correctAttendance,
  getSessionOperationalView,
  listSessions,
  reconcileSessionNoShows,
  recordCheckIn,
  recordCheckout,
} from "../../../lib/schedule-client";
import { AdminFilterBar, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";
import { AttendanceDialog, type AttendanceDialogState } from "./attendance-dialog";

import "../admin.css";
import "./attendance.css";

type AttendanceRow = Readonly<{
  studentId: string;
  sessionId: string;
  sessionLabel: string;
  instructorId: string;
  checkIn: string;
  stateLabel: string;
  status: SessionOperationalStatus;
  hasAttendance: boolean;
}>;

type AttendanceLoadState =
  | { status: "loading"; date: string }
  | { status: "ready"; date: string; views: readonly SessionOperationalView[] }
  | { status: "error"; date: string };

const statusLabels: Readonly<Record<SessionOperationalStatus, string>> = {
  booked_not_arrived: "Pending",
  attended: "Present",
  late: "Late",
  absent: "Absent",
  no_show: "No-show",
  checked_out: "Checked out",
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayQuery(date: string) {
  return {
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  } as const;
}

async function loadAttendanceViews(date: string): Promise<readonly SessionOperationalView[]> {
  const sessions = await listSessions(dayQuery(date));
  return Promise.all(sessions.map((session) => getSessionOperationalView(session.sessionId)));
}

function rowsFromViews(views: readonly SessionOperationalView[]): readonly AttendanceRow[] {
  return views.flatMap((view) =>
    view.roster.map((student) => ({
      studentId: student.studentId,
      sessionId: view.session.sessionId,
      sessionLabel: `${view.session.title} (${view.session.startAt.slice(11, 16)})`,
      instructorId: view.session.instructorId,
      checkIn: student.attendance?.occurredAt.slice(11, 16) ?? "-",
      stateLabel: statusLabels[student.computedStatus],
      status: student.computedStatus,
      hasAttendance: student.attendance !== null,
    })),
  );
}

function correctionInitialState(status: SessionOperationalStatus): CanonicalAttendanceState {
  if (status === "late") return "late";
  if (status === "absent") return "absent";
  if (status === "no_show") return "no_show";
  return "attended";
}

const EMPTY_VIEWS: readonly SessionOperationalView[] = Object.freeze([]);

export function AttendancePage() {
  const [date, setDate] = useState(todayDate);
  const [session, setSession] = useState("All sessions");
  const [group, setGroup] = useState("All sessions");
  const [coach, setCoach] = useState("All instructors");
  const [stateFilter, setStateFilter] = useState("All states");
  const [data, setData] = useState<AttendanceLoadState>(() => ({
    status: "loading",
    date: todayDate(),
  }));
  const [dialog, setDialog] = useState<AttendanceDialogState>();
  const [dialogError, setDialogError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState<string>();

  useEffect(() => {
    let active = true;
    setData({ status: "loading", date });
    setOperationError("");
    setNotice("");
    void loadAttendanceViews(date).then(
      (views) => {
        if (active) setData({ status: "ready", date, views });
      },
      () => {
        if (active) setData({ status: "error", date });
      },
    );
    return () => {
      active = false;
    };
  }, [date]);

  const isLoading = data.date !== date || data.status === "loading";
  const views = useMemo(
    () => (!isLoading && data.status === "ready" ? data.views : EMPTY_VIEWS),
    [isLoading, data],
  );
  const rows = useMemo(() => rowsFromViews(views), [views]);
  const sessionOptions = useMemo(
    () => ["All sessions", ...new Set(rows.map((row) => row.sessionLabel))],
    [rows],
  );
  const groupOptions = useMemo(
    () => ["All sessions", ...new Set(rows.map((row) => row.sessionId))],
    [rows],
  );
  const coachOptions = useMemo(
    () => ["All instructors", ...new Set(rows.map((row) => row.instructorId))],
    [rows],
  );
  const stateOptions = useMemo(
    () => ["All states", ...new Set(rows.map((row) => row.stateLabel))],
    [rows],
  );
  const filteredRows = rows.filter(
    (item) =>
      (session === "All sessions" || item.sessionLabel === session) &&
      (group === "All sessions" || item.sessionId === group) &&
      (coach === "All instructors" || item.instructorId === coach) &&
      (stateFilter === "All states" || item.stateLabel === stateFilter),
  );
  const busy = busyKey !== undefined;

  async function refreshAfterSuccess(successMessage: string): Promise<void> {
    setData({ status: "loading", date });
    try {
      const nextViews = await loadAttendanceViews(date);
      setData({ status: "ready", date, views: nextViews });
      setNotice(successMessage);
    } catch {
      setData({ status: "error", date });
      setOperationError(
        `${successMessage} The connected roster could not be refreshed; reload before another action.`,
      );
    }
  }

  async function handleCheckIn(row: AttendanceRow): Promise<void> {
    setBusyKey(`check-in:${row.sessionId}:${row.studentId}`);
    setOperationError("");
    setNotice("");
    try {
      await recordCheckIn({
        sessionId: row.sessionId,
        studentId: row.studentId,
        method: "manual",
      });
      await refreshAfterSuccess(`Manual check-in recorded for ${row.studentId}.`);
    } catch {
      setOperationError("Unable to record manual check-in. Nothing was changed.");
    } finally {
      setBusyKey(undefined);
    }
  }

  async function handleNoShows(view: SessionOperationalView): Promise<void> {
    setBusyKey(`no-shows:${view.session.sessionId}`);
    setOperationError("");
    setNotice("");
    try {
      const result = await reconcileSessionNoShows(view.session.sessionId);
      const label = result.noShowsMarked === 1 ? "no-show" : "no-shows";
      await refreshAfterSuccess(
        `Marked ${result.noShowsMarked} ${label} for ${view.session.title}.`,
      );
    } catch {
      setOperationError("Unable to mark session no-shows. Nothing was changed.");
    } finally {
      setBusyKey(undefined);
    }
  }

  function openCorrection(row: AttendanceRow): void {
    setDialogError("");
    setOperationError("");
    setNotice("");
    setDialog({
      kind: "correction",
      sessionId: row.sessionId,
      studentId: row.studentId,
      currentStatus: row.status,
      newState: correctionInitialState(row.status),
      reason: "",
    });
  }

  function openCheckout(row: AttendanceRow): void {
    setDialogError("");
    setOperationError("");
    setNotice("");
    setDialog({
      kind: "checkout",
      sessionId: row.sessionId,
      studentId: row.studentId,
      method: "authorizedAdult",
      authorizedAdultId: "",
      authorizedAdultName: "",
      notes: "",
    });
  }

  function updateDialog(next: AttendanceDialogState): void {
    setDialog(next);
    setDialogError("");
  }

  async function submitDialog(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.kind === "correction") {
      const reason = dialog.reason.trim();
      if (!reason) {
        setDialogError("A correction reason is required.");
        return;
      }
      setBusyKey(`correction:${dialog.sessionId}:${dialog.studentId}`);
      setDialogError("");
      try {
        await correctAttendance({
          sessionId: dialog.sessionId,
          studentId: dialog.studentId,
          newState: dialog.newState,
          reason,
        });
        const studentId = dialog.studentId;
        setDialog(undefined);
        await refreshAfterSuccess(`Attendance corrected for ${studentId}.`);
      } catch {
        setDialogError("Unable to correct attendance. Nothing was changed.");
      } finally {
        setBusyKey(undefined);
      }
      return;
    }

    const authorizedAdultId = dialog.authorizedAdultId.trim();
    const authorizedAdultName = dialog.authorizedAdultName.trim();
    const notes = dialog.notes.trim();
    let input: RecordCheckoutInput;
    if (dialog.method === "authorizedAdult") {
      if (!authorizedAdultId || !authorizedAdultName) {
        setDialogError("Authorized adult ID and name are required.");
        return;
      }
      input = {
        sessionId: dialog.sessionId,
        studentId: dialog.studentId,
        method: "authorizedAdult",
        authorizedAdultId,
        authorizedAdultName,
      };
    } else if (dialog.method === "staffOverride") {
      if (!notes) {
        setDialogError("A staff override note is required.");
        return;
      }
      input = {
        sessionId: dialog.sessionId,
        studentId: dialog.studentId,
        method: "staffOverride",
        notes,
      };
    } else {
      input = {
        sessionId: dialog.sessionId,
        studentId: dialog.studentId,
        method: "independentRelease",
      };
    }

    setBusyKey(`checkout:${dialog.sessionId}:${dialog.studentId}`);
    setDialogError("");
    try {
      await recordCheckout(input);
      const studentId = dialog.studentId;
      setDialog(undefined);
      await refreshAfterSuccess(`Checkout recorded for ${studentId}.`);
    } catch {
      setDialogError("Unable to record checkout. Nothing was changed.");
    } finally {
      setBusyKey(undefined);
    }
  }

  const columns = [
    {
      key: "student",
      label: "Student ID",
      render: (item: AttendanceRow) => <strong>{item.studentId}</strong>,
    },
    { key: "group", label: "Session ID", render: (item: AttendanceRow) => item.sessionId },
    { key: "session", label: "Session", render: (item: AttendanceRow) => item.sessionLabel },
    { key: "coach", label: "Instructor ID", render: (item: AttendanceRow) => item.instructorId },
    { key: "checkIn", label: "Check-in", render: (item: AttendanceRow) => item.checkIn },
    {
      key: "state",
      label: "State",
      render: (item: AttendanceRow) => <AdminStatusBadge status={item.stateLabel} />,
    },
    {
      key: "actions",
      label: "Actions",
      render: (item: AttendanceRow) => (
        <div className="attendance-row-actions">
          {item.status === "booked_not_arrived" ? (
            <button
              aria-label={`Check in ${item.studentId}`}
              className="attendance-action-button attendance-action-button-primary"
              disabled={busy}
              onClick={() => void handleCheckIn(item)}
              type="button"
            >
              Check in
            </button>
          ) : null}
          {item.hasAttendance && item.status !== "checked_out" ? (
            <button
              aria-label={`Correct attendance for ${item.studentId}`}
              className="attendance-action-button"
              disabled={busy}
              onClick={() => openCorrection(item)}
              type="button"
            >
              Correct
            </button>
          ) : null}
          {item.status === "attended" || item.status === "late" ? (
            <button
              aria-label={`Check out ${item.studentId}`}
              className="attendance-action-button"
              disabled={busy}
              onClick={() => openCheckout(item)}
              type="button"
            >
              Checkout
            </button>
          ) : null}
        </div>
      ),
    },
  ] as const;

  return (
    <section className="admin-module-page attendance-page" aria-labelledby="attendance-title">
      <AdminSectionHeader
        description="Operate canonical session rosters: manual arrivals, corrections, no-shows, and verified student release."
        eyebrow="Attendance / Connected operations"
        title="Attendance"
      />

      <aside className="attendance-credential-note" aria-labelledby="credential-note-title">
        <span aria-hidden="true" className="attendance-credential-mark">
          ID
        </span>
        <div>
          <strong id="credential-note-title">Verified check-in only</strong>
          <p>
            QR and PIN check-in are unavailable until the backend exposes verifiable credentials.
            Use manual roster check-in; no code entered here is treated as identity proof.
          </p>
        </div>
      </aside>

      <AdminFilterBar>
        <label className="admin-filter-control">
          Date
          <input
            aria-label="Attendance date"
            disabled={busy}
            onChange={(event) => setDate(event.target.value)}
            type="date"
            value={date}
          />
        </label>
        <label className="admin-filter-control">
          Session
          <select
            aria-label="Attendance session"
            onChange={(event) => setSession(event.target.value)}
            value={session}
          >
            <option>All sessions</option>
            {sessionOptions.slice(1).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="admin-filter-control">
          Session ID
          <select
            aria-label="Attendance group"
            onChange={(event) => setGroup(event.target.value)}
            value={group}
          >
            <option>All sessions</option>
            {groupOptions.slice(1).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="admin-filter-control">
          Instructor
          <select
            aria-label="Attendance coach"
            onChange={(event) => setCoach(event.target.value)}
            value={coach}
          >
            <option>All instructors</option>
            {coachOptions.slice(1).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="admin-filter-control">
          State
          <select
            aria-label="Attendance state"
            onChange={(event) => setStateFilter(event.target.value)}
            value={stateFilter}
          >
            <option>All states</option>
            {stateOptions.slice(1).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </AdminFilterBar>

      {views.length > 0 ? (
        <section className="attendance-session-strip" aria-labelledby="session-operations-title">
          <div className="attendance-session-strip-heading">
            <div>
              <p className="admin-eyebrow">Session closeout</p>
              <h3 id="session-operations-title">Mark no-shows by session</h3>
            </div>
            <span>{views.length} connected</span>
          </div>
          <div className="attendance-session-list">
            {views.map((view) => (
              <article className="attendance-session-item" key={view.session.sessionId}>
                <div>
                  <strong>{view.session.title}</strong>
                  <span>
                    {view.session.startAt.slice(11, 16)} / {view.session.sessionId}
                  </span>
                </div>
                <p>
                  {view.summary.totalPendingArrival} pending · {view.summary.totalNoShows} no-show
                </p>
                <button
                  aria-label={`Mark no-shows for ${view.session.title}`}
                  className="attendance-action-button attendance-action-button-primary"
                  disabled={busy || view.session.status === "cancelled"}
                  onClick={() => void handleNoShows(view)}
                  type="button"
                >
                  {busyKey === `no-shows:${view.session.sessionId}`
                    ? "Marking..."
                    : "Mark no-shows"}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {operationError ? (
        <p className="attendance-operation-message attendance-operation-error" role="alert">
          {operationError}
        </p>
      ) : null}
      {notice ? (
        <p className="attendance-operation-message attendance-operation-success" role="status">
          {notice}
        </p>
      ) : null}

      <section className="admin-panel-card" aria-labelledby="attendance-table-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Canonical daily roster</p>
            <h3 id="attendance-table-title">Today&apos;s attendance</h3>
          </div>
          <span className="admin-status-badge admin-status-active">
            {data.status === "ready"
              ? "Connected"
              : data.status === "error"
                ? "Unavailable"
                : "Loading"}
          </span>
        </div>
        {isLoading ? <p role="status">Loading connected attendance...</p> : null}
        {!isLoading && data.status === "error" ? (
          <p className="admin-report-state" role="alert">
            Unable to load connected attendance. No synthetic data was displayed.
          </p>
        ) : null}
        {!isLoading && data.status === "ready" && filteredRows.length > 0 ? (
          <AdminDataTable
            caption="Attendance roster"
            columns={columns}
            rowKey={(item) => `${item.sessionId}-${item.studentId}`}
            rows={filteredRows}
          />
        ) : null}
        {!isLoading && data.status === "ready" && filteredRows.length === 0 ? (
          <p className="admin-empty-state">No connected attendance records match these filters.</p>
        ) : null}
      </section>

      {dialog ? (
        <AttendanceDialog
          busy={busy}
          dialog={dialog}
          error={dialogError}
          onChange={updateDialog}
          onClose={() => {
            setDialog(undefined);
            setDialogError("");
          }}
          onSubmit={(event) => void submitDialog(event)}
        />
      ) : null}
    </section>
  );
}

export default function AttendanceRoute() {
  return <AttendancePage />;
}
