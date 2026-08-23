"use client";

import { useEffect, useId, useState } from "react";
import type { ClassRecord, CreateClassInput } from "@bpt-jersey/domain/schedule";

import { AdminDataTable } from "../admin-data-table";
import { AdminFilterBar, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { previewData, type PreviewGroup } from "../preview-data";
import { listClasses, saveClass } from "../../../lib/schedule-client";
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

function dayName(day: number): string {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return days[day - 1] ?? `Day ${day}`;
}

export function GroupsPage() {
  const formNameId = useId();
  const formProgramId = useId();
  const formLocationId = useId();
  const formDayId = useId();
  const formTimeId = useId();
  const formCapacityId = useId();

  const [program, setProgram] = useState("All programs");
  const [coach, setCoach] = useState("All coaches");
  const [status, setStatus] = useState("Active groups");
  const [notice, setNotice] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form state
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupProgram, setNewGroupProgram] = useState("adult-fundamentals");
  const [newGroupLocation, setNewGroupLocation] = useState<"town" | "west">("town");
  const [newGroupDay, setNewGroupDay] = useState(1);
  const [newGroupTime, setNewGroupTime] = useState("18:00");
  const [newGroupCapacity, setNewGroupCapacity] = useState(25);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [connectedClasses, setConnectedClasses] = useState<readonly ClassRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    void listClasses()
      .then((classes) => {
        if (!mounted) return;
        setConnectedClasses(classes);
      })
      .catch(() => {
        // Fallback to preview data if offline / unconfigured
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Merge connected data or use preview data
  const combinedGroups: readonly PreviewGroup[] =
    connectedClasses.length > 0
      ? connectedClasses.map((cls) => ({
          name: cls.name,
          program: cls.programId.includes("adult")
            ? "Brazilian Jiu-Jitsu"
            : cls.programId.includes("kids")
              ? "Kids BJJ"
              : "MMA",
          coach: cls.instructorIds.join(", ") || "Coach Alex",
          level: "All levels",
          schedule: `${dayName(cls.recurrenceRule.dayOfWeek)} ${cls.recurrenceRule.startTime}`,
          members: 0,
          capacity: cls.capacity,
          trainingCenter: cls.locationId === "town" ? "BPT Town" : "BPT West",
          status: cls.active ? ("active" as const) : ("archived" as const),
        }))
      : previewData.groups;

  const groups = combinedGroups.filter(
    (group) =>
      (program === "All programs" || group.program === program) &&
      (coach === "All coaches" || group.coach === coach) &&
      (status === "Active groups" ? group.status === "active" : group.status !== "active"),
  );

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    setIsSubmitting(true);
    try {
      const input: CreateClassInput = {
        programId: newGroupProgram,
        locationId: newGroupLocation,
        name: newGroupName.trim(),
        recurrenceRule: {
          dayOfWeek: newGroupDay as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          startTime: newGroupTime,
          durationMinutes: 60,
        },
        instructorIds: ["coach-1"],
        capacity: Number(newGroupCapacity),
        minParticipants: 4,
      };

      const created = await saveClass(input);
      setConnectedClasses((prev) => [...prev, created]);
      setNotice(`Group "${created.name}" created successfully.`);
      setIsModalOpen(false);
      setNewGroupName("");
    } catch {
      setNotice("Group creation is ready for the connected data source.");
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="admin-module-page" aria-labelledby="groups-title">
      <AdminSectionHeader
        actions={
          <button className="admin-auth-button" onClick={() => setIsModalOpen(true)} type="button">
            Create group
          </button>
        }
        description="Manage training groups, coaches, capacity, and the members assigned to each team."
        eyebrow="Groups / Teams / Synthetic preview"
        title="Groups / Teams"
      />

      {isModalOpen && (
        <div
          className="admin-modal-overlay"
          role="dialog"
          aria-labelledby="modal-title"
          aria-modal="true"
        >
          <div className="admin-modal-content">
            <h3 id="modal-title">Create New Training Group</h3>
            <form onSubmit={handleCreateGroup}>
              <div className="admin-form-group">
                <label htmlFor={formNameId}>Group Name</label>
                <input
                  id={formNameId}
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Adults Fundamentals Mon"
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor={formProgramId}>Program</label>
                <select
                  id={formProgramId}
                  value={newGroupProgram}
                  onChange={(e) => setNewGroupProgram(e.target.value)}
                >
                  <option value="adult-fundamentals">Adult BJJ Fundamentals</option>
                  <option value="adult-advanced">Adult BJJ Advanced</option>
                  <option value="kids-bjj-4-7">Kids BJJ (4-7 yrs)</option>
                  <option value="kids-bjj-8-11">Kids BJJ (8-11 yrs)</option>
                  <option value="teens-bjj">Teens BJJ (12-15 yrs)</option>
                  <option value="open-mat">Open Mat</option>
                </select>
              </div>

              <div className="admin-form-group">
                <label htmlFor={formLocationId}>Location</label>
                <select
                  id={formLocationId}
                  value={newGroupLocation}
                  onChange={(e) => setNewGroupLocation(e.target.value as "town" | "west")}
                >
                  <option value="town">BPT Town</option>
                  <option value="west">BPT West</option>
                </select>
              </div>

              <div className="admin-form-group">
                <label htmlFor={formDayId}>Day of Week</label>
                <select
                  id={formDayId}
                  value={newGroupDay}
                  onChange={(e) => setNewGroupDay(Number(e.target.value))}
                >
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                  <option value={7}>Sunday</option>
                </select>
              </div>

              <div className="admin-form-group">
                <label htmlFor={formTimeId}>Start Time (HH:mm)</label>
                <input
                  id={formTimeId}
                  type="text"
                  required
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={newGroupTime}
                  onChange={(e) => setNewGroupTime(e.target.value)}
                  placeholder="18:00"
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor={formCapacityId}>Capacity</label>
                <input
                  id={formCapacityId}
                  type="number"
                  required
                  min={1}
                  max={200}
                  value={newGroupCapacity}
                  onChange={(e) => setNewGroupCapacity(Number(e.target.value))}
                />
              </div>

              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="admin-auth-button" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Group"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
            <option>Kids BJJ</option>
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
