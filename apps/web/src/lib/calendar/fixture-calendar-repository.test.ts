import { nextSelfCheckInSession } from "@bpt-jersey/domain/schedule/self-check-in";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureCalendarRepository } from "./fixture-calendar-repository";

let weekAgo: string;
let inThreeWeeks: string;
let soon: string;
let later: string;
const jerseyWeekday = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
});

beforeEach(() => {
  // Ready sessions start 30 minutes from now, even on Sundays. Keep them on a Wednesday
  // while the surrounding weeks still exercise the timetable's exclusion of Sundays.
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-16T08:00:00.000Z") });
  weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  inThreeWeeks = new Date(Date.now() + 21 * 86400000).toISOString();
  soon = new Date(Date.now() - 3600000).toISOString();
  later = new Date(Date.now() + 3 * 3600000).toISOString();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fixture calendar repository", () => {
  it("gives a guardian two children and a teen one participant", async () => {
    const guardian = await createFixtureCalendarRepository("guardian").loadMember();
    expect(guardian.participants.map((p) => p.firstName)).toEqual(["Maya", "Leo"]);
    const teen = await createFixtureCalendarRepository("teenStudent").loadMember();
    expect(teen.participants).toHaveLength(1);
    expect(teen.participants[0]?.participantType).toBe("teens");
  });

  it("generates sessions for every weekday but Sunday, with programs", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    expect(week.sessions.length).toBeGreaterThan(20);
    const days = new Set(week.sessions.map((s) => jerseyWeekday.format(new Date(s.startAt))));
    expect(days.has("Sun")).toBe(false);
    expect([...days].sort()).toEqual(["Fri", "Mon", "Sat", "Thu", "Tue", "Wed"]);
    expect(week.programs.map((p) => p.programId)).toContain("prog-teens");
  });

  it("books and cancels round-trip", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    const target = week.sessions.find(
      (s) =>
        s.programId === "prog-teens" &&
        Date.parse(s.startAt) > Date.now() + 2 * 3600000 &&
        (week.bookedCounts[s.sessionId] ?? 0) < (s.capacity ?? Number.POSITIVE_INFINITY) &&
        !week.bookings.some((b) => b.sessionId === s.sessionId),
    );
    expect(target).toBeDefined();
    const sessionId = target?.sessionId ?? "";
    const booking = await repo.book({ kind: "membership", sessionId, studentId: "sam", membershipId: "m-sam" });
    expect(booking.status).toBe("confirmed");
    const after = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    expect(after.bookings.some((b) => b.sessionId === sessionId && b.status === "confirmed")).toBe(
      true,
    );
    const cancelled = await repo.cancel({
      sessionId,
      studentId: "sam",
      reason: "member_cancelled",
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("refuses to book a full session with the capacity reason", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    const full = week.sessions.find(
      (s) =>
        s.capacity !== null &&
        (week.bookedCounts[s.sessionId] ?? 0) >= s.capacity &&
        s.programId === "prog-teens",
    );
    expect(full).toBeDefined();
    await expect(
      repo.book({ kind: "membership", sessionId: full?.sessionId ?? "", studentId: "sam", membershipId: "m-sam" }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("seeds a pending penalty for Maya only", async () => {
    const repo = createFixtureCalendarRepository("guardian");
    expect(await repo.loadPenalties("maya")).toHaveLength(1);
    expect(await repo.loadPenalties("leo")).toHaveLength(0);
  });
});

describe("fixture self check-in", () => {
  const near = { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 };
  const far = { latitude: 49.185034, longitude: -2.107142, accuracyMeters: 12 };

  it("seeds one ready session per participant, 30 minutes from load", async () => {
    for (const [role, studentId] of [
      ["teenStudent", "sam"],
      ["adultStudent", "alex"],
      ["guardian", "maya"],
      ["guardian", "leo"],
    ] as const) {
      const repo = createFixtureCalendarRepository(role);
      const week = await repo.loadWeek(studentId, soon, later);
      const candidate = nextSelfCheckInSession({ ...week, nowMs: Date.now() });
      expect(candidate?.kind, `${role}/${studentId}`).toBe("ready");
    }
  });

  it("clocks in inside 50 m, refuses outside with the distance, and replays its own record", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", soon, later);
    const session = nextSelfCheckInSession({ ...week, nowMs: Date.now() })!.session;
    expect(session.locationId).toBe("town");
    await expect(
      repo.clockIn({ sessionId: session.sessionId, studentId: "sam", position: far }),
    ).rejects.toMatchObject({
      code: "functions/failed-precondition",
      details: { reason: "outside", distanceMeters: 120 },
    });
    const record = await repo.clockIn({
      sessionId: session.sessionId,
      studentId: "sam",
      position: near,
    });
    expect(record).toMatchObject({
      method: "self",
      state: "attended",
      sessionId: session.sessionId,
    });
    const after = await repo.loadWeek("sam", soon, later);
    expect(nextSelfCheckInSession({ ...after, nowMs: Date.now() })?.kind).toBe("checkedIn");
    await expect(
      repo.clockIn({ sessionId: session.sessionId, studentId: "sam", position: near }),
    ).resolves.toEqual(record);
  });

  it("refuses a session without a booking", async () => {
    const repo = createFixtureCalendarRepository("adultStudent");
    await expect(
      repo.clockIn({ sessionId: "nope", studentId: "alex", position: near }),
    ).rejects.toMatchObject({
      code: "functions/not-found",
    });
  });

  it("keeps direct fixture instances and member participants isolated", async () => {
    const first = createFixtureCalendarRepository("teenStudent");
    const second = createFixtureCalendarRepository("teenStudent");
    const firstWeek = await first.loadWeek("sam", soon, later);
    const session = nextSelfCheckInSession({ ...firstWeek, nowMs: Date.now() })!.session;

    await first.clockIn({ sessionId: session.sessionId, studentId: "sam", position: near });

    const secondWeek = await second.loadWeek("sam", soon, later);
    expect(nextSelfCheckInSession({ ...secondWeek, nowMs: Date.now() })?.kind).toBe("ready");
    expect(
      (await first.loadMember()).participants.map((participant) => participant.studentId),
    ).toEqual(["sam"]);
    expect((await first.loadWeek("alex", soon, later)).bookings).toEqual([]);
  });
});
