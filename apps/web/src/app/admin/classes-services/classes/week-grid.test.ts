import { describe, expect, it } from "vitest";
import { dayLabel, layoutWeek, mondayOf, weekDays } from "./week-grid";

const base = {
  colour: "#F0EFFF",
  booked: 0,
  capacity: null,
  status: "scheduled" as const,
  locationId: "town",
  programId: "p",
  instructorIds: ["c"],
};

describe("week grid", () => {
  it("finds the Monday of any date and lists the seven days", () => {
    expect(mondayOf("2026-09-16")).toBe("2026-09-14");
    expect(weekDays("2026-09-14")).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(dayLabel("2026-09-14")).toBe("MON 14/9");
  });

  it("places sessions in half-hour rows of the academy timezone and counts per day", () => {
    const layout = layoutWeek(
      [
        {
          ...base,
          sessionId: "a",
          title: "GI",
          startAt: "2026-09-14T16:30:00.000Z",
          endAt: "2026-09-14T17:30:00.000Z",
          booked: 2,
          capacity: 40,
        },
        {
          ...base,
          sessionId: "b",
          title: "NoGI",
          startAt: "2026-09-14T17:30:00.000Z",
          endAt: "2026-09-14T18:30:00.000Z",
          booked: 3,
        },
      ],
      "2026-09-14",
      "Europe/Jersey",
      { fromHour: 6, toHour: 20 },
    );
    const monday = layout.days[0]!;
    expect(monday.classes).toBe(2);
    expect(monday.registrations).toBe(5);
    expect(monday.sessions[0]).toMatchObject({
      sessionId: "a",
      rowStart: 23,
      rowSpan: 2,
      column: 0,
      columns: 1,
    }); // 17:30 local = fila (17.5-6)*2 = 23
    expect(layout.hours).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("splits overlapping sessions into columns, at most two", () => {
    const at = (h: string) => `2026-09-14T${h}:00.000Z`;
    const layout = layoutWeek(
      [
        { ...base, sessionId: "a", title: "A", startAt: at("06:00"), endAt: at("07:00") },
        { ...base, sessionId: "b", title: "B", startAt: at("06:00"), endAt: at("07:00") },
        { ...base, sessionId: "c", title: "C", startAt: at("06:30"), endAt: at("07:30") },
      ],
      "2026-09-14",
      "Europe/Jersey",
      { fromHour: 6, toHour: 20 },
    );
    const placed = layout.days[0]!.sessions;
    expect(placed.map((s) => [s.sessionId, s.column, s.columns])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
    ]);
  });
});
