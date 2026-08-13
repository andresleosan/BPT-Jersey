"use client";

import { useState } from "react";

import { AdminFilterBar, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";
import { previewData, type PreviewGroup } from "../preview-data";

import "../admin.css";

const columns = [
  { key: "name", label: "Group", render: (item: PreviewGroup) => <strong>{item.name}</strong> },
  { key: "program", label: "Program", render: (item: PreviewGroup) => item.program },
  { key: "coach", label: "Coach", render: (item: PreviewGroup) => item.coach },
  { key: "level", label: "Age / skill band", render: (item: PreviewGroup) => item.level },
  { key: "schedule", label: "Schedule", render: (item: PreviewGroup) => item.schedule },
  {
    key: "capacity",
    label: "Capacity",
    render: (item: PreviewGroup) => `${item.members} / ${item.capacity}`,
  },
  {
    key: "trainingCenter",
    label: "Training center",
    render: (item: PreviewGroup) => item.trainingCenter,
  },
  {
    key: "status",
    label: "Status",
    render: (item: PreviewGroup) => <AdminStatusBadge status={item.status} />,
  },
] as const;

export function GroupsPage() {
  const [program, setProgram] = useState("All programs");
  const [coach, setCoach] = useState("All coaches");
  const [status, setStatus] = useState("Active groups");
  const [notice, setNotice] = useState("");
  const groups = previewData.groups.filter(
    (group) =>
      (program === "All programs" || group.program === program) &&
      (coach === "All coaches" || group.coach === coach) &&
      (status === "Active groups" ? group.status === "active" : group.status !== "active"),
  );

  return (
    <section className="admin-module-page" aria-labelledby="groups-title">
      <AdminSectionHeader
        actions={
          <button
            className="admin-auth-button"
            onClick={() => setNotice("Group creation is ready for the connected data source.")}
            type="button"
          >
            Create group
          </button>
        }
        description="Manage training groups, coaches, capacity, and the members assigned to each team."
        eyebrow="Groups / Teams / Synthetic preview"
        title="Groups / Teams"
      />
      <AdminFilterBar>
        <label className="admin-filter-control">
          Program
          <select
            aria-label="Program"
            onChange={(event) => setProgram(event.target.value)}
            value={program}
          >
            <option>All programs</option>
            <option>Brazilian Jiu-Jitsu</option>
            <option>MMA</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Coach
          <select
            aria-label="Coach"
            onChange={(event) => setCoach(event.target.value)}
            value={coach}
          >
            <option>All coaches</option>
            <option>Coach Alex</option>
            <option>Coach Bruno</option>
          </select>
        </label>
        <label className="admin-filter-control">
          Status
          <select
            aria-label="Group status"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option>Active groups</option>
            <option>Archived groups</option>
          </select>
        </label>
      </AdminFilterBar>
      {notice ? (
        <p aria-live="polite" className="admin-preview-notice" role="status">
          {notice}
        </p>
      ) : null}
      <section className="admin-panel-card" aria-labelledby="groups-table-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Directory</p>
            <h3 id="groups-table-title">Training groups</h3>
          </div>
          <span className="admin-status-badge admin-status-active">Synthetic preview</span>
        </div>
        <AdminDataTable
          caption="Groups and teams"
          columns={columns}
          rowKey={(item) => item.name}
          rows={groups}
        />
        {groups.length === 0 ? (
          <p className="admin-empty-state">No groups match these filters.</p>
        ) : null}
      </section>
    </section>
  );
}

export default function GroupsRoute() {
  return <GroupsPage />;
}
