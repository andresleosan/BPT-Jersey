"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionOperationalStatus } from "@bpt-jersey/domain/schedule";

import { getSessionOperationalView, listSessions } from "../../../lib/schedule-client";
import { AdminFilterBar, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";

import "../admin.css";

type AttendanceRow = Readonly<{
  student: string;
  group: string;
  session: string;
  coach: string;
  checkIn: string;
  state: string;
}>;

type AttendanceState =
  | { status: "loading"; date: string }
  | { status: "ready"; date: string; rows: readonly AttendanceRow[] }
  | { status: "error"; date: string };

const columns = [
  {
    key: "student",
    label: "Student ID",
    render: (item: AttendanceRow) => <strong>{item.student}</strong>,
  },
  { key: "group", label: "Session ID", render: (item: AttendanceRow) => item.group },
  { key: "session", label: "Session", render: (item: AttendanceRow) => item.session },
  { key: "coach", label: "Instructor ID", render: (item: AttendanceRow) => item.coach },
  { key: "checkIn", label: "Check-in", render: (item: AttendanceRow) => item.checkIn },
  {
    key: "state",
    label: "State",
    render: (item: AttendanceRow) => <AdminStatusBadge status={item.state} />,
  },
] as const;

const statusLabels: Readonly<Record<SessionOperationalStatus | "pending", string>> = {
  booked_not_arrived: "Pending",
  attended: "Present",
  late: "Late",
  absent: "Absent",
  no_show: "No-show",
  checked_out: "Checked out",
  pending: "Pending",
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

async function loadAttendanceRows(date: string): Promise<readonly AttendanceRow[]> {
  const sessions = await listSessions(dayQuery(date));
  const views = await Promise.all(
    sessions.map((session) => getSessionOperationalView(session.sessionId)),
  );
  return views.flatMap((view) =>
    view.roster.map((student) => ({
      student: student.studentId,
      group: view.session.sessionId,
      session: `${view.session.title} (${view.session.startAt.slice(11, 16)})`,
      coach: view.session.instructorId,
      checkIn: student.attendance?.occurredAt.slice(11, 16) ?? "-",
      state: statusLabels[student.computedStatus],
    })),
  );
}

export function AttendancePage() {
  const [date, setDate] = useState(todayDate);
  const [session, setSession] = useState("All sessions");
  const [group, setGroup] = useState("All sessions");
  const [coach, setCoach] = useState("All instructors");
  const [stateFilter, setStateFilter] = useState("All states");
  const [data, setData] = useState<AttendanceState>({ status: "loading", date: todayDate() });

  useEffect(() => {
    let active = true;
    void loadAttendanceRows(date).then(
      (rows) => {
        if (active) setData({ status: "ready", date, rows });
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
  const rows = useMemo(
    () => (!isLoading && data.status === "ready" ? data.rows : []),
    [data, isLoading],
  );
  const sessionOptions = useMemo(
    () => ["All sessions", ...new Set(rows.map((row) => row.session))],
    [rows],
  );
  const groupOptions = useMemo(
    () => ["All sessions", ...new Set(rows.map((row) => row.group))],
    [rows],
  );
  const coachOptions = useMemo(
    () => ["All instructors", ...new Set(rows.map((row) => row.coach))],
    [rows],
  );
  const stateOptions = useMemo(
    () => ["All states", ...new Set(rows.map((row) => row.state))],
    [rows],
  );
  const filteredRows = rows.filter(
    (item) =>
      (session === "All sessions" || item.session === session) &&
      (group === "All sessions" || item.group === group) &&
      (coach === "All instructors" || item.coach === coach) &&
      (stateFilter === "All states" || item.state === stateFilter),
  );

  return (
    <section className="admin-module-page" aria-labelledby="attendance-title">
      <AdminSectionHeader
        description="Review canonical session rosters, check-ins, late arrivals, absences, and no-shows."
        eyebrow="Attendance / Connected"
        title="Attendance"
      />
      <AdminFilterBar>
        <label className="admin-filter-control">
          Date
          <input
            aria-label="Attendance date"
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
      <section className="admin-panel-card" aria-labelledby="attendance-table-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Canonical daily roster</p>
            <h3 id="attendance-table-title">Today&apos;s attendance</h3>
          </div>
          <span className="admin-status-badge admin-status-active">
            {data.status === "ready" ? "Connected" : "Loading"}
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
            rowKey={(item) => `${item.group}-${item.student}`}
            rows={filteredRows}
          />
        ) : null}
        {!isLoading && data.status === "ready" && filteredRows.length === 0 ? (
          <p className="admin-empty-state">No connected attendance records match these filters.</p>
        ) : null}
      </section>
    </section>
  );
}

export default function AttendanceRoute() {
  return <AttendancePage />;
}
