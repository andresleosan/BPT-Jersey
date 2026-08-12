"use client";

import { useState } from "react";

import { AdminDataTable, AdminFilterBar, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { previewData, type PreviewAttendance } from "../preview-data";
import { AdminGate } from "../admin-gate";

import "../admin.css";

const columns = [
  {
    key: "student",
    label: "Student",
    render: (item: PreviewAttendance) => <strong>{item.student}</strong>,
  },
  { key: "group", label: "Group", render: (item: PreviewAttendance) => item.group },
  { key: "session", label: "Session", render: (item: PreviewAttendance) => item.session },
  { key: "coach", label: "Coach", render: (item: PreviewAttendance) => item.coach },
  { key: "checkIn", label: "Check-in", render: (item: PreviewAttendance) => item.checkIn },
  {
    key: "state",
    label: "State",
    render: (item: PreviewAttendance) => <AdminStatusBadge status={item.state} />,
  },
] as const;

export function AttendancePage() {
  const [date, setDate] = useState("2026-08-12");
  const [session, setSession] = useState("All sessions");
  const [group, setGroup] = useState("All groups");
  const [coach, setCoach] = useState("All coaches");
  const [state, setState] = useState("All states");
  const attendance = previewData.attendance.filter(
    (item) =>
      (session === "All sessions" || item.session.includes(session)) &&
      date === "2026-08-12" &&
      (group === "All groups" || item.group === group) &&
      (coach === "All coaches" || item.coach === coach) &&
      (state === "All states" || item.state === state),
  );

  return (
    <section className="admin-module-page" aria-labelledby="attendance-title">
      <AdminSectionHeader
        description="Review today's rosters, check-ins, late arrivals, absences, and no-shows."
        eyebrow="Attendance / Synthetic preview"
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
            <option>Kids Gi Fundamentals</option>
            <option>Adult No-Gi</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Group
          <select
            aria-label="Attendance group"
            onChange={(event) => setGroup(event.target.value)}
            value={group}
          >
            <option>All groups</option>
            <option>Little Warriors</option>
            <option>Adult No-Gi</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Coach
          <select
            aria-label="Attendance coach"
            onChange={(event) => setCoach(event.target.value)}
            value={coach}
          >
            <option>All coaches</option>
            <option>Coach Alex</option>
            <option>Coach Bruno</option>
          </select>
        </label>
        <label className="admin-filter-control">
          State
          <select
            aria-label="Attendance state"
            onChange={(event) => setState(event.target.value)}
            value={state}
          >
            <option>All states</option>
            <option>Present</option>
            <option>Late</option>
            <option>Absent</option>
            <option>No-show</option>
          </select>
        </label>
      </AdminFilterBar>
      <section className="admin-panel-card" aria-labelledby="attendance-table-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Daily roster</p>
            <h3 id="attendance-table-title">Today&apos;s attendance</h3>
          </div>
          <span className="admin-status-badge admin-status-active">Synthetic preview</span>
        </div>
        <AdminDataTable
          caption="Attendance roster"
          columns={columns}
          rowKey={(item) => `${item.student}-${item.session}`}
          rows={attendance}
        />
        {attendance.length === 0 ? (
          <p className="admin-empty-state">No attendance records match these filters.</p>
        ) : null}
      </section>
    </section>
  );
}

export default function AttendanceRoute() {
  return (
    <AdminGate>
      <AttendancePage />
    </AdminGate>
  );
}
