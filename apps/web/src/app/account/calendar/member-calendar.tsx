"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deriveSessionStatus,
  nextOffset,
  prevOffset,
  visibleDays,
  type CalendarDay,
  type CalendarViewport,
} from "@bpt-jersey/domain/schedule/member-calendar";
import type { BookingRecord } from "@bpt-jersey/domain/schedule";
import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";

import type {
  CalendarMember,
  CalendarRepository,
  CalendarRole,
  CalendarWeekData,
} from "../../../lib/calendar";
import {
  bookingFailureMessage,
  cancellationFailureMessage,
} from "../../../lib/calendar/booking-messages";
import { CalendarHeader } from "./calendar-header";
import { CancelDialog } from "./cancel-dialog";
import { DayColumn } from "./day-column";
import { PenaltyBanner } from "./penalty-banner";
import type { CalendarEntry } from "./session-card";

const desktopQuery = "(min-width: 58rem)";
const bookedNote = "Booked. Missing it costs £15.";
const noteLifetimeMs = 4000;

type MemberCalendarProps = Readonly<{
  repository: CalendarRepository;
  session: Readonly<{ role: CalendarRole; displayName: string }>;
  onSignOut: () => void;
}>;

type LoadState = "loading" | "ready" | "error";

function useViewport(): CalendarViewport {
  const [viewport, setViewport] = useState<CalendarViewport>("phone");
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(desktopQuery);
    const apply = () => setViewport(media.matches ? "desktop" : "phone");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return viewport;
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function hasPendingPenalty(penalties: readonly NoShowPenaltyRecord[]): boolean {
  return penalties.some(
    (p) => (p.status === "proposed" || p.status === "charged") && p.resolution === null,
  );
}

function dayOf(days: readonly CalendarDay[], startAt: string): CalendarDay | undefined {
  return days.find((d) => startAt >= d.startAt && startAt < d.endAt);
}

export function MemberCalendar({ repository, session, onSignOut }: MemberCalendarProps) {
  const viewport = useViewport();
  const now = useMinuteClock();
  const [offset, setOffset] = useState(0);
  const [member, setMember] = useState<CalendarMember>();
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [memberState, setMemberState] = useState<LoadState>("loading");
  const [week, setWeek] = useState<CalendarWeekData>();
  const [weekState, setWeekState] = useState<LoadState>("loading");
  const [penalties, setPenalties] = useState<readonly NoShowPenaltyRecord[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [cancelling, setCancelling] = useState<CalendarEntry>();
  const [reloadToken, setReloadToken] = useState(0);

  const days = useMemo(() => visibleDays({ now, viewport, offset }), [now, viewport, offset]);
  const rangeFrom = days[0]?.startAt ?? "";
  const rangeTo = days[days.length - 1]?.endAt ?? "";

  useEffect(() => {
    setOffset(0);
  }, [viewport]);

  useEffect(() => {
    let active = true;
    setMemberState("loading");
    repository
      .loadMember()
      .then((loaded) => {
        if (!active) return;
        setMember(loaded);
        setSelectedStudentId((current) =>
          loaded.participants.some((p) => p.studentId === current)
            ? current
            : (loaded.participants[0]?.studentId ?? ""),
        );
        setMemberState("ready");
      })
      .catch(() => {
        if (active) setMemberState("error");
      });
    return () => {
      active = false;
    };
  }, [repository, reloadToken]);

  useEffect(() => {
    if (!selectedStudentId || !rangeFrom || !rangeTo) return;
    let active = true;
    setWeekState("loading");
    Promise.all([
      repository.loadWeek(selectedStudentId, rangeFrom, rangeTo),
      repository.loadPenalties(selectedStudentId),
    ])
      .then(([loadedWeek, loadedPenalties]) => {
        if (!active) return;
        setWeek(loadedWeek);
        setPenalties(loadedPenalties);
        setWeekState("ready");
      })
      .catch(() => {
        if (active) setWeekState("error");
      });
    return () => {
      active = false;
    };
  }, [repository, selectedStudentId, rangeFrom, rangeTo, reloadToken]);

  const participant = member?.participants.find((p) => p.studentId === selectedStudentId);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    if (!week || !participant) return map;
    const programs = new Map(week.programs.map((p) => [p.programId, p]));
    const bookings = new Map(
      week.bookings.filter((b) => b.status !== "cancelled").map((b) => [b.sessionId, b]),
    );
    const attendance = new Map(week.attendance.map((a) => [a.sessionId, a]));
    const memberContext = {
      studentId: participant.studentId,
      membershipId: participant.membershipId,
      participantType: participant.participantType,
      planClassSites: participant.planClassSites,
      planOpenMatSites: participant.planOpenMatSites,
    };
    const sorted = [...week.sessions]
      .filter((s) => s.status !== "cancelled")
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (const sessionRecord of sorted) {
      const program = programs.get(sessionRecord.programId);
      const day = dayOf(days, sessionRecord.startAt);
      if (!program || !day) continue;
      const booking = bookings.get(sessionRecord.sessionId);
      const derived = deriveSessionStatus({
        session: sessionRecord,
        program,
        member: memberContext,
        booking,
        attendance: attendance.get(sessionRecord.sessionId),
        bookedCount: week.bookedCounts[sessionRecord.sessionId] ?? 0,
        now,
      });
      const list = map.get(day.dateKey) ?? [];
      list.push({ session: sessionRecord, program, derived, booking });
      map.set(day.dateKey, list);
    }
    return map;
  }, [week, participant, days, now]);

  const applyBooking = useCallback((replacement: BookingRecord) => {
    setWeek((current) => {
      if (!current) return current;
      const others = current.bookings.filter((b) => b.sessionId !== replacement.sessionId);
      return { ...current, bookings: [replacement, ...others] };
    });
  }, []);

  const flashNote = useCallback((sessionId: string, text: string) => {
    setNotes((current) => ({ ...current, [sessionId]: text }));
    setTimeout(() => {
      setNotes((current) => {
        const rest = { ...current };
        delete rest[sessionId];
        return rest;
      });
    }, noteLifetimeMs);
  }, []);

  const handleBook = useCallback(
    async (entry: CalendarEntry) => {
      if (!participant) return;
      setBusyKey(entry.session.sessionId);
      try {
        const booking = await repository.book({
          sessionId: entry.session.sessionId,
          studentId: participant.studentId,
          membershipId: participant.membershipId,
        });
        applyBooking(booking);
        flashNote(entry.session.sessionId, bookedNote);
      } catch (error) {
        flashNote(entry.session.sessionId, bookingFailureMessage(error));
      } finally {
        setBusyKey("");
      }
    },
    [participant, repository, applyBooking, flashNote],
  );

  const handleConfirmCancel = useCallback(
    async (entry: CalendarEntry) => {
      if (!participant) return;
      setBusyKey(entry.session.sessionId);
      try {
        const booking = await repository.cancel({
          sessionId: entry.session.sessionId,
          studentId: participant.studentId,
          reason: "member_cancelled",
        });
        applyBooking(booking);
      } catch (error) {
        flashNote(entry.session.sessionId, cancellationFailureMessage(error));
      } finally {
        setBusyKey("");
        setCancelling(undefined);
      }
    },
    [participant, repository, applyBooking, flashNote],
  );

  const next = nextOffset(viewport, offset, now);
  const prev = prevOffset(viewport, offset, now);
  const weekColumns = days.map((day) => (day.isToday ? "1.6fr" : "1fr")).join(" ");
  const weekStyle = { "--week-columns": weekColumns } as React.CSSProperties;
  const failed = memberState === "error" || weekState === "error";
  const loading = memberState === "loading" || weekState === "loading";

  return (
    <main className="member-app">
      <CalendarHeader
        canNext={!failed && next !== null}
        canPrev={!failed && prev !== null}
        days={days}
        displayName={session.displayName}
        onNext={() => next !== null && setOffset(next)}
        onPrev={() => prev !== null && setOffset(prev)}
        onSelectStudent={setSelectedStudentId}
        onSignOut={onSignOut}
        participants={member?.participants ?? []}
        selectedStudentId={selectedStudentId}
      />
      {!failed && weekState === "ready" && hasPendingPenalty(penalties) ? <PenaltyBanner /> : null}
      <div className="member-body">
        {failed ? (
          <div className="calendar-error" role="alert">
            <p>Couldn&apos;t load your calendar.</p>
            <button
              className="session-action"
              onClick={() => setReloadToken((value) => value + 1)}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="member-week" style={weekStyle}>
            {days.map((day) => (
              <DayColumn
                busyKey={busyKey}
                day={day}
                entries={entriesByDay.get(day.dateKey) ?? []}
                key={day.dateKey}
                loading={loading}
                notes={notes}
                now={now}
                onBook={(entry) => void handleBook(entry)}
                onCancelRequest={setCancelling}
              />
            ))}
          </div>
        )}
      </div>
      <CancelDialog
        busy={busyKey !== ""}
        day={cancelling ? dayOf(days, cancelling.session.startAt) : undefined}
        entry={cancelling}
        onConfirm={(entry) => void handleConfirmCancel(entry)}
        onKeep={() => setCancelling(undefined)}
      />
    </main>
  );
}
