import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "./calendar-view";
import { mondayOf } from "./week-grid";
import type { GridSession } from "./week-grid";

afterEach(() => {
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
    expect(btn).toHaveTextContent("17:30 - 18:30");
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

  it("marks cancelled sessions with data-status", () => {
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
    expect(screen.getByRole("button", { name: /Cancelled Class/ })).toHaveAttribute(
      "data-status",
      "cancelled",
    );
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
});
