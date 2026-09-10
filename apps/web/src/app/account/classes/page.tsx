"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { BookingRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import {
  cancelBooking,
  listSessions,
  listStudentBookings,
  requestBooking,
} from "../../../lib/schedule-client";
import { listClientMemberships, type ClientMembership } from "../../../lib/waitlist-client";

type LoadState = "loading" | "ready" | "error";
type Participant = Readonly<{ studentId: string; label: string }>;
type SessionFeedback = Readonly<{
  sessionId: string;
  tone: "error" | "success";
  text: string;
  waitlist: boolean;
}>;

const classWindowDays = 45;
const jerseyDateTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Jersey",
});

function formatDateTime(value: string): string {
  return jerseyDateTime.format(new Date(value));
}

function locationLabel(locationId: SessionRecord["locationId"]): string {
  return locationId === "town" ? "Town" : "West";
}

function statusLabel(status: BookingRecord["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function participantsFromMemberships(
  memberships: readonly ClientMembership[],
): readonly Participant[] {
  const studentIds = new Set<string>();
  const participants: Participant[] = [];
  for (const membership of memberships) {
    if (studentIds.has(membership.studentId)) continue;
    studentIds.add(membership.studentId);
    participants.push({
      studentId: membership.studentId,
      label: `Participant ${participants.length + 1}`,
    });
  }
  return Object.freeze(participants);
}

function ownDataField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function bookingFailure(error: unknown): Readonly<{ text: string; waitlist: boolean }> {
  const code = ownDataField(error, "code");
  const details = ownDataField(error, "details");
  const reason = ownDataField(details, "reason");

  if (code === "functions/failed-precondition" && reason === "capacity") {
    return {
      text: "No booking was created because this class is full.",
      waitlist: true,
    };
  }
  if (code === "functions/failed-precondition" && reason === "financial") {
    return {
      text: "This account cannot book the class at the moment. Contact the academy for help.",
      waitlist: false,
    };
  }
  if (code === "functions/failed-precondition" && reason === "ineligible") {
    return {
      text: "The selected membership is not eligible for this class.",
      waitlist: false,
    };
  }
  if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
    return {
      text: "You do not have access to book for this participant.",
      waitlist: false,
    };
  }
  if (code === "functions/not-found") {
    return { text: "This class is no longer available.", waitlist: false };
  }
  return {
    text: "The booking could not be completed. Refresh your classes and try again.",
    waitlist: false,
  };
}

function cancellationFailure(error: unknown): string {
  const code = ownDataField(error, "code");
  const reason = ownDataField(ownDataField(error, "details"), "reason");
  if (code === "functions/failed-precondition" && reason === "ineligible") {
    return "This booking can no longer be cancelled online. Contact the academy for help.";
  }
  if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
    return "You do not have access to cancel this booking.";
  }
  if (code === "functions/not-found") return "This booking is no longer available.";
  return "The booking could not be cancelled. Refresh your classes and try again.";
}

function upsertBooking(
  bookings: readonly BookingRecord[],
  replacement: BookingRecord,
): readonly BookingRecord[] {
  return bookings.some(
    (booking) =>
      booking.sessionId === replacement.sessionId && booking.studentId === replacement.studentId,
  )
    ? Object.freeze(
        bookings.map((booking) =>
          booking.sessionId === replacement.sessionId && booking.studentId === replacement.studentId
            ? replacement
            : booking,
        ),
      )
    : Object.freeze([replacement, ...bookings]);
}

export function AccountClassesContent() {
  const { session } = useClientSession();
  const sessionUserId = session?.uid;
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [memberships, setMemberships] = useState<readonly ClientMembership[]>([]);
  const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedMembershipId, setSelectedMembershipId] = useState("");
  const [bookingsState, setBookingsState] = useState<LoadState>("loading");
  const [bookings, setBookings] = useState<readonly BookingRecord[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState<SessionFeedback>();
  const [confirmingBookingId, setConfirmingBookingId] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [calendarView, setCalendarView] = useState<"two_days" | "week" | "all">("all");

  useEffect(() => {
    if (!sessionUserId) return;
    let active = true;
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + classWindowDays * 24 * 60 * 60 * 1000);

    void Promise.all([
      listClientMemberships(),
      listSessions({ from: now.toISOString(), to: rangeEnd.toISOString() }),
    ])
      .then(([loadedMemberships, loadedSessions]) => {
        if (!active) return;
        const participants = participantsFromMemberships(loadedMemberships);
        const firstStudentId = participants[0]?.studentId ?? "";
        const firstMembership = loadedMemberships.find(
          (membership) => membership.studentId === firstStudentId,
        );
        const nowTime = now.getTime();
        const upcomingSessions = Object.freeze(
          [...loadedSessions]
            .filter((item) => item.status === "scheduled" && Date.parse(item.startAt) > nowTime)
            .sort((left, right) => left.startAt.localeCompare(right.startAt)),
        );
        setMemberships(loadedMemberships);
        setSessions(upcomingSessions);
        setSelectedStudentId(firstStudentId);
        setSelectedMembershipId(firstMembership?.membershipId ?? "");
        setBookingsState(firstStudentId ? "loading" : "ready");
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [sessionUserId]);

  useEffect(() => {
    if (!selectedStudentId) return;
    let active = true;
    setBookingsState("loading");
    void listStudentBookings(selectedStudentId)
      .then((loadedBookings) => {
        if (!active) return;
        const seenSessions = new Set<string>();
        if (
          loadedBookings.some(
            (booking) =>
              booking.studentId !== selectedStudentId ||
              seenSessions.has(booking.sessionId) ||
              !seenSessions.add(booking.sessionId),
          )
        ) {
          setBookings([]);
          setBookingsState("error");
          return;
        }
        setBookings(loadedBookings);
        setBookingsState("ready");
      })
      .catch(() => {
        if (active) {
          setBookings([]);
          setBookingsState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [selectedStudentId]);

  const participants = useMemo(() => participantsFromMemberships(memberships), [memberships]);
  const participantLabel =
    participants.find((participant) => participant.studentId === selectedStudentId)?.label ??
    "Participant";
  const studentMemberships = memberships.filter(
    (membership) => membership.studentId === selectedStudentId,
  );
  const selectedMembership = studentMemberships.find(
    (membership) => membership.membershipId === selectedMembershipId,
  );
  const bookingsBySession = useMemo(
    () => new Map(bookings.map((booking) => [booking.sessionId, booking])),
    [bookings],
  );

  const displayedSessions = useMemo(() => {
    if (calendarView === "all") return sessions;
    const now = new Date();
    if (calendarView === "two_days") {
      const endOfTomorrow = new Date(now);
      endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
      endOfTomorrow.setHours(23, 59, 59, 999);
      return sessions.filter((s) => new Date(s.startAt) <= endOfTomorrow);
    }
    if (calendarView === "week") {
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      return sessions.filter((s) => {
        const d = new Date(s.startAt);
        return d >= startOfWeek && d <= endOfWeek;
      });
    }
    return sessions;
  }, [sessions, calendarView]);

  function chooseParticipant(studentId: string): void {
    const firstMembership = memberships.find((membership) => membership.studentId === studentId);
    setSelectedStudentId(studentId);
    setSelectedMembershipId(firstMembership?.membershipId ?? "");
    setBookings([]);
    setFeedback(undefined);
    setConfirmingBookingId("");
    setCancellationReason("");
  }

  async function handleBooking(sessionRecord: SessionRecord): Promise<void> {
    if (!selectedMembership || bookingsState !== "ready") return;
    setBusyKey(`book:${sessionRecord.sessionId}`);
    setFeedback(undefined);
    try {
      const booking = await requestBooking({
        sessionId: sessionRecord.sessionId,
        studentId: selectedMembership.studentId,
        membershipId: selectedMembership.membershipId,
      });
      if (
        booking.sessionId !== sessionRecord.sessionId ||
        booking.studentId !== selectedMembership.studentId ||
        booking.membershipId !== selectedMembership.membershipId ||
        (booking.status !== "confirmed" && booking.status !== "requested")
      ) {
        throw new Error("Unexpected booking response");
      }
      setBookings((current) => upsertBooking(current, booking));
      setFeedback({
        sessionId: sessionRecord.sessionId,
        tone: "success",
        text:
          booking.status === "confirmed"
            ? "Your place is confirmed."
            : "Your booking request was recorded.",
        waitlist: false,
      });
    } catch (error) {
      const failure = bookingFailure(error);
      setFeedback({
        sessionId: sessionRecord.sessionId,
        tone: "error",
        text: failure.text,
        waitlist: failure.waitlist,
      });
    } finally {
      setBusyKey("");
    }
  }

  async function handleCancellation(
    event: FormEvent<HTMLFormElement>,
    booking: BookingRecord,
  ): Promise<void> {
    event.preventDefault();
    const reason = cancellationReason.trim();
    if (booking.status !== "confirmed" || reason.length < 2 || reason.length > 200) return;
    setBusyKey(`cancel:${booking.bookingId}`);
    setFeedback(undefined);
    try {
      const cancelled = await cancelBooking({
        sessionId: booking.sessionId,
        studentId: booking.studentId,
        reason,
      });
      if (
        cancelled.sessionId !== booking.sessionId ||
        cancelled.studentId !== booking.studentId ||
        cancelled.status !== "cancelled"
      ) {
        throw new Error("Unexpected cancellation response");
      }
      setBookings((current) => upsertBooking(current, cancelled));
      setFeedback({
        sessionId: booking.sessionId,
        tone: "success",
        text: "Booking cancelled.",
        waitlist: false,
      });
      setConfirmingBookingId("");
      setCancellationReason("");
    } catch (error) {
      setFeedback({
        sessionId: booking.sessionId,
        tone: "error",
        text: cancellationFailure(error),
        waitlist: false,
      });
    } finally {
      setBusyKey("");
    }
  }

  if (!session) return null;

  if (loadState === "loading") {
    return (
      <main className="classes-client-page classes-client-loading" aria-busy="true">
        <p className="account-eyebrow">BPT Jersey / Classes</p>
        <h1>Loading the timetable</h1>
      </main>
    );
  }

  return (
    <main className="classes-client-page" id="main-content">
      <header className="classes-client-hero">
        <a className="profile-back-link" href="/account">
          <span aria-hidden="true">&larr;</span> Back to account
        </a>
        <p className="account-eyebrow">BPT Jersey / Upcoming classes</p>
        <h1>Choose your next session.</h1>
        <p>
          Browse the next {classWindowDays} days. Eligibility, capacity and cancellation cutoffs are
          confirmed by the academy when you act.
        </p>
      </header>

      {loadState === "error" ? (
        <p className="classes-client-message classes-client-message-error" role="alert">
          Unable to load your classes. Please try again.
        </p>
      ) : participants.length === 0 ? (
        <section
          className="classes-client-membership-empty"
          aria-labelledby="membership-needed-title"
        >
          <p className="account-eyebrow">Membership needed</p>
          <h2 id="membership-needed-title">Your account has no membership to book with.</h2>
          <p>Contact the academy to connect or activate the correct student membership.</p>
          <a className="button button-primary" href="/#contact">
            Contact the academy
          </a>
        </section>
      ) : (
        <>
          <section className="classes-client-controls" aria-labelledby="booking-for-title">
            <div>
              <p className="account-eyebrow">Booking for</p>
              <h2 id="booking-for-title">Choose participant and membership</h2>
            </div>
            <label>
              Participant
              <select
                disabled={busyKey !== ""}
                onChange={(event) => chooseParticipant(event.target.value)}
                value={selectedStudentId}
              >
                {participants.map((participant) => (
                  <option key={participant.studentId} value={participant.studentId}>
                    {participant.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Membership
              <select
                disabled={busyKey !== ""}
                onChange={(event) => {
                  setSelectedMembershipId(event.target.value);
                  setFeedback(undefined);
                }}
                value={selectedMembershipId}
              >
                {studentMemberships.map((membership) => (
                  <option key={membership.membershipId} value={membership.membershipId}>
                    {membership.planId} · {membership.status}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {bookingsState === "error" ? (
            <p className="classes-client-message classes-client-message-error" role="alert">
              Unable to load bookings for this participant. Refresh before booking.
            </p>
          ) : null}

          <aside className="classes-client-disclaimer" aria-label="Booking and cancellation policy">
            <p>
              <strong>Booking &amp; Cancellation Policy:</strong> Town &amp; West bookings must be
              made at least 1 hour before class starts. Cancellations must be made at least 1 hour
              in advance. No-shows or late cancellations will incur a penalty fee of £15 on your
              next booking. Classes require at least 4 attendees booked 1 hour prior to start, or
              they will be cancelled automatically.
            </p>
          </aside>

          <div className="classes-client-view-toggle" role="group" aria-label="Timetable view">
            <button
              className={`button button-small ${calendarView === "two_days" ? "button-primary" : "button-secondary"}`}
              onClick={() => setCalendarView("two_days")}
              type="button"
            >
              2 Days (Today &amp; Tomorrow)
            </button>
            <button
              className={`button button-small ${calendarView === "week" ? "button-primary" : "button-secondary"}`}
              onClick={() => setCalendarView("week")}
              type="button"
            >
              This Week (Mon - Sun)
            </button>
            <button
              className={`button button-small ${calendarView === "all" ? "button-primary" : "button-secondary"}`}
              onClick={() => setCalendarView("all")}
              type="button"
            >
              All Upcoming
            </button>
          </div>

          {displayedSessions.length === 0 ? (
            <p className="classes-client-empty" role="status">
              No classes match this timetable view.
            </p>
          ) : (
            <section className="classes-client-grid" aria-label="Upcoming classes">
              {displayedSessions.map((sessionRecord, index) => {
                const booking = bookingsBySession.get(sessionRecord.sessionId);
                const isConfirmed = booking?.status === "confirmed";
                const isRequested = booking?.status === "requested";
                const isCancelled = booking?.status === "cancelled";
                const cardColorClass = isConfirmed
                  ? "classes-client-card-booked"
                  : isCancelled
                    ? "classes-client-card-missed"
                    : "classes-client-card-available";
                const isConfirming = booking && confirmingBookingId === booking.bookingId;
                const sessionFeedback =
                  feedback?.sessionId === sessionRecord.sessionId ? feedback : undefined;
                return (
                  <article
                    aria-label={sessionRecord.title}
                    className={`classes-client-card ${cardColorClass}`}
                    key={sessionRecord.sessionId}
                  >
                    <div className="classes-client-card-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="classes-client-card-heading">
                      <div>
                        <p className="account-eyebrow">{locationLabel(sessionRecord.locationId)}</p>
                        <h2>{sessionRecord.title}</h2>
                      </div>
                      {booking ? (
                        <span
                          className={`classes-client-status classes-client-status-${booking.status}`}
                        >
                          {statusLabel(booking.status)}
                        </span>
                      ) : (
                        <span className="classes-client-status classes-client-status-available">
                          Available
                        </span>
                      )}
                    </div>
                    <p className="classes-client-time">
                      <time dateTime={sessionRecord.startAt}>
                        {formatDateTime(sessionRecord.startAt)}
                      </time>
                    </p>
                    {sessionRecord.isSeminar ? (
                      <p className="classes-client-seminar">Seminar</p>
                    ) : null}

                    {sessionFeedback ? (
                      <div
                        className={`classes-client-message classes-client-message-${sessionFeedback.tone}`}
                        role={sessionFeedback.tone === "error" ? "alert" : "status"}
                      >
                        <p>{sessionFeedback.text}</p>
                        {sessionFeedback.waitlist ? (
                          <a className="classes-client-waitlist-link" href="/account/waitlist">
                            Join the waitlist
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    {isConfirmed && booking ? (
                      isConfirming ? (
                        <form
                          className="classes-client-cancel-form"
                          onSubmit={(event) => void handleCancellation(event, booking)}
                        >
                          <label htmlFor={`cancel-reason-${booking.bookingId}`}>
                            Cancellation reason
                            <input
                              disabled={busyKey !== ""}
                              id={`cancel-reason-${booking.bookingId}`}
                              maxLength={200}
                              minLength={2}
                              onChange={(event) => setCancellationReason(event.target.value)}
                              required
                              value={cancellationReason}
                            />
                          </label>
                          <div className="classes-client-actions">
                            <button
                              className="button classes-client-danger"
                              disabled={busyKey !== "" || cancellationReason.trim().length < 2}
                              type="submit"
                            >
                              {busyKey === `cancel:${booking.bookingId}`
                                ? "Cancelling booking..."
                                : "Confirm cancellation"}
                            </button>
                            <button
                              className="button classes-client-secondary"
                              disabled={busyKey !== ""}
                              onClick={() => {
                                setConfirmingBookingId("");
                                setCancellationReason("");
                              }}
                              type="button"
                            >
                              Keep booking
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          className="button classes-client-secondary"
                          disabled={busyKey !== ""}
                          onClick={() => {
                            setConfirmingBookingId(booking.bookingId);
                            setCancellationReason("");
                            setFeedback(undefined);
                          }}
                          type="button"
                        >
                          Cancel booking
                        </button>
                      )
                    ) : isRequested ? (
                      <button className="button classes-client-secondary" disabled type="button">
                        Booking requested
                      </button>
                    ) : (
                      <button
                        className="button button-primary classes-client-book"
                        disabled={
                          busyKey !== "" || bookingsState !== "ready" || !selectedMembership
                        }
                        onClick={() => void handleBooking(sessionRecord)}
                        type="button"
                      >
                        {busyKey === `book:${sessionRecord.sessionId}`
                          ? "Requesting place..."
                          : "Reserve place"}
                      </button>
                    )}
                  </article>
                );
              })}
            </section>
          )}
          <p className="classes-client-participant-note">
            Showing classes and bookings for {participantLabel}. The academy validates every
            request.
          </p>
        </>
      )}
    </main>
  );
}

export default function AccountClassesPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/classes">
        <AccountClassesContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
