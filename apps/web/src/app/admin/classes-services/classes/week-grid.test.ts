import { describe, expect, it } from "vitest";
import {
  compressEmptyRows,
  countSessionDays,
  dayLabel,
  layoutWeek,
  markerBand,
  mondayOf,
  nowMarker,
  weekDays,
} from "./week-grid";

const base = {
  colour: "#F0EFFF",
  booked: 0,
  capacity: 20,
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

  it("keeps missing registration totals unknown in both week and month summaries", () => {
    const rows = [
      {
        ...base,
        sessionId: "pending",
        title: "Pending counts",
        startAt: "2026-09-14T16:00:00.000Z",
        endAt: "2026-09-14T17:00:00.000Z",
        booked: null,
      },
    ];
    expect(
      layoutWeek(rows, "2026-09-14", "Europe/Jersey", { fromHour: 6, toHour: 23 }).days[0],
    ).toMatchObject({ classes: 1, registrations: null });
    expect(countSessionDays(rows, "Europe/Jersey").get("2026-09-14")).toEqual({
      classes: 1,
      registrations: null,
    });
  });

  it("gives every overlapping session a separate column", () => {
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
      ["a", 0, 3],
      ["b", 1, 3],
      ["c", 2, 3],
    ]);
  });

  it("clamps a session starting before the window to a one-row marker at the top edge", () => {
    const layout = layoutWeek(
      [
        {
          ...base,
          sessionId: "early",
          title: "Early",
          startAt: "2026-09-14T04:00:00.000Z", // 05:00 local (BST)
          endAt: "2026-09-14T04:30:00.000Z", // 05:30 local
        },
      ],
      "2026-09-14",
      "Europe/Jersey",
      { fromHour: 6, toHour: 20 },
    );
    expect(layout.days[0]!.sessions[0]).toMatchObject({ rowStart: 0, rowSpan: 1 });
  });

  it("clamps a session ending after the window to a one-row marker at the bottom edge", () => {
    const layout = layoutWeek(
      [
        {
          ...base,
          sessionId: "late",
          title: "Late",
          startAt: "2026-09-14T20:00:00.000Z", // 21:00 local (BST)
          endAt: "2026-09-14T20:30:00.000Z", // 21:30 local
        },
      ],
      "2026-09-14",
      "Europe/Jersey",
      { fromHour: 6, toHour: 20 },
    );
    expect(layout.days[0]!.sessions[0]).toMatchObject({ rowStart: 27, rowSpan: 1 });
  });

  it("excludes cancelled sessions from the classes and registrations counts", () => {
    const layout = layoutWeek(
      [
        {
          ...base,
          sessionId: "a",
          title: "A",
          startAt: "2026-09-14T06:00:00.000Z",
          endAt: "2026-09-14T07:00:00.000Z",
          booked: 4,
        },
        {
          ...base,
          sessionId: "b",
          title: "B",
          startAt: "2026-09-14T08:00:00.000Z",
          endAt: "2026-09-14T09:00:00.000Z",
          booked: 6,
          status: "cancelled",
        },
      ],
      "2026-09-14",
      "Europe/Jersey",
      { fromHour: 6, toHour: 20 },
    );
    expect(layout.days[0]!.classes).toBe(1);
    expect(layout.days[0]!.registrations).toBe(4);
  });

  it("marks today and places the now line as a share of the visible hours, in the academy timezone", () => {
    const window = { fromHour: 6, toHour: 24 };
    // 14:30 in Jersey (BST, UTC+1) on Thursday 17 September.
    expect(nowMarker("2026-09-17T13:30:00.000Z", "2026-09-14", "Europe/Jersey", window)).toEqual({
      date: "2026-09-17",
      top: (14.5 - 6) / 18,
    });
    // Before the window: today is still marked, but no line is drawn.
    expect(nowMarker("2026-09-17T04:00:00.000Z", "2026-09-14", "Europe/Jersey", window)).toEqual({
      date: "2026-09-17",
      top: null,
    });
    // Another week on screen: nothing to mark.
    expect(nowMarker("2026-09-24T13:30:00.000Z", "2026-09-14", "Europe/Jersey", window)).toBeNull();
  });
});

it("counts monthly classes once using local dates and excludes cancelled history", () => {
  const rows = [
    {
      ...base,
      sessionId: "late",
      title: "Late",
      startAt: "2026-09-14T23:30:00.000Z",
      endAt: "2026-09-15T00:30:00.000Z",
      booked: 3,
    },
    {
      ...base,
      sessionId: "cancelled",
      title: "Cancelled",
      startAt: "2026-09-14T23:30:00.000Z",
      endAt: "2026-09-15T00:30:00.000Z",
      status: "cancelled" as const,
      booked: 8,
    },
  ];
  expect([...countSessionDays(rows, "Europe/Jersey")]).toEqual([
    ["2026-09-15", { classes: 1, registrations: 3 }],
  ]);
});

describe("compressEmptyRows", () => {
  const window = { fromHour: 7, toHour: 21 };
  const split = [
    // 07:00–09:00 local (BST) on Monday and 18:00–21:00 local on Wednesday.
    {
      ...base,
      sessionId: "morning",
      title: "Morning",
      startAt: "2026-09-14T06:00:00.000Z",
      endAt: "2026-09-14T08:00:00.000Z",
    },
    {
      ...base,
      sessionId: "evening",
      title: "Evening",
      startAt: "2026-09-16T17:00:00.000Z",
      endAt: "2026-09-16T20:00:00.000Z",
    },
  ];

  it("folds the hours with no class on any day into one labelled band", () => {
    const bands = compressEmptyRows(layoutWeek(split, "2026-09-14", "Europe/Jersey", window));
    expect(bands).toEqual([
      { kind: "rows", startRow: 0, endRow: 4 },
      { kind: "gap", startRow: 4, endRow: 22, label: "09:00 – 18:00 · no classes" },
      { kind: "rows", startRow: 22, endRow: 28 },
    ]);
  });

  it("never folds part of an hour that holds a class on any day", () => {
    const bands = compressEmptyRows(
      layoutWeek(
        [
          {
            ...base,
            sessionId: "tue",
            title: "Tuesday",
            // 13:30–14:30 local (BST).
            startAt: "2026-09-15T12:30:00.000Z",
            endAt: "2026-09-15T13:30:00.000Z",
          },
        ],
        "2026-09-14",
        "Europe/Jersey",
        window,
      ),
    );
    expect(bands).toEqual([
      { kind: "gap", startRow: 0, endRow: 12, label: "07:00 – 13:00 · no classes" },
      { kind: "rows", startRow: 12, endRow: 16 },
      { kind: "gap", startRow: 16, endRow: 28, label: "15:00 – 21:00 · no classes" },
    ]);
  });

  it("assigns a now line that falls in a folded band to that band", () => {
    const bands = compressEmptyRows(layoutWeek(split, "2026-09-14", "Europe/Jersey", window));
    // 12:00 local on Monday, inside the 09:00 – 18:00 band.
    const marker = nowMarker("2026-09-14T11:00:00.000Z", "2026-09-14", "Europe/Jersey", window);
    expect(markerBand(bands, marker!.top!)).toEqual({ band: 1, share: (10 - 4) / 18 });
    // 08:00 local: inside the first band of rows, half way down.
    const early = nowMarker("2026-09-14T07:00:00.000Z", "2026-09-14", "Europe/Jersey", window);
    expect(markerBand(bands, early!.top!)).toEqual({ band: 0, share: 0.5 });
    // The very end of the window belongs to the last band.
    expect(markerBand(bands, 1)).toEqual({ band: 2, share: 1 });
  });
});
