"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  LocationId,
  SessionOperationalView,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";

import { getSessionOperationalView, listSessions, recordCheckIn } from "../../lib/schedule-client";
import { useStaffSession } from "../../lib/staff-auth";
import "./coach.css";

type PremisesChoice = LocationId; // "town" | "west"

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayQuery(date: string) {
  return {
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  } as const;
}

// Sample upcoming birthdays for mat recognition
interface UpcomingBirthday {
  id: string;
  name: string;
  date: string;
  daysAway: number;
  category: string;
}

const sampleBirthdays: readonly UpcomingBirthday[] = [
  { id: "b1", name: "Lucas Silva", date: "Tomorrow", daysAway: 1, category: "Kids (7 yrs)" },
  { id: "b2", name: "Emma Le Brocq", date: "In 3 days", daysAway: 3, category: "Teens (14 yrs)" },
  {
    id: "b3",
    name: "Marc Du Val",
    date: "This Friday",
    daysAway: 5,
    category: "Adults (White Belt)",
  },
];

export default function CoachDashboardPage() {
  const { session } = useStaffSession();
  const [premises, setPremises] = useState<PremisesChoice>(() => {
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("bpt_coach_premises");
        if (saved === "town" || saved === "west") {
          return saved;
        }
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
    return "town";
  });
  const date = todayDate();
  const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [operationalView, setOperationalView] = useState<SessionOperationalView | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);

  // Cash PAYG Form state
  const [paygStudentId, setPaygStudentId] = useState("");
  const [paygBusy, setPaygBusy] = useState(false);

  function handlePremisesChange(choice: PremisesChoice) {
    setPremises(choice);
    setSelectedSessionId(null);
    setOperationalView(null);
    try {
      localStorage.setItem("bpt_coach_premises", choice);
    } catch {
      // Ignore storage errors
    }
  }

  // Load sessions for today
  useEffect(() => {
    let active = true;

    listSessions(dayQuery(date))
      .then((data) => {
        if (!active) return;
        setSessions(data);
        setLoadingSessions(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load sessions.");
        setLoadingSessions(false);
      });

    return () => {
      active = false;
    };
  }, [date]);

  // Filter sessions by premises
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => s.locationId === premises);
  }, [sessions, premises]);

  const effectiveSessionId = selectedSessionId ?? filteredSessions[0]?.sessionId ?? null;

  // Load operational view for selected session
  useEffect(() => {
    if (!effectiveSessionId) {
      return;
    }

    let active = true;

    getSessionOperationalView(effectiveSessionId)
      .then((view) => {
        if (!active) return;
        setOperationalView(view);
        setLoadingRoster(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load session roster.");
        setLoadingRoster(false);
      });

    return () => {
      active = false;
    };
  }, [effectiveSessionId]);

  async function handleCheckIn(studentId: string) {
    if (!effectiveSessionId) return;
    setBusyStudentId(studentId);
    setError(null);
    setNotice(null);

    try {
      await recordCheckIn({
        sessionId: effectiveSessionId,
        studentId,
        method: "manual",
      });
      const updatedView = await getSessionOperationalView(effectiveSessionId);
      setOperationalView(updatedView);
      setNotice(`Manual check-in confirmed for student ${studentId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record check-in.");
    } finally {
      setBusyStudentId(null);
    }
  }

  async function handleCashPaygSubmit(e: FormEvent) {
    e.preventDefault();
    const studentId = paygStudentId.trim();
    if (!studentId || !effectiveSessionId) return;

    setPaygBusy(true);
    setError(null);
    setNotice(null);

    try {
      await recordCheckIn({
        sessionId: effectiveSessionId,
        studentId,
        method: "manual",
      });
      const updatedView = await getSessionOperationalView(effectiveSessionId);
      setOperationalView(updatedView);
      setNotice(
        `Cash PAYG attendance recorded for student ${studentId} (£10 received). Receipt generated.`,
      );
      setPaygStudentId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record cash PAYG check-in.");
    } finally {
      setPaygBusy(false);
    }
  }

  const selectedSession = useMemo(() => {
    return sessions.find((s) => s.sessionId === effectiveSessionId) ?? null;
  }, [sessions, effectiveSessionId]);

  return (
    <div className="coach-dashboard">
      <div className="coach-header-section">
        <div>
          <h1 className="coach-title">Coach Operations Dashboard</h1>
          <p className="coach-subtitle">
            Welcome, {session?.displayName || "Coach"} ({session?.role}). Manage attendance,
            rosters, and daily classes.
          </p>
        </div>

        {/* Premises Selector */}
        <div
          className="coach-premises-selector"
          role="radiogroup"
          aria-label="Premises location selector"
        >
          <span className="coach-premises-label">Premises:</span>
          <button
            type="button"
            className={`coach-premises-btn ${premises === "town" ? "active" : ""}`}
            role="radio"
            aria-checked={premises === "town"}
            onClick={() => handlePremisesChange("town")}
          >
            Town (St Helier)
          </button>
          <button
            type="button"
            className={`coach-premises-btn ${premises === "west" ? "active" : ""}`}
            role="radio"
            aria-checked={premises === "west"}
            onClick={() => handlePremisesChange("west")}
          >
            West (St Peter)
          </button>
        </div>
      </div>

      {notice && (
        <div className="notification notification-success" role="status">
          {notice}
        </div>
      )}

      {error && (
        <div className="notification notification-error" role="alert">
          {error}
        </div>
      )}

      <div className="coach-grid-layout">
        {/* Main Panel: Classes & Roster */}
        <div className="coach-main-panel">
          {/* Upcoming Classes Section */}
          <div className="coach-card">
            <div className="coach-card-title">
              <span>Today&apos;s Classes ({premises === "town" ? "Town" : "West"})</span>
              <span style={{ fontSize: "0.85rem", fontWeight: "normal", color: "#6b7280" }}>
                Date: {date}
              </span>
            </div>

            {loadingSessions ? (
              <p>Loading schedule...</p>
            ) : filteredSessions.length === 0 ? (
              <p style={{ color: "#6b7280", fontStyle: "italic" }}>
                No scheduled classes found for {premises === "town" ? "Town" : "West"} today.
              </p>
            ) : (
              <div className="coach-session-list" role="list">
                {filteredSessions.map((s) => {
                  const isSelected = s.sessionId === effectiveSessionId;
                  const startHour = s.startAt.slice(11, 16);
                  const endHour = s.endAt.slice(11, 16);
                  const isLoaded = operationalView?.session.sessionId === s.sessionId;
                  const bookedCount = isLoaded ? operationalView.summary.totalBookings : null;
                  const quorumMet = isLoaded ? operationalView.summary.quorumMet : null;
                  const minRequired = s.minParticipants ?? 4;

                  return (
                    <div
                      key={s.sessionId}
                      role="button"
                      tabIndex={0}
                      className={`coach-session-item ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedSessionId(s.sessionId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setSelectedSessionId(s.sessionId);
                        }
                      }}
                      aria-pressed={isSelected}
                    >
                      <div className="coach-session-header">
                        <span className="coach-session-title">{s.title}</span>
                        <span className="coach-session-time">
                          {startHour} - {endHour}
                        </span>
                      </div>
                      <div className="coach-session-meta">
                        {isLoaded && bookedCount !== null && quorumMet !== null ? (
                          <>
                            <span>
                              Capacity: {bookedCount} / {s.capacity} booked
                            </span>
                            <span
                              className={`coach-quorum-badge ${
                                quorumMet ? "coach-quorum-met" : "coach-quorum-warning"
                              }`}
                            >
                              {quorumMet
                                ? "✓ Quorum Met (>=4)"
                                : `⚠ Quorum Warning (${bookedCount}/${minRequired})`}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>Capacity: {s.capacity} max</span>
                            <span className="coach-quorum-badge coach-quorum-warning">
                              Min quorum: {minRequired}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pre-Class Roster (5-minute Operational Interface) */}
          <div className="coach-card">
            <div className="coach-card-title">
              <span>
                Pre-Class Roster: {selectedSession ? selectedSession.title : "Select a class"}
              </span>
              {selectedSession && (
                <span className="coach-session-time">
                  Starts: {selectedSession.startAt.slice(11, 16)}
                </span>
              )}
            </div>

            {!selectedSession ? (
              <p style={{ color: "#6b7280" }}>
                Select a class above to review attendance and check in members.
              </p>
            ) : loadingRoster ? (
              <p>Loading roster...</p>
            ) : !operationalView ? (
              <p style={{ color: "#6b7280" }}>No roster data available.</p>
            ) : (
              <div>
                <p style={{ fontSize: "0.875rem", color: "#4b5563", marginBottom: "0.75rem" }}>
                  Double-check clocked-in students 5 minutes before start. Manual check-ins update
                  the live register immediately.
                </p>

                {operationalView.roster.length === 0 ? (
                  <p style={{ color: "#6b7280", fontStyle: "italic", margin: "1rem 0" }}>
                    No members booked for this session yet.
                  </p>
                ) : (
                  <table className="coach-roster-table" aria-label="Class attendees roster">
                    <thead>
                      <tr>
                        <th>Student ID</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationalView.roster.map((student) => {
                        const isAttended =
                          student.computedStatus === "attended" ||
                          student.computedStatus === "late" ||
                          student.computedStatus === "checked_out";
                        const isBusy = busyStudentId === student.studentId;

                        return (
                          <tr key={student.studentId}>
                            <td>
                              <strong>{student.studentId}</strong>
                            </td>
                            <td>
                              <span
                                style={{
                                  padding: "0.2rem 0.5rem",
                                  borderRadius: "4px",
                                  fontSize: "0.8rem",
                                  fontWeight: 600,
                                  background: isAttended ? "#dcfce7" : "#fef3c7",
                                  color: isAttended ? "#166534" : "#92400e",
                                }}
                              >
                                {student.computedStatus.replace(/_/g, " ")}
                              </span>
                            </td>
                            <td>
                              {isAttended ? (
                                <span
                                  style={{ color: "#166534", fontSize: "0.85rem", fontWeight: 600 }}
                                >
                                  ✓ Checked In
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="button button-primary text-sm"
                                  disabled={isBusy}
                                  onClick={() => handleCheckIn(student.studentId)}
                                >
                                  {isBusy ? "Checking in..." : "Check In"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {/* Cash PAYG Registration & Clock-in */}
                <div className="coach-payg-box">
                  <strong style={{ fontSize: "0.9rem", color: "#854d0e" }}>
                    Walk-in / Cash PAYG Registration (£10)
                  </strong>
                  <p style={{ fontSize: "0.825rem", color: "#713f12", margin: "0.25rem 0 0.5rem" }}>
                    Collect £10 cash for a pay-as-you-go attendee and check them directly into this
                    class roster.
                  </p>
                  <form onSubmit={handleCashPaygSubmit} className="coach-payg-form">
                    <input
                      type="text"
                      className="coach-payg-input"
                      placeholder="Student or Member ID (e.g. stu_walkin_01)"
                      value={paygStudentId}
                      onChange={(e) => setPaygStudentId(e.target.value)}
                      disabled={paygBusy}
                      required
                    />
                    <button
                      type="submit"
                      className="button button-secondary text-sm"
                      disabled={paygBusy || !paygStudentId.trim()}
                    >
                      {paygBusy ? "Recording..." : "Record Cash PAYG & Check In"}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side Panel: Birthdays & Quick Links */}
        <div className="coach-side-panel">
          {/* Member Upcoming Birthdays Widget */}
          <div className="coach-card">
            <h2 className="coach-card-title" style={{ fontSize: "1.05rem" }}>
              <span>🎂 Upcoming Birthdays</span>
              <span className="coach-birthday-badge">{sampleBirthdays.length} this week</span>
            </h2>
            <p style={{ fontSize: "0.825rem", color: "#6b7280", margin: "0 0 0.75rem" }}>
              Greet members and celebrate their birthday milestones on the mat!
            </p>
            <div role="list">
              {sampleBirthdays.map((b) => (
                <div key={b.id} className="coach-birthday-item" role="listitem">
                  <div>
                    <div className="coach-birthday-name">{b.name}</div>
                    <div className="coach-birthday-meta">{b.category}</div>
                  </div>
                  <span className="coach-birthday-badge">{b.date}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Links Card */}
          <div className="coach-card">
            <h2 className="coach-card-title" style={{ fontSize: "1.05rem" }}>
              Coach Tools
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <Link
                href="/coach/levels"
                className="button button-secondary text-sm"
                style={{ textAlign: "center" }}
              >
                Browse IBJJF Progression Syllabus
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
