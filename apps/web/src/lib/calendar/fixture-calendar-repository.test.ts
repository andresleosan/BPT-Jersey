import { describe, expect, it } from "vitest";

import { createFixtureCalendarRepository } from "./fixture-calendar-repository";

const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
const inThreeWeeks = new Date(Date.now() + 21 * 86400000).toISOString();
const jerseyWeekday = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
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
    expect(week.programs.map((p) => p.programId)).toContain("prog-teens");
  });

  it("books and cancels round-trip", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    const target = week.sessions.find(
      (s) =>
        s.programId === "prog-teens" &&
        Date.parse(s.startAt) > Date.now() + 2 * 3600000 &&
        (week.bookedCounts[s.sessionId] ?? 0) < s.capacity &&
        !week.bookings.some((b) => b.sessionId === s.sessionId),
    );
    expect(target).toBeDefined();
    const sessionId = target?.sessionId ?? "";
    const booking = await repo.book({ sessionId, studentId: "sam", membershipId: "m-sam" });
    expect(booking.status).toBe("confirmed");
    const after = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    expect(
      after.bookings.some((b) => b.sessionId === sessionId && b.status === "confirmed"),
    ).toBe(true);
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
      (s) => (week.bookedCounts[s.sessionId] ?? 0) >= s.capacity && s.programId === "prog-teens",
    );
    expect(full).toBeDefined();
    await expect(
      repo.book({ sessionId: full?.sessionId ?? "", studentId: "sam", membershipId: "m-sam" }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("seeds a pending penalty for Maya only", async () => {
    const repo = createFixtureCalendarRepository("guardian");
    expect(await repo.loadPenalties("maya")).toHaveLength(1);
    expect(await repo.loadPenalties("leo")).toHaveLength(0);
  });
});
