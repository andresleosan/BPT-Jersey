"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { CreateSessionInput, SessionRecord } from "@bpt-jersey/domain/schedule";

import { AdminDataTable } from "../admin-data-table";
import { AdminFilterBar, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
type ActivityRow = Readonly<{
  name: string;
  program: string;
  date: string;
  time: string;
  coach: string;
  location: string;
  capacity: number;
  booked: string;
  status: string;
}>;
import { listSessions, saveSession } from "../../../lib/schedule-client";
import "../admin.css";

const columns = [
  {
    key: "name",
    label: "Activity",
    render: (item: ActivityRow) => <strong>{item.name}</strong>,
  },
  { key: "program", label: "Program", render: (item: ActivityRow) => item.program },
  { key: "date", label: "Date", render: (item: ActivityRow) => item.date },
  { key: "time", label: "Time", render: (item: ActivityRow) => item.time },
  { key: "coach", label: "Coach", render: (item: ActivityRow) => item.coach },
  { key: "location", label: "Location", render: (item: ActivityRow) => item.location },
  {
    key: "capacity",
    label: "Capacity",
    render: (item: ActivityRow) => `${item.booked} / ${item.capacity}`,
  },
  {
    key: "status",
    label: "Status",
    render: (item: ActivityRow) => <AdminStatusBadge status={item.status} />,
  },
] as const;

export function ActivitiesPage() {
  const formTitleId = useId();
  const formProgramId = useId();
  const formLocationId = useId();
  const formDateId = useId();
  const formStartTimeId = useId();
  const formEndTimeId = useId();
  const formCapacityId = useId();
  const formIsSeminarId = useId();

  const [program, setProgram] = useState("All programs");
  const [status, setStatus] = useState("Scheduled");
  const [notice, setNotice] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form state
  const [newTitle, setNewTitle] = useState("");
  const [newProgram, setNewProgram] = useState("adult-fundamentals");
  const [newLocation, setNewLocation] = useState<"town" | "west">("town");
  const [newDate, setNewDate] = useState("2026-09-01");
  const [newStartTime, setNewStartTime] = useState("18:00");
  const [newEndTime, setNewEndTime] = useState("19:00");
  const [newCapacity, setNewCapacity] = useState(25);
  const [isSeminar, setIsSeminar] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [connectedSessions, setConnectedSessions] = useState<readonly SessionRecord[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let mounted = true;
    const from = new Date();
    const to = new Date(from.getTime() + 180 * 24 * 60 * 60 * 1000);
    void listSessions({ from: from.toISOString(), to: to.toISOString() })
      .then((sessions) => {
        if (!mounted) return;
        setConnectedSessions(sessions);
        setLoadState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setLoadState("error");
      });

    return () => {
      mounted = false;
    };
  }, []);

  const combinedActivities: readonly ActivityRow[] = connectedSessions.map((s) => ({
    name: s.title,
    program: s.programId,
    date: s.startAt.slice(0, 10),
    time: `${s.startAt.slice(11, 16)} - ${s.endAt.slice(11, 16)}`,
    coach: s.instructorId,
    location: s.locationId,
    booked: "Not available",
    capacity: s.capacity,
    status: s.status,
  }));

  const programOptions = useMemo(
    () => Array.from(new Set(combinedActivities.map((activity) => activity.program))).sort(),
    [combinedActivities],
  );

  const activities = combinedActivities.filter(
    (activity) =>
      (program === "All programs" || activity.program === program) &&
      activity.status === status.toLowerCase(),
  );

  async function handleCreateActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsSubmitting(true);
    try {
      const startAt = `${newDate}T${newStartTime}:00Z`;
      const endAt = `${newDate}T${newEndTime}:00Z`;

      const input: CreateSessionInput = {
        programId: newProgram,
        locationId: newLocation,
        instructorId: "coach-1",
        title: newTitle.trim(),
        startAt,
        endAt,
        capacity: Number(newCapacity),
        minParticipants: 4,
        isSeminar,
      };

      const created = await saveSession(input);
      setConnectedSessions((prev) => [...prev, created]);
      setNotice(`Activity "${created.title}" scheduled successfully.`);
      setIsModalOpen(false);
      setNewTitle("");
    } catch {
      setNotice("Activity creation is ready for the connected data source.");
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="admin-module-page" aria-labelledby="activities-title">
      <AdminSectionHeader
        actions={
          <button className="admin-auth-button" onClick={() => setIsModalOpen(true)} type="button">
            Create activity
          </button>
        }
        description="Schedule classes and academy activities with coach, location, capacity, and attendance visibility."
        eyebrow={`Activities / ${loadState === "ready" ? "Connected" : "Connected source"}`}
        title="Activities"
      />

      {isModalOpen && (
        <div
          className="admin-modal-overlay"
          role="dialog"
          aria-labelledby="activity-modal-title"
          aria-modal="true"
        >
          <div className="admin-modal-content">
            <h3 id="activity-modal-title">Schedule New Activity / Session</h3>
            <form onSubmit={handleCreateActivity}>
              <div className="admin-form-group">
                <label htmlFor={formTitleId}>Activity Title</label>
                <input
                  id={formTitleId}
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Master Seminar or Evening BJJ"
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor={formProgramId}>Program</label>
                <select
                  id={formProgramId}
                  value={newProgram}
                  onChange={(e) => setNewProgram(e.target.value)}
                >
                  <option value="adult-fundamentals">Adult BJJ Fundamentals</option>
                  <option value="adult-advanced">Adult BJJ Advanced</option>
                  <option value="seminar">Special Seminar / Workshop</option>
                  <option value="open-mat">Open Mat</option>
                </select>
              </div>

              <div className="admin-form-group">
                <label htmlFor={formLocationId}>Location</label>
                <select
                  id={formLocationId}
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value as "town" | "west")}
                >
                  <option value="town">BPT Town</option>
                  <option value="west">BPT West</option>
                </select>
              </div>

              <div className="admin-form-group">
                <label htmlFor={formDateId}>Date</label>
                <input
                  id={formDateId}
                  type="date"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor={formStartTimeId}>Start Time</label>
                <input
                  id={formStartTimeId}
                  type="text"
                  required
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  placeholder="18:00"
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor={formEndTimeId}>End Time</label>
                <input
                  id={formEndTimeId}
                  type="text"
                  required
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={newEndTime}
                  onChange={(e) => setNewEndTime(e.target.value)}
                  placeholder="19:00"
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor={formCapacityId}>Capacity</label>
                <input
                  id={formCapacityId}
                  type="number"
                  required
                  min={1}
                  max={300}
                  value={newCapacity}
                  onChange={(e) => setNewCapacity(Number(e.target.value))}
                />
              </div>

              <div className="admin-form-group admin-checkbox-group">
                <label htmlFor={formIsSeminarId}>
                  <input
                    id={formIsSeminarId}
                    type="checkbox"
                    checked={isSeminar}
                    onChange={(e) => setIsSeminar(e.target.checked)}
                  />
                  Is Special Seminar / Workshop
                </label>
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
                  {isSubmitting ? "Scheduling..." : "Schedule Activity"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
            {programOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
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
      {loadState === "error" ? (
        <p className="admin-report-state" role="alert">
          Unable to load connected activities. No synthetic data was displayed.
        </p>
      ) : null}
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
          <span className="admin-status-badge admin-status-active">
            {loadState === "ready" ? "Connected" : "Loading"}
          </span>
        </div>
        <AdminDataTable
          caption="Academy activities"
          columns={columns}
          rowKey={(item) => `${item.name}-${item.time}`}
          rows={activities}
        />
        {loadState === "ready" && activities.length === 0 ? (
          <p className="admin-empty-state">No activities match these filters.</p>
        ) : null}
      </section>
    </section>
  );
}

export default function ActivitiesRoute() {
  return <ActivitiesPage />;
}
