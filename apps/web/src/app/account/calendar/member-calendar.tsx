"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { weekRangeFor } from "@bpt-jersey/domain/schedule/classes-services";
import {
  calendarTimeZone,
  canViewMemberSession,
  deriveSessionStatus,
  jerseyWeekKey,
  nextOffset,
  prevOffset,
  visibleDays,
  type CalendarDay,
  type CalendarViewport,
} from "@bpt-jersey/domain/schedule/member-calendar";
import {
  sessionAccessMode,
  type AttendanceRecord,
  type BookingRecord,
  type PaygBookingPayment,
} from "@bpt-jersey/domain/schedule";
import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";
import { PLAN_CATALOG, type PlanId } from "@bpt-jersey/domain/memberships";
import type { TrialAccessView } from "@bpt-jersey/domain/memberships/trial-access";
import {
  nextSelfCheckInSession,
  type SelfCheckInCandidate,
} from "@bpt-jersey/domain/schedule/self-check-in";

import type {
  CalendarMember,
  CalendarRepository,
  CalendarRole,
  CalendarWeekData,
} from "../../../lib/calendar";
import {
  cachedMember,
  cachedWeek,
  saveCachedMember,
  saveCachedWeek,
  weekCacheKey,
} from "../../../lib/calendar/calendar-cache";
import {
  bookingFailureMessage,
  cancellationFailureMessage,
} from "../../../lib/calendar/booking-messages";
import { CalendarHeader } from "./calendar-header";
import { CancelDialog } from "./cancel-dialog";
import { DayColumn } from "./day-column";
import { PaygPaymentDialog } from "./payg-payment-dialog";
import { PenaltyBanner } from "./penalty-banner";
import { ReadyForJiuJitsu } from "./ready-for-jiu-jitsu";
import type { CalendarEntry } from "./session-card";

const desktopQuery = "(min-width: 58rem)";
const bookedNote = "Booked. Missing it costs £15.";
const noteLifetimeMs = 4000;
const pollIntervalMs = 60_000;

type MemberCalendarProps = Readonly<{
  repository: CalendarRepository;
  session: Readonly<{ role: CalendarMember["role"]; displayName: string }>;
  onSignOut: () => void;
  /** Rendered after the check-in slider and before the purple header: the streak panel (T042V2). */
  topSlot?: ReactNode;
  /** The signed-in uid: paints the last member and week at once while the live load runs. */
  cacheKey?: string;
}>;

type LoadState = "loading" | "ready" | "error";

type WeekScope = Readonly<{
  studentId: string;
  rangeFrom: string;
  rangeTo: string;
  revision: number;
}>;

function sameWeekScope(left: WeekScope | undefined, right: WeekScope | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.studentId === right.studentId &&
    left.rangeFrom === right.rangeFrom &&
    left.rangeTo === right.rangeTo &&
    left.revision === right.revision
  );
}

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

const trialEndedNotice = "Your trial has ended. Choose a membership to keep training.";
const memberVisibleStatuses: ReadonlySet<string> = new Set(["open", "booked", "attended", "missed"]);

/** How many free trial classes are still bookable: attended and booked ones are both spent. */
function trialClassesLeft(trial: TrialAccessView): number {
  return trial.allowance - trial.attendedCount - trial.futureBookings;
}

/** A pay-as-you-go plan charges per class, so each booking has to be paid for as it is made. */
function isPerSessionPlan(planId: PlanId | null): boolean {
  return PLAN_CATALOG.find((plan) => plan.planId === planId)?.billingPeriod === "per-session";
}

function planPriceMinor(planId: PlanId | null): number {
  return PLAN_CATALOG.find((plan) => plan.planId === planId)?.priceMinor ?? 0;
}

export function MemberCalendar({
  repository,
  session,
  onSignOut,
  topSlot,
  cacheKey,
}: MemberCalendarProps) {
  const viewport = useViewport();
  const now = useMinuteClock();
  const [offset, setOffset] = useState(0);
  const [member, setMember] = useState<CalendarMember>();
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [memberState, setMemberState] = useState<LoadState>("loading");
  const [week, setWeek] = useState<CalendarWeekData>();
  const [weekStudentId, setWeekStudentId] = useState("");
  const [weekRangeFrom, setWeekRangeFrom] = useState("");
  const [weekRangeTo, setWeekRangeTo] = useState("");
  const [weekState, setWeekState] = useState<LoadState>("loading");
  const [penalties, setPenalties] = useState<readonly NoShowPenaltyRecord[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [cancelling, setCancelling] = useState<CalendarEntry>();
  const [paying, setPaying] = useState<CalendarEntry>();
  const [reloadToken, setReloadToken] = useState(0);
  const [pollToken, setPollToken] = useState(0);
  const silentReload = useRef(false);
  const weekRevision = useRef(0);
  const activeWeekScope = useRef<WeekScope | undefined>(undefined);
  const loadedWeekScopeRef = useRef<WeekScope | undefined>(undefined);
  const [loadedWeekScope, setLoadedWeekScope] = useState<WeekScope>();
  const [siblingReady, setSiblingReady] = useState<
    Readonly<{
      studentId: string;
      names: readonly string[];
    }>
  >({ studentId: "", names: [] });

  const days = useMemo(() => visibleDays({ now, viewport, offset, includeSunday: true }), [now, viewport, offset]);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const loadFrom = firstDay
    ? weekRangeFor(jerseyWeekKey(firstDay.startAt), calendarTimeZone)
    : undefined;
  const loadTo = lastDay
    ? weekRangeFor(jerseyWeekKey(lastDay.startAt), calendarTimeZone)
    : undefined;
  // Whole Monday–Sunday weeks, so the weekly class count is right even when a phone shows two days.
  const rangeFrom = loadFrom?.ok ? loadFrom.value.from : "";
  const rangeTo = loadTo?.ok ? loadTo.value.to : "";

  useEffect(() => {
    setOffset(0);
  }, [viewport]);

  useEffect(() => {
    let active = true;
    const cached = cacheKey ? cachedMember(cacheKey) : undefined;
    setMemberState(cached ? "ready" : "loading");
    weekRevision.current += 1;
    activeWeekScope.current = undefined;
    loadedWeekScopeRef.current = undefined;
    setLoadedWeekScope(undefined);
    setWeek(undefined);
    setWeekStudentId("");
    setWeekRangeFrom("");
    setWeekRangeTo("");
    setPenalties([]);
    setSiblingReady({ studentId: "", names: [] });
    const applyMember = (loaded: CalendarMember) => {
      setMember(loaded);
      setSiblingReady({ studentId: "", names: [] });
      setSelectedStudentId((current) =>
        loaded.participants.some((p) => p.studentId === current)
          ? current
          : (loaded.participants[0]?.studentId ?? ""),
      );
      setMemberState("ready");
    };
    if (cached) applyMember(cached);
    repository
      .loadMember()
      .then((loaded) => {
        if (!active) return;
        applyMember(loaded);
        if (cacheKey) saveCachedMember(cacheKey, loaded);
      })
      .catch(() => {
        if (active) setMemberState("error");
      });
    return () => {
      active = false;
    };
  }, [repository, reloadToken, cacheKey]);

  useEffect(() => {
    if (!selectedStudentId || !rangeFrom || !rangeTo) return;
    let active = true;
    const requestedScope: WeekScope = {
      studentId: selectedStudentId,
      rangeFrom,
      rangeTo,
      revision: weekRevision.current,
    };
    activeWeekScope.current = requestedScope;
    const weekKey = weekCacheKey(requestedScope.studentId, rangeFrom, rangeTo);
    const applyWeek = (loadedWeek: CalendarWeekData) => {
      loadedWeekScopeRef.current = requestedScope;
      setLoadedWeekScope(requestedScope);
      setWeek(loadedWeek);
      setWeekStudentId(requestedScope.studentId);
      setWeekRangeFrom(requestedScope.rangeFrom);
      setWeekRangeTo(requestedScope.rangeTo);
      setWeekState("ready");
    };
    // A week this browser already showed paints now; the live answer below replaces it.
    const stale = cacheKey && !silentReload.current ? cachedWeek(cacheKey, weekKey) : undefined;
    if (stale) applyWeek(stale);
    else if (!silentReload.current) setWeekState("loading");
    silentReload.current = false;
    // Penalties are an ancillary banner: they load beside the week and never hold it back.
    void repository
      .loadPenalties(requestedScope.studentId)
      .then((loadedPenalties) => {
        if (active && sameWeekScope(requestedScope, activeWeekScope.current))
          setPenalties(loadedPenalties);
      })
      .catch(() => undefined);
    repository
      .loadWeek(requestedScope.studentId, requestedScope.rangeFrom, requestedScope.rangeTo)
      .then((loadedWeek) => {
        if (!active || !sameWeekScope(requestedScope, activeWeekScope.current)) return;
        applyWeek(loadedWeek);
        if (cacheKey) saveCachedWeek(cacheKey, weekKey, loadedWeek);
      })
      .catch(() => {
        if (active && sameWeekScope(requestedScope, activeWeekScope.current)) {
          setWeekState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [repository, selectedStudentId, rangeFrom, rangeTo, reloadToken, pollToken, cacheKey]);

  const participant = member?.participants.find((p) => p.studentId === selectedStudentId);
  const selectedWeek =
    weekStudentId === selectedStudentId && weekRangeFrom === rangeFrom && weekRangeTo === rangeTo
      ? week
      : undefined;

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    if (!selectedWeek || !participant) return map;
    const programs = new Map(selectedWeek.programs.map((p) => [p.programId, p]));
    const bookings = new Map(
      selectedWeek.bookings.filter((b) => b.status !== "cancelled").map((b) => [b.sessionId, b]),
    );
    const attendance = new Map(selectedWeek.attendance.map((a) => [a.sessionId, a]));
    const memberContext = {
      studentId: participant.studentId,
      membershipId: participant.membershipId,
      courseSessionIds: selectedWeek.courseSessionIds ?? [],
      ...(participant.membershipStartsAt
        ? {
            membershipStartsAt: participant.membershipStartsAt,
            membershipEndsAt: participant.membershipEndsAt,
          }
        : {}),
      participantType: participant.participantType,
      ...(participant.planParticipantTypes
        ? { planParticipantTypes: participant.planParticipantTypes }
        : {}),
      planClassSites: participant.planClassSites,
      planOpenMatSites: participant.planOpenMatSites,
      weeklyClassLimit: participant.weeklyClassLimit,
      ...(participant.introSite ? { introSite: participant.introSite } : {}),
      ...(participant.hasAttendedIntro !== undefined
        ? { hasAttendedIntro: participant.hasAttendedIntro }
        : {}),
      ...(participant.hasActiveMembership !== undefined
        ? { hasActiveMembership: participant.hasActiveMembership }
        : {}),
      ...(participant.trial ? { trial: participant.trial } : {}),
      ...(selectedWeek.groupAccess
        ? {
            additionalProgramIds: selectedWeek.groupAccess.programIds,
            dateOfBirth: selectedWeek.groupAccess.dateOfBirth,
          }
        : {}),
    };
    const classesBookedByWeek = new Map<string, number>();
    for (const row of selectedWeek.sessions) {
      const rowProgram = programs.get(row.programId);
      if (row.courseId || row.status === "cancelled" || !bookings.has(row.sessionId) || !rowProgram)
        continue;
      if (rowProgram.discipline === "open-mat") continue;
      const key = jerseyWeekKey(row.startAt);
      classesBookedByWeek.set(key, (classesBookedByWeek.get(key) ?? 0) + 1);
    }
    const sorted = [...selectedWeek.sessions]
      .filter((s) => s.status !== "cancelled")
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (const sessionRecord of sorted) {
      const program = programs.get(sessionRecord.programId);
      const day = dayOf(days, sessionRecord.startAt);
      if (!program || !day || !canViewMemberSession(sessionRecord, program, memberContext))
        continue;
      const booking = bookings.get(sessionRecord.sessionId);
      const derived = deriveSessionStatus({
        session: sessionRecord,
        program,
        member: memberContext,
        booking,
        attendance: attendance.get(sessionRecord.sessionId),
        bookedCount: selectedWeek.bookedCounts[sessionRecord.sessionId] ?? 0,
        weeklyClassesBooked: classesBookedByWeek.get(jerseyWeekKey(sessionRecord.startAt)) ?? 0,
        now,
      });
      // Members see what they can book, plus their own bookings and attendance; nothing else.
      if (!memberVisibleStatuses.has(derived.status)) continue;
      const list = map.get(day.dateKey) ?? [];
      list.push({ session: sessionRecord, program, derived, booking });
      map.set(day.dateKey, list);
    }
    return map;
  }, [selectedWeek, participant, days, now]);

  const candidate: SelfCheckInCandidate | undefined = useMemo(
    () =>
      selectedWeek && participant
        ? nextSelfCheckInSession({ ...selectedWeek, nowMs: now.getTime() })
        : undefined,
    [selectedWeek, participant, now],
  );
  const candidateProgram = candidate
    ? selectedWeek?.programs.find((program) => program.programId === candidate.session.programId)
    : undefined;
  const candidateKind = candidate?.kind;
  const candidateSessionId = candidate?.session.sessionId;
  const minuteKey = Math.floor(now.getTime() / pollIntervalMs);

  useEffect(() => {
    const others = (member?.participants ?? []).filter((p) => p.studentId !== selectedStudentId);
    if (member?.role !== "guardian" || others.length === 0) {
      setSiblingReady({ studentId: selectedStudentId, names: [] });
      return;
    }
    let active = true;
    const from = new Date(now.getTime() - 3 * 3600000).toISOString();
    const to = new Date(now.getTime() + 3 * 3600000).toISOString();
    Promise.all(
      others.map(async (p) => {
        const data = await repository.loadWeek(p.studentId, from, to);
        return nextSelfCheckInSession({ ...data, nowMs: now.getTime() })?.kind === "ready"
          ? p.firstName
          : undefined;
      }),
    )
      .then((names) => {
        if (active) {
          setSiblingReady({
            studentId: selectedStudentId,
            names: names.filter((name): name is string => Boolean(name)),
          });
        }
      })
      .catch(() => {
        if (active) setSiblingReady({ studentId: selectedStudentId, names: [] });
      });
    return () => {
      active = false;
    };
  }, [member, selectedStudentId, repository, pollToken, minuteKey, now]);

  useEffect(() => {
    if (!candidateKind) return;
    const timer = setInterval(() => {
      silentReload.current = true;
      setPollToken((value) => value + 1);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [candidateKind, candidateSessionId]);

  const applyBooking = useCallback((replacement: BookingRecord) => {
    setWeek((current) => {
      if (!current) return current;
      const others = current.bookings.filter((b) => b.sessionId !== replacement.sessionId);
      return { ...current, bookings: [replacement, ...others] };
    });
  }, []);

  /** Undo an optimistic change: put back what the session held before, or nothing. */
  const restoreBooking = useCallback((sessionId: string, previous: BookingRecord | undefined) => {
    setWeek((current) => {
      if (!current) return current;
      const others = current.bookings.filter((b) => b.sessionId !== sessionId);
      return { ...current, bookings: previous ? [previous, ...others] : others };
    });
  }, []);

  const handleCheckedIn = useCallback((scope: WeekScope, record: AttendanceRecord) => {
    if (
      !sameWeekScope(scope, activeWeekScope.current) ||
      !sameWeekScope(scope, loadedWeekScopeRef.current)
    ) {
      return;
    }
    const updatedScope = { ...scope, revision: scope.revision + 1 };
    weekRevision.current = updatedScope.revision;
    activeWeekScope.current = updatedScope;
    loadedWeekScopeRef.current = updatedScope;
    setLoadedWeekScope(updatedScope);
    setWeek((current) => {
      if (!current) return current;
      const others = current.attendance.filter(
        (attendance) => attendance.sessionId !== record.sessionId,
      );
      return { ...current, attendance: [record, ...others] };
    });
  }, []);

  const handleSelectStudent = useCallback(
    (studentId: string) => {
      if (studentId === selectedStudentId) return;
      silentReload.current = false;
      weekRevision.current += 1;
      activeWeekScope.current = undefined;
      loadedWeekScopeRef.current = undefined;
      setLoadedWeekScope(undefined);
      setWeek(undefined);
      setWeekStudentId("");
      setWeekRangeFrom("");
      setWeekRangeTo("");
      setPenalties([]);
      setSiblingReady({ studentId, names: [] });
      setSelectedStudentId(studentId);
    },
    [selectedStudentId],
  );

  const handleOffset = useCallback((nextOffset: number | null) => {
    if (nextOffset === null) return;
    silentReload.current = false;
    weekRevision.current += 1;
    activeWeekScope.current = undefined;
    loadedWeekScopeRef.current = undefined;
    setLoadedWeekScope(undefined);
    setOffset(nextOffset);
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
    async (entry: CalendarEntry, payment?: PaygBookingPayment) => {
      if (!participant || entry.session.courseId) return;
      // A trial student has no membership, so every class they book is booked as an intro one.
      const onTrial = participant.trial !== undefined && !participant.membershipId;
      const isIntro = onTrial || sessionAccessMode(entry.session) === "intro";
      if (!isIntro && !participant.membershipId) return;
      // Pay-as-you-go is paid for at booking: ask how before the place is taken.
      if (!isIntro && payment === undefined && isPerSessionPlan(participant.planId)) {
        setPaying(entry);
        return;
      }
      setBusyKey(entry.session.sessionId);
      // Show the place as taken at once; the server's answer confirms it or puts things back.
      if (!isIntro) {
        const at = new Date().toISOString();
        applyBooking({
          bookingId: "pending:" + entry.session.sessionId,
          academyId: entry.session.academyId,
          sessionId: entry.session.sessionId,
          studentId: participant.studentId,
          membershipId: participant.membershipId!,
          status: "confirmed",
          requestedAt: at,
          cancelledAt: null,
          cancellationReason: null,
          schemaVersion: "1",
          createdAt: at,
          createdBy: participant.studentId,
          updatedAt: at,
          updatedBy: participant.studentId,
        });
        flashNote(entry.session.sessionId, bookedNote);
      }
      try {
        const booking = await repository.book(
          isIntro
            ? {
                kind: "intro",
                sessionId: entry.session.sessionId,
                studentId: participant.studentId,
              }
            : {
                kind: "membership",
                sessionId: entry.session.sessionId,
                studentId: participant.studentId,
                membershipId: participant.membershipId!,
                ...(payment ? { paygPayment: payment } : {}),
              },
        );
        applyBooking(booking);
        if (isIntro) flashNote(entry.session.sessionId, "Intro Class booked.");
      } catch (error) {
        if (!isIntro) restoreBooking(entry.session.sessionId, entry.booking);
        flashNote(entry.session.sessionId, bookingFailureMessage(error));
      } finally {
        setBusyKey("");
      }
    },
    [participant, repository, applyBooking, restoreBooking, flashNote],
  );

  const handleConfirmCancel = useCallback(
    async (entry: CalendarEntry) => {
      if (!participant) return;
      setBusyKey(entry.session.sessionId);
      try {
        if (entry.session.courseId && repository.setCourseAbsence) {
          const absent = entry.booking?.schemaVersion === "2" && entry.booking.absent;
          applyBooking(
            await repository.setCourseAbsence(
              entry.session.sessionId,
              participant.studentId,
              !absent,
            ),
          );
          return;
        }
        // Close the dialog and free the place on screen at once; a refusal puts the booking back.
        setCancelling(undefined);
        if (entry.booking) applyBooking({ ...entry.booking, status: "cancelled" });
        const booking = await repository.cancel({
          sessionId: entry.session.sessionId,
          studentId: participant.studentId,
          reason: "member_cancelled",
        });
        applyBooking(booking);
      } catch (error) {
        if (!entry.session.courseId) restoreBooking(entry.session.sessionId, entry.booking);
        flashNote(entry.session.sessionId, cancellationFailureMessage(error));
      } finally {
        setBusyKey("");
        setCancelling(undefined);
      }
    },
    [participant, repository, applyBooking, restoreBooking, flashNote],
  );

  const next = nextOffset(viewport, offset, now, true);
  const prev = prevOffset(viewport, offset, now, true);
  const weekColumns = days.map((day) => (day.isToday ? "1.6fr" : "1fr")).join(" ");
  const weekStyle = { "--week-columns": weekColumns } as React.CSSProperties;
  const failed = memberState === "error" || weekState === "error";
  // No active/trial membership on a known plan: the week effect never runs, so say so plainly.
  const noParticipants = memberState === "ready" && (member?.participants.length ?? 0) === 0;
  const loading = memberState === "loading" || weekState === "loading";
  const siblingHint =
    siblingReady.studentId === selectedStudentId && siblingReady.names.length > 0
      ? siblingReady.names[0] + " is ready too — switch to " + siblingReady.names[0]
      : undefined;
  const candidateScope = candidate && participant ? loadedWeekScope : undefined;

  return (
    <main className="member-app">
      {!failed && weekState === "ready" && candidate && participant ? (
        <ReadyForJiuJitsu
          candidate={candidate}
          clockIn={(input) => repository.clockIn(input)}
          key={participant.studentId + ":" + candidate.session.sessionId}
          onCheckedIn={(record) => {
            if (candidateScope) handleCheckedIn(candidateScope, record);
          }}
          studentId={participant.studentId}
          {...(candidateProgram ? { program: candidateProgram } : {})}
          {...(siblingHint ? { siblingHint } : {})}
        />
      ) : null}
      {topSlot}
      <CalendarHeader
        canNext={!failed && next !== null}
        canPrev={!failed && prev !== null}
        days={days}
        displayName={session.displayName}
        onNext={() => handleOffset(next)}
        onPrev={() => handleOffset(prev)}
        onSelectStudent={handleSelectStudent}
        onSignOut={onSignOut}
        participants={member?.participants ?? []}
        selectedStudentId={selectedStudentId}
      />
      {!failed && weekState === "ready" && hasPendingPenalty(penalties) ? <PenaltyBanner /> : null}
      {!failed && participant?.trial ? (
        <p className="calendar-trial-band" role="status">
          {participant.trial.status === "active" && trialClassesLeft(participant.trial) > 0 ? (
            `Trial · ${trialClassesLeft(participant.trial)} of ${participant.trial.allowance} classes left · ends ${new Date(participant.trial.expiresAt).toLocaleDateString("en-GB")}`
          ) : (
            <>
              {trialEndedNotice}{" "}
              <a href="/account/membership">Choose a plan</a>
            </>
          )}
        </p>
      ) : null}
      {!failed && memberState === "ready" && participant && !participant.trial &&
      participant.hasActiveMembership === false ? (
        <p className="calendar-trial-band" role="status">
          {participant.firstName} has no active plan, so only free Intro Classes can be booked.{" "}
          <a href="/account/membership">Choose a plan</a>
        </p>
      ) : null}
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
        ) : noParticipants ? (
          <div className="calendar-error" role="status">
            <p>
              Your account is not linked to a member yet. Please contact the academy and they will
              set it up for you.
            </p>
          </div>
        ) : (
          <div className="member-week" style={weekStyle}>
            {days.map((day) => (
              <DayColumn
                busyKey={busyKey}
                day={day}
                entries={entriesByDay.get(day.dateKey) ?? []}
                hasTrial={participant?.trial !== undefined}
                key={day.dateKey}
                loading={loading}
                notes={notes}
                now={now}
                onBook={(entry) => void handleBook(entry)}
                onCancelRequest={(entry) =>
                  entry.session.courseId ? void handleConfirmCancel(entry) : setCancelling(entry)
                }
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
      {paying && participant ? (
        <PaygPaymentDialog
          key={paying.session.sessionId}
          onChoose={(payment) => {
            const entry = paying;
            setPaying(undefined);
            void handleBook(entry, payment);
          }}
          onClose={() => setPaying(undefined)}
          priceMinor={planPriceMinor(participant.planId)}
          session={paying.session}
          studentId={participant.studentId}
        />
      ) : null}
    </main>
  );
}
