"use client";

import { useState } from "react";

import { AdminDataTable, AdminFilterBar, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { previewData, type PreviewActivity } from "../preview-data";
import { AdminGate } from "../admin-gate";

import "../admin.css";

const columns = [
  {
    key: "name",
    label: "Activity",
    render: (item: PreviewActivity) => <strong>{item.name}</strong>,
  },
  { key: "program", label: "Program", render: (item: PreviewActivity) => item.program },
  { key: "date", label: "Date", render: (item: PreviewActivity) => item.date },
  { key: "time", label: "Time", render: (item: PreviewActivity) => item.time },
  { key: "coach", label: "Coach", render: (item: PreviewActivity) => item.coach },
  { key: "location", label: "Location", render: (item: PreviewActivity) => item.location },
  {
    key: "capacity",
    label: "Capacity",
    render: (item: PreviewActivity) => `${item.booked} / ${item.capacity}`,
  },
  {
    key: "status",
    label: "Status",
    render: (item: PreviewActivity) => <AdminStatusBadge status={item.status} />,
  },
] as const;

export function ActivitiesPage() {
  const [program, setProgram] = useState("All programs");
  const [status, setStatus] = useState("Scheduled");
  const [notice, setNotice] = useState("");
  const activities = previewData.activities.filter(
    (activity) =>
      (program === "All programs" || activity.program === program) &&
      activity.status === status.toLowerCase(),
  );

  return (
    <section className="admin-module-page" aria-labelledby="activities-title">
      <AdminSectionHeader
        actions={
          <button
            className="admin-auth-button"
            onClick={() => setNotice("Activity creation is ready for the connected data source.")}
            type="button"
          >
            Create activity
          </button>
        }
        description="Schedule classes and academy activities with coach, location, capacity, and attendance visibility."
        eyebrow="Activities / Synthetic preview"
        title="Activities"
      />
      <AdminFilterBar>
        <label className="admin-filter-control">
          View
          <select aria-label="Activity view">
            <option>List view</option>
            <option>Calendar view</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Program
          <select
            aria-label="Activity program"
            onChange={(event) => setProgram(event.target.value)}
            value={program}
          >
            <option>All programs</option>
            <option>Brazilian Jiu-Jitsu</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Status
          <select
            aria-label="Activity status"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option>Scheduled</option>
            <option>Completed</option>
            <option>Cancelled</option>
          </select>
        </label>
      </AdminFilterBar>
      {notice ? (
        <p aria-live="polite" className="admin-preview-notice" role="status">
          {notice}
        </p>
      ) : null}
      <section className="admin-panel-card" aria-labelledby="activities-table-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Schedule</p>
            <h3 id="activities-table-title">Academy activities</h3>
          </div>
          <span className="admin-status-badge admin-status-active">Synthetic preview</span>
        </div>
        <AdminDataTable
          caption="Academy activities"
          columns={columns}
          rowKey={(item) => `${item.name}-${item.time}`}
          rows={activities}
        />
        {activities.length === 0 ? (
          <p className="admin-empty-state">No activities match these filters.</p>
        ) : null}
      </section>
    </section>
  );
}

export default function ActivitiesRoute() {
  return (
    <AdminGate>
      <ActivitiesPage />
    </AdminGate>
  );
}
