import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "./calendar-view";
import { mondayOf } from "./week-grid";
import type { GridSession } from "./week-grid";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("./use-compact-calendar", () => ({ useCompactCalendar: () => viewport.compact }));

afterEach(() => {
  viewport.compact = false;
  cleanup();
});

const base: Omit<GridSession, "sessionId" | "title" | "startAt" | "endAt"> = {
  colour: "#F0EFFF",
  booked: 2,
  capacity: 40,
  status: "scheduled",
  locationId: "town",
  programId: "p",
  instructorIds: ["c"],
};

const window = { fromHour: 6, toHour: 20 };

function noop(): void {
  // intentionally empty
}

describe("CalendarView", () => {
  it("uses the selected mobile day and follows a Today reset from its parent", () => {
    viewport.compact = true;
    const onSelectDate = vi.fn();
    const props = {
      view: "week" as const,
      weekStart: "2026-09-14",
      timezone: "Europe/Jersey",
      window,
      canEdit: false,
      onOpen: noop,
      onCreate: noop,
      onSelectWeek: noop,
      onSelectDate,
      sessions: [
        {
          ...base,
          sessionId: "wed",
          title: "Wednesday class",
          startAt: "2026-09-16T16:00:00.000Z",
          endAt: "2026-09-16T17:00:00.000Z",
        },
      ],
    };
    const { rerender } = render(<CalendarView {...props} selectedDate="2026-09-16" />);
    expect(screen.getByRole("button", { name: /Wednesday class/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Day to show"), { target: { value: "2026-09-17" } });
    expect(onSelectDate).toHaveBeenCalledWith("2026-09-17");
    rerender(<CalendarView {...props} selectedDate="2026-09-14" />);
    expect(screen.getByLabelText("Day to show")).toHaveValue("2026-09-14");
    expect(screen.queryByRole("button", { name: /Wednesday class/ })).not.toBeInTheDocument();
    expect(screen.getByText("No classes match this day and these filters.")).toBeInTheDocument();
  });

  it("marks today's column and places the now line on it, only for the week that holds today", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 13:00 in Jersey (BST) on Wednesday 16 September: 7 of the 14 visible hours have passed.
    vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));
    try {
      const props = {
        view: "week" as const,
        sessions: [
          {
            ...base,
            sessionId: "noon",
            title: "Noon class",
            // 12:00–14:00 local, so 13:00 sits half way down its band of rows.
            startAt: "2026-09-16T11:00:00.000Z",
            endAt: "2026-09-16T13:00:00.000Z",
          },
        ],
        timezone: "Europe/Jersey",
        window,
        canEdit: false,
        onOpen: noop,
        onCreate: noop,
        onSelectWeek: noop,
      };
      const { container, rerender } = render(<CalendarView {...props} weekStart="2026-09-14" />);
      const today = container.querySelectorAll("[aria-current='date']");
      expect(today).toHaveLength(1);
      expect(today[0]).toHaveTextContent("WED 16/9");
      const grid = container.querySelector<HTMLElement>(".cs-day[data-today] .cs-day-grid");
      expect(grid?.style.getPropertyValue("--now")).toBe("0.5");
      rerender(<CalendarView {...props} weekStart="2026-09-21" />);
      expect(container.querySelectorAll("[aria-current='date']")).toHaveLength(0);
      expect(container.querySelector(".cs-day[data-today]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders one button per session with title and local time, and opens it on click", () => {
    const onOpen = vi.fn();
    const sessions: GridSession[] = [
      {
        ...base,
        sessionId: "a",
        title: "GI Fundamentals",
        startAt: "2026-09-14T16:30:00.000Z",
        endAt: "2026-09-14T17:30:00.000Z",
      },
    ];
    render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={sessions}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={onOpen}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    const btn = screen.getByRole("button", { name: /GI Fundamentals/ });
    expect(btn).toHaveTextContent("17:30 – 18:30");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("renders create slots only when canEdit is true, but the rule cells always exist", () => {
    const sessions: GridSession[] = [];
    const onCreate = vi.fn();
    const { container, rerender } = render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={sessions}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={onCreate}
        onSelectWeek={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /06:00 – 20:00 · no classes/ }));
    expect(screen.queryByLabelText("Create a class on MON 14/9 at 06:30")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Create a class/ })).toHaveLength(0);
    expect(container.querySelectorAll(".cs-slot").length).toBeGreaterThan(0);

    rerender(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={sessions}
        timezone="Europe/Jersey"
        window={window}
        canEdit={true}
        onOpen={noop}
        onCreate={onCreate}
        onSelectWeek={noop}
      />,
    );
    const slot = screen.getByLabelText("Create a class on MON 14/9 at 06:30");
    expect(slot.tabIndex).toBe(-1);
    fireEvent.click(slot);
    expect(onCreate).toHaveBeenCalledWith("2026-09-14", "06:30");
  });

  it("asks for a capacity on the chip of a session without one", () => {
    const sessions: GridSession[] = [
      {
        ...base,
        capacity: null,
        sessionId: "a",
        title: "Legacy Class",
        startAt: "2026-09-14T16:30:00.000Z",
        endAt: "2026-09-14T17:30:00.000Z",
      },
    ];
    render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={sessions}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    const card = screen.getByRole("button", { name: /Legacy Class/ });
    expect(card).toHaveTextContent("Set capacity");
    expect(card).not.toHaveTextContent("∞");
  });

  it("marks cancelled sessions with data-status and a textual state", () => {
    const sessions: GridSession[] = [
      {
        ...base,
        sessionId: "a",
        title: "Cancelled Class",
        status: "cancelled",
        startAt: "2026-09-14T16:30:00.000Z",
        endAt: "2026-09-14T17:30:00.000Z",
      },
    ];
    render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={sessions}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    const card = screen.getByRole("button", { name: /Cancelled Class/ });
    expect(card).toHaveAttribute("data-status", "cancelled");
    // The colour alone does not reach a screen reader; the accessible name has to say it.
    expect(card).toHaveAccessibleName(/Cancelled$/u);
  });

  it("month view calls onSelectWeek with the Monday of the clicked day", () => {
    const onSelectWeek = vi.fn();
    render(
      <CalendarView
        view="month"
        weekStart="2026-09-14"
        sessions={[]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={onSelectWeek}
      />,
    );
    fireEvent.click(screen.getAllByLabelText("Open the week of Monday 21 September 2026")[0]!);
    expect(onSelectWeek).toHaveBeenCalledWith(mondayOf("2026-09-21"));
  });

  it("month cells always show a classes/registrations count, including zero", () => {
    render(
      <CalendarView
        view="month"
        weekStart="2026-09-14"
        sessions={[]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    expect(
      screen.getAllByLabelText("Open the week of Monday 14 September 2026")[0],
    ).toHaveTextContent("0 classes");
  });

  it("day view renders a single day column", () => {
    render(
      <CalendarView
        view="day"
        weekStart="2026-09-14"
        sessions={[]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    expect(screen.getAllByText("MON 14/9")).toHaveLength(1);
  });

  it("paints the card Gi White with the type colour only as a rule and names the type", () => {
    render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={[
          {
            ...base,
            colour: "#1A7F4B",
            typeName: "GI All Levels",
            sessionId: "a",
            title: "GI Fundamentals",
            startAt: "2026-09-14T16:30:00.000Z",
            endAt: "2026-09-14T17:30:00.000Z",
          },
        ]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    const card = screen.getByRole("button", { name: /GI Fundamentals/ });
    expect(card.style.background).toBe("");
    expect(card.style.backgroundColor).toBe("");
    expect(card.style.getPropertyValue("--type-colour")).toBe("#1A7F4B");
    expect(card).toHaveClass("cs-event-typed");
    expect(card).toHaveTextContent("GI All Levels");
    expect(card).toHaveAttribute("title", "GI Fundamentals");
  });

  it.each(["red;background:url(x)", ""])(
    "draws no rule and no fill for an unsafe type colour %j",
    (colour) => {
      render(
        <CalendarView
          view="week"
          weekStart="2026-09-14"
          sessions={[
            {
              ...base,
              colour,
              sessionId: "a",
              title: "GI Fundamentals",
              startAt: "2026-09-14T16:30:00.000Z",
              endAt: "2026-09-14T17:30:00.000Z",
            },
          ]}
          timezone="Europe/Jersey"
          window={window}
          canEdit={false}
          onOpen={noop}
          onCreate={noop}
          onSelectWeek={noop}
        />,
      );
      const card = screen.getByRole("button", { name: /GI Fundamentals/ });
      expect(card.style.getPropertyValue("--type-colour")).toBe("");
      expect(card.style.background).toBe("");
      expect(card.style.backgroundImage).toBe("");
      expect(card.getAttribute("style") ?? "").not.toMatch(/url|background|red/u);
      expect(card).not.toHaveClass("cs-event-typed");
      // The grid placement survives, so the rest of the card's style is intact.
      expect(card.style.gridRow).not.toBe("");
    },
  );

  it("gives each card the full name, time and occupancy as its accessible name", () => {
    render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={[
          {
            ...base,
            booked: 12,
            capacity: 20,
            sessionId: "a",
            title: "Brazilian Jiu Jitsu Fundamentals for Adults and Teenagers",
            startAt: "2026-09-14T16:30:00.000Z",
            endAt: "2026-09-14T17:30:00.000Z",
          },
        ]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Brazilian Jiu Jitsu Fundamentals for Adults and Teenagers, 17:30 – 18:30, 12 / 20 booked",
      }),
    ).toBeInTheDocument();
  });

  it("folds empty hours into a band that expands on click", () => {
    const onCreate = vi.fn();
    render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={[
          {
            ...base,
            sessionId: "a",
            title: "Morning",
            // 07:00–08:00 local.
            startAt: "2026-09-14T06:00:00.000Z",
            endAt: "2026-09-14T07:00:00.000Z",
          },
        ]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={true}
        onOpen={noop}
        onCreate={onCreate}
        onSelectWeek={noop}
      />,
    );
    const band = screen.getByRole("button", { name: "08:00 – 20:00 · no classes" });
    expect(band).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Create a class on TUE 15/9 at 13:00")).not.toBeInTheDocument();
    fireEvent.click(band);
    expect(screen.getByRole("button", { name: "08:00 – 20:00 · no classes" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(screen.getByLabelText("Create a class on TUE 15/9 at 13:00"));
    expect(onCreate).toHaveBeenCalledWith("2026-09-15", "13:00");
  });

  it("draws the now line over a folded band when the current time falls in it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));
    try {
      const { container } = render(
        <CalendarView
          view="week"
          weekStart="2026-09-14"
          sessions={[]}
          timezone="Europe/Jersey"
          window={window}
          canEdit={false}
          onOpen={noop}
          onCreate={noop}
          onSelectWeek={noop}
        />,
      );
      const band = container.querySelector<HTMLElement>(".cs-gap");
      expect(band?.style.getPropertyValue("--now")).toBe("0.5");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a coach no editing action, even inside an expanded band", () => {
    render(
      <CalendarView
        view="week"
        weekStart="2026-09-14"
        sessions={[]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /no classes/ }));
    expect(screen.queryAllByRole("button", { name: /Create|Add|Delete|Copy/ })).toHaveLength(0);
  });

  it("shows the desktop day as its own agenda view, not a squeezed week column", () => {
    const { container } = render(
      <CalendarView
        view="day"
        weekStart="2026-09-16"
        sessions={[]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
      />,
    );
    expect(container.querySelector(".cs-dayview")).not.toBeNull();
    expect(container.querySelector(".cs-week")).toBeNull();
  });

  it("groups a phone day by hour under a sticky header that steps one day at a time", () => {
    viewport.compact = true;
    const onSelectDay = vi.fn();
    const { container } = render(
      <CalendarView
        view="day"
        weekStart="2026-09-16"
        sessions={[
          {
            ...base,
            sessionId: "a",
            title: "Early Drills",
            startAt: "2026-09-16T17:00:00.000Z",
            endAt: "2026-09-16T17:30:00.000Z",
          },
          {
            ...base,
            sessionId: "b",
            title: "Late Drills",
            startAt: "2026-09-16T17:30:00.000Z",
            endAt: "2026-09-16T18:30:00.000Z",
          },
          {
            ...base,
            sessionId: "c",
            title: "Evening Class",
            startAt: "2026-09-16T18:00:00.000Z",
            endAt: "2026-09-16T19:00:00.000Z",
          },
        ]}
        timezone="Europe/Jersey"
        window={window}
        canEdit={false}
        onOpen={noop}
        onCreate={noop}
        onSelectWeek={noop}
        onSelectDay={onSelectDay}
      />,
    );
    const header = container.querySelector(".cs-agenda-header");
    expect(header).toHaveTextContent("WED 16/9");
    const hours = [...container.querySelectorAll(".cs-agenda-hour")];
    expect(hours.map((hour) => hour.querySelector("h4")?.textContent)).toEqual(["18:00", "19:00"]);
    expect(hours[0]).toHaveTextContent("Early Drills");
    expect(hours[0]).toHaveTextContent("Late Drills");
    expect(hours[1]).toHaveTextContent("Evening Class");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-09-15");
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-09-17");
  });
});
