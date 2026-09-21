"use client";

import Link from "next/link";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  upcomingBirthdayDefaultWindowDays,
  type UpcomingBirthday,
  type UpcomingBirthdayTrainingCenter,
} from "@bpt-jersey/domain/birthdays";
import type { PreClassView } from "@bpt-jersey/domain/schedule/pre-class";
import {
  checkInOverrideReasonMaxLength,
  checkInOverrideReasonMinLength,
  checkInProximityRadiusMeters,
  isCheckInProximityMeasurementFresh,
  type LocationGeofence,
  type SessionOperationalView,
  type SessionRecord,
} from "@bpt-jersey/domain/schedule";

import { birthdayWhenLabel, listUpcomingBirthdays } from "../../lib/birthdays-client";
import { measureCheckInProximity, type ProximityReading } from "../../lib/check-in-proximity";
import { locationLabel } from "../../lib/location-label";
import {
  getPreClassView,
  getScheduleCatalog,
  getSessionOperationalView,
  listSessions,
  recordCheckIn,
} from "../../lib/schedule-client";
import { useAdminOrStaffSession } from "../admin/admin-gate";
const OpenLevelPanel = lazy(() =>
  import("./open-level-panel").then((module) => ({ default: module.OpenLevelPanel })),
);

type PremisesChoice = "town" | "west";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayQuery(date: string) {
  return {
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  } as const;
}

// T112: the site the coach picked, in the vocabulary of the canonical student record.
function birthdaySite(premises: PremisesChoice): UpcomingBirthdayTrainingCenter {
  return premises === "town" ? "Town" : "West";
}

type PreClassState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; view: PreClassView }>
  | Readonly<{ status: "error" }>;

type BirthdayState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; entries: readonly UpcomingBirthday[] }>
  | Readonly<{ status: "error" }>;

export default function CoachDashboardPage() {
  const session = useAdminOrStaffSession();
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
  // T109: the 50 m check-in eligibility signal. The device position is reduced to a distance here
  // and never sent; an out-of-radius reading needs a reason, it does not block the check-in.
  const [siteGeofence, setSiteGeofence] = useState<
    | Readonly<{ status: "loading" }>
    | Readonly<{ status: "ready"; geofence: LocationGeofence | null }>
    | Readonly<{ status: "error" }>
  >({ status: "loading" });
  const [proximity, setProximity] = useState<ProximityReading | null>(null);
  // T112: real upcoming birthdays of the active students of this site. The response carries no
  // date of birth, so the panel has nothing sensitive to hide.
  const [birthdays, setBirthdays] = useState<BirthdayState>({ status: "loading" });
  // T114: who to expect before the class starts. Derived from canonical attendance of the same
  // class in the recent past; nobody is checked in by it.
  const [preClass, setPreClass] = useState<PreClassState>({ status: "idle" });
  const [measuring, setMeasuring] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  // Bumped on every premises change so a measurement still in flight for the previous site is
  // discarded instead of being attributed to the new one.
  const measurementEpoch = useRef(0);
  const selectedSessionRef = useRef<string | null>(null);
  // Render-time clock for the freshness of the last reading; ticking here keeps render pure.
  const [clockMs, setClockMs] = useState(0);

  useEffect(() => {
    setClockMs(Date.now());
    const timer = setInterval(() => setClockMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Manual attendance for a member who is not on the booking list.
  const [walkInStudentId, setWalkInStudentId] = useState("");
  const [walkInBusy, setWalkInBusy] = useState(false);

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

  useEffect(() => {
    selectedSessionRef.current = effectiveSessionId;
    setNotice(null);
    setError(null);
  }, [effectiveSessionId]);

  // Load operational view for selected session
  useEffect(() => {
    setOperationalView(null);
    setLoadingRoster(Boolean(effectiveSessionId));
    if (!effectiveSessionId) return;

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

  useEffect(() => {
    let active = true;
    measurementEpoch.current += 1;
    setProximity(null);
    setOverrideReason("");
    setSiteGeofence({ status: "loading" });

    void getScheduleCatalog()
      .then((catalog) => {
        if (!active) return;
        const site = catalog.locations.find((location) => location.locationId === premises);
        setSiteGeofence({ status: "ready", geofence: site?.geofence ?? null });
      })
      .catch(() => {
        if (active) setSiteGeofence({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [premises]);

  useEffect(() => {
    if (!effectiveSessionId) {
      setPreClass({ status: "idle" });
      return;
    }
    let active = true;
    setPreClass({ status: "loading" });

    void getPreClassView(effectiveSessionId)
      .then((view) => {
        if (active) setPreClass({ status: "ready", view });
      })
      .catch(() => {
        if (active) setPreClass({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [effectiveSessionId]);

  useEffect(() => {
    let active = true;
    setBirthdays({ status: "loading" });

    void listUpcomingBirthdays({
      trainingCenter: birthdaySite(premises),
      windowDays: upcomingBirthdayDefaultWindowDays,
    })
      .then((entries) => {
        if (active) setBirthdays({ status: "ready", entries });
      })
      .catch(() => {
        if (active) setBirthdays({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [premises, date]);

  /**
   * A reading older than the server's freshness window would be recorded as unavailable while the
   * panel still showed a distance, so the panel stops using it and asks for a new measurement.
   */
  function freshMeasurement(nowMs: number) {
    return proximity?.status === "measured" &&
      isCheckInProximityMeasurementFresh(proximity.measurement, nowMs)
      ? proximity
      : null;
  }
  const measurementExpired = proximity?.status === "measured" && freshMeasurement(clockMs) === null;
  const overrideRequired = freshMeasurement(clockMs)?.signal === "outside";
  const overrideReady = overrideReason.trim().length >= checkInOverrideReasonMinLength;

  async function handleMeasureProximity() {
    if (siteGeofence.status !== "ready") return;
    const epoch = measurementEpoch.current;
    setMeasuring(true);
    setOverrideReason("");
    try {
      const reading = await measureCheckInProximity({ site: siteGeofence.geofence });
      // The premises changed while the device was answering: that reading belongs to another site.
      if (epoch === measurementEpoch.current) {
        setClockMs(Date.now());
        setProximity(reading);
      }
    } finally {
      if (epoch === measurementEpoch.current) setMeasuring(false);
    }
  }

  /**
   * The measurement to send, if any. An unusable or expired reading is simply omitted. Freshness is
   * judged on the ticking clock (at most thirty seconds behind); the backend re-derives it anyway.
   */
  function proximityPayload() {
    const fresh = freshMeasurement(clockMs);
    if (fresh === null) return {};
    return {
      proximity: fresh.measurement,
      ...(fresh.signal === "outside" ? { overrideReason: overrideReason.trim() } : {}),
    };
  }

  /** Both check-in paths share the same gate: outside the radius, staff must say why. */
  function requireOverrideReason(): boolean {
    if (overrideRequired && !overrideReady) {
      setError(
        `The measured position is outside the ${checkInProximityRadiusMeters} m radius. Record why ` +
          "you are checking this student in.",
      );
      return false;
    }
    return true;
  }

  async function handleCheckIn(studentId: string) {
    if (!effectiveSessionId) return;
    if (!requireOverrideReason()) return;
    setBusyStudentId(studentId);
    setError(null);
    setNotice(null);

    try {
      await recordCheckIn({
        sessionId: effectiveSessionId,
        studentId,
        method: "manual",
        ...proximityPayload(),
      });
      const updatedView = await getSessionOperationalView(effectiveSessionId);
      if (selectedSessionRef.current !== effectiveSessionId) return;
      setOperationalView(updatedView);
      setNotice(`Manual check-in confirmed for student ${studentId}.`);
    } catch (err) {
      if (selectedSessionRef.current === effectiveSessionId) {
        setError(err instanceof Error ? err.message : "Failed to record check-in.");
      }
    } finally {
      setBusyStudentId(null);
    }
  }

  async function handleWalkInSubmit(e: FormEvent) {
    e.preventDefault();
    const studentId = walkInStudentId.trim();
    if (!studentId || !effectiveSessionId) return;
    if (!requireOverrideReason()) return;

    setWalkInBusy(true);
    setError(null);
    setNotice(null);

    try {
      await recordCheckIn({
        sessionId: effectiveSessionId,
        studentId,
        method: "manual",
        ...proximityPayload(),
      });
      const updatedView = await getSessionOperationalView(effectiveSessionId);
      if (selectedSessionRef.current !== effectiveSessionId) return;
      setOperationalView(updatedView);
      setNotice(`Manual check-in recorded for student ${studentId}.`);
      setWalkInStudentId("");
    } catch (err) {
      if (selectedSessionRef.current === effectiveSessionId) {
        setError(err instanceof Error ? err.message : "Failed to record check-in.");
      }
    } finally {
      setWalkInBusy(false);
    }
  }

  const selectedSession = useMemo(() => {
    return sessions.find((s) => s.sessionId === effectiveSessionId) ?? null;
  }, [sessions, effectiveSessionId]);

  return (
    <div className="coach-dashboard">
      <div className="coach-header-section">
        <div>
          <h1 className="coach-title">Today on the mat</h1>
          <p className="coach-subtitle">
            Review today’s classes and check members in at your site.
          </p>
        </div>

        {/* Premises Selector */}
        <div
          className="coach-premises-selector"
          role="group"
          aria-label="Premises location selector"
        >
          <span className="coach-premises-label">Premises:</span>
          <button
            type="button"
            className={`coach-premises-btn ${premises === "town" ? "active" : ""}`}
            aria-pressed={premises === "town"}
            onClick={() => handlePremisesChange("town")}
          >
            Town (St Helier)
          </button>
          <button
            type="button"
            className={`coach-premises-btn ${premises === "west" ? "active" : ""}`}
            aria-pressed={premises === "west"}
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
          <section className="admin-panel-card coach-card">
            <h2 className="coach-card-title">
              <span>Today&apos;s Classes ({locationLabel(premises)})</span>
              <span>Date: {date}</span>
            </h2>

            {loadingSessions ? (
              <p className="coach-loading" role="status">
                Loading schedule...
              </p>
            ) : filteredSessions.length === 0 ? (
              <p>No scheduled classes found for {locationLabel(premises)} today.</p>
            ) : (
              <div className="coach-session-list">
                {filteredSessions.map((s) => {
                  const isSelected = s.sessionId === effectiveSessionId;
                  const startHour = s.startAt.slice(11, 16);
                  const endHour = s.endAt.slice(11, 16);
                  const isLoaded = operationalView?.session.sessionId === s.sessionId;
                  const bookedCount = isLoaded ? operationalView.summary.totalBookings : null;
                  const quorumMet = isLoaded ? operationalView.summary.quorumMet : null;
                  const minRequired = s.minParticipants ?? 4;

                  return (
                    <button
                      type="button"
                      key={s.sessionId}
                      className={`coach-session-item ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedSessionId(s.sessionId)}
                      aria-pressed={isSelected}
                    >
                      <span className="coach-session-header">
                        <span className="coach-session-title">{s.title}</span>
                        <span className="coach-session-time">
                          {startHour} - {endHour}
                        </span>
                      </span>
                      <span className="coach-session-meta">
                        {isLoaded && bookedCount !== null && quorumMet !== null ? (
                          <>
                            <span>
                              {s.capacity === null
                                ? `Capacity not set · ${bookedCount} booked`
                                : `Capacity: ${bookedCount} / ${s.capacity} booked`}
                            </span>
                            <span
                              className={`coach-quorum-badge ${
                                quorumMet ? "coach-quorum-met" : "coach-quorum-warning"
                              }`}
                            >
                              {quorumMet
                                ? `Minimum met (${minRequired})`
                                : `Below minimum (${bookedCount}/${minRequired})`}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>
                              {s.capacity === null
                                ? "Capacity not set"
                                : `Capacity: ${s.capacity} max`}
                            </span>
                            <span className="coach-quorum-badge coach-quorum-warning">
                              Minimum: {minRequired}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Pre-Class Roster (5-minute Operational Interface) */}
          <section className="admin-panel-card coach-card">
            <h2 className="coach-card-title">
              <span>
                Pre-Class Roster: {selectedSession ? selectedSession.title : "Select a class"}
              </span>
              {selectedSession && (
                <span className="coach-session-time">
                  Starts: {selectedSession.startAt.slice(11, 16)}
                </span>
              )}
            </h2>

            {selectedSession?.curriculum ? (
              <section className="coach-curriculum" aria-label="Session curriculum">
                <h3>{selectedSession.curriculum.title}</h3>
                <ul>
                  {selectedSession.curriculum.techniques.map((technique) => (
                    <li key={technique}>{technique}</li>
                  ))}
                </ul>
                {selectedSession.curriculum.details ? (
                  <p>{selectedSession.curriculum.details}</p>
                ) : null}
              </section>
            ) : null}

            {!selectedSession ? (
              <p>Select a class above to review attendance and check in members.</p>
            ) : loadingRoster ||
              (operationalView && operationalView.session.sessionId !== effectiveSessionId) ? (
              <p className="coach-loading" role="status">
                Loading roster...
              </p>
            ) : !operationalView ? (
              <p>No roster data available.</p>
            ) : (
              <div>
                <p>
                  Double-check clocked-in students 5 minutes before start. Manual check-ins update
                  the live register immediately.
                </p>

                <section className="coach-proximity" aria-labelledby="coach-proximity-title">
                  <p id="coach-proximity-title">Check-in location signal</p>
                  <p>
                    A measurement inside {checkInProximityRadiusMeters} m of this site is a signal,
                    never proof. Coordinates are never stored: only the distance is recorded.
                  </p>
                  <button
                    className="admin-home-link coach-button"
                    disabled={measuring || siteGeofence.status !== "ready"}
                    onClick={() => void handleMeasureProximity()}
                    type="button"
                  >
                    {measuring ? "Measuring..." : "Measure this device"}
                  </button>
                  <p aria-live="polite" data-testid="coach-proximity-status">
                    {siteGeofence.status === "loading"
                      ? "Loading this site's coordinates..."
                      : siteGeofence.status === "error"
                        ? "Site coordinates could not be loaded. Check-ins are recorded without a location signal."
                        : proximity === null
                          ? siteGeofence.geofence === null
                            ? "No coordinates are recorded for this site, so check-ins are recorded without a location signal."
                            : "Not measured yet. Check-ins are recorded without a location signal."
                          : proximity.status === "unavailable"
                            ? `${proximity.reason} The check-in is recorded without a location signal.`
                            : measurementExpired
                              ? "The last measurement is older than ten minutes. Measure again; until then check-ins are recorded without a location signal."
                              : proximity.signal === "within"
                                ? `Measured ${proximity.measurement.distanceMeters} m from this site, inside the radius.`
                                : `Measured ${proximity.measurement.distanceMeters} m from this site, outside the ${checkInProximityRadiusMeters} m radius.`}
                  </p>
                  {overrideRequired ? (
                    <label htmlFor="coach-proximity-override">
                      Why are you checking students in from outside the radius?
                      <textarea
                        aria-describedby="coach-proximity-override-help"
                        aria-required="true"
                        id="coach-proximity-override"
                        maxLength={checkInOverrideReasonMaxLength}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        required
                        rows={2}

                        value={overrideReason}
                      />
                      <span id="coach-proximity-override-help">
                        {`At least ${checkInOverrideReasonMinLength} characters. The reason is kept with the attendance and audited.`}
                      </span>
                    </label>
                  ) : null}
                </section>

                {operationalView.roster.length === 0 ? (
                  <p>No members booked for this session yet.</p>
                ) : (
                  <table className="coach-roster-table" aria-label="Class attendees roster">
                    <thead>
                      <tr>
                        <th scope="col">Member</th>
                        <th scope="col">Status</th>
                        <th scope="col">Attendance</th>
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
                            <td data-label="Member">
                              <strong>{student.studentId}</strong>
                            </td>
                            <td data-label="Status">
                              <span>{student.computedStatus.replace(/_/g, " ")}</span>
                            </td>
                            <td data-label="Attendance">
                              {isAttended ? (
                                <span>Checked in</span>
                              ) : (
                                <button
                                  type="button"
                                  className="admin-auth-button coach-button"
                                  disabled={busyStudentId !== null || walkInBusy}
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

                {["headCoach", "administrator", "owner"].includes(session.role) &&
                operationalView ? (
                  <Suspense fallback={<p role="status">Loading level tools…</p>}>
                    <OpenLevelPanel
                      key={effectiveSessionId}
                      studentIds={operationalView.roster.map((student) => student.studentId)}
                    />
                  </Suspense>
                ) : null}

                {/* Manual walk-in attendance */}
                <div className="coach-attendance-box">
                  <strong>Check in another member</strong>
                  <p>Use the member ID to record attendance for someone not listed above.</p>
                  <form onSubmit={handleWalkInSubmit} className="coach-inline-form">
                    <label htmlFor="coach-walk-in-id">
                      Member ID
                      <input
                        id="coach-walk-in-id"
                        type="text"
                        className="coach-input"
                        autoComplete="off"
                        value={walkInStudentId}
                        onChange={(e) => setWalkInStudentId(e.target.value)}
                        disabled={walkInBusy || busyStudentId !== null}
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      className="admin-home-link coach-button"
                      disabled={walkInBusy || busyStudentId !== null || !walkInStudentId.trim()}
                    >
                      {walkInBusy ? "Recording..." : "Check in member"}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Side Panel: Birthdays & Quick Links */}
        <div className="coach-side-panel">
          {/* T114: who to expect before the class starts */}
          <section className="admin-panel-card coach-card">
            <h2 className="coach-card-title">
              <span>Before class</span>
              {preClass.status === "ready" && (
                <span className="coach-birthday-badge">
                  {preClass.view.evidence.bookedCount + preClass.view.evidence.suggestedCount}{" "}
                  expected
                </span>
              )}
            </h2>
            {preClass.status === "idle" && <p>Pick a class to prepare it.</p>}
            {preClass.status === "loading" && <p>Preparing this class…</p>}
            {preClass.status === "error" && (
              <p role="status">Unable to prepare this class. Please try again.</p>
            )}
            {preClass.status === "ready" && (
              <>
                <p>
                  {preClass.view.evidence.open
                    ? `Booked members, plus regulars of the last ${preClass.view.evidence.windowDays} days who have not booked. Nobody is checked in until you record it.`
                    : "This class is closed, so only the booked members are listed."}
                </p>
                {preClass.view.attendees.length === 0 ? (
                  <p>Nobody is booked and nobody trains this class regularly yet.</p>
                ) : (
                  <div role="list">
                    {preClass.view.attendees.map((attendee) => (
                      <div key={attendee.studentId} className="coach-birthday-item" role="listitem">
                        <div>
                          <div className="coach-birthday-name">{attendee.displayName}</div>
                          <div className="coach-birthday-meta">
                            {attendee.source === "booked"
                              ? "Booked"
                              : `Regular · ${attendee.attendedCount} of the last ${attendee.comparableSessionCount}`}
                          </div>
                        </div>
                        <span className="coach-birthday-badge">
                          {attendee.source === "booked" ? "Booked" : "Suggested"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Member Upcoming Birthdays Widget */}
          <section className="admin-panel-card coach-card">
            <h2 className="coach-card-title">
              <span>Upcoming birthdays</span>
              {birthdays.status === "ready" && (
                <span className="coach-birthday-badge">{birthdays.entries.length} this week</span>
              )}
            </h2>
            <p>Greet members and celebrate their birthday milestones on the mat!</p>
            {birthdays.status === "loading" && <p>Loading birthdays…</p>}
            {birthdays.status === "error" && (
              <p role="status">Unable to load upcoming birthdays. Please try again.</p>
            )}
            {birthdays.status === "ready" && birthdays.entries.length === 0 && (
              <p>No birthdays at {locationLabel(premises)} this week.</p>
            )}
            {birthdays.status === "ready" && birthdays.entries.length > 0 && (
              <div role="list">
                {birthdays.entries.map((birthday) => (
                  <div key={birthday.studentId} className="coach-birthday-item" role="listitem">
                    <div>
                      <div className="coach-birthday-name">{birthday.displayName}</div>
                      <div className="coach-birthday-meta">
                        {birthday.participantType === "minor" ? "Minor" : "Adult"} ·{" "}
                        {birthday.trainingCenter}
                      </div>
                    </div>
                    <span className="coach-birthday-badge">
                      {birthdayWhenLabel(birthday.daysAway)} &middot; turns {birthday.turningAge}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Quick Links Card */}
          <section className="admin-panel-card coach-card">
            <h2 className="coach-card-title">Coach Tools</h2>
            <div>
              <Link href="/coach/levels" className="admin-home-link coach-button">
                Browse IBJJF Progression Syllabus
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
