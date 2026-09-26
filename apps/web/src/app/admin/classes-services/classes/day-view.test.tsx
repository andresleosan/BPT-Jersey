import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DayView } from "./day-view";
import type { GridSession } from "./week-grid";

const css = readFileSync(
  resolve(process.cwd(), "apps/web/src/app/admin/classes-services/classes-services.css"),
  "utf8",
);

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

const base: Omit<GridSession, "sessionId" | "title" | "startAt" | "endAt"> = {
  colour: "#1A7F4B",
  typeName: "GI All Levels",
  booked: 12,
  capacity: 20,
  status: "scheduled",
  locationId: "town",
  locationName: "Town Dojo",
  coachNames: ["Coach Silva"],
  programId: "p",
  instructorIds: ["c"],
};

// 18:00–19:00 in Jersey (BST) on Wednesday 16 September.
const evening = { startAt: "2026-09-16T17:00:00.000Z", endAt: "2026-09-16T18:00:00.000Z" };

function noop(): void {
  // intentionally empty
}

function show(sessions: readonly GridSession[], onOpen = noop): ReturnType<typeof render> {
  return render(
    <DayView
      sessions={sessions}
      date="2026-09-16"
      timezone="Europe/Jersey"
      canEdit={false}
      onOpen={onOpen}
      onCreate={noop}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubWidth(width: number): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback(
          [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

describe("DayView", () => {
  it("puts two classes at the same time side by side with their full names", () => {
    stubWidth(1200);
    show([
      { ...base, sessionId: "a", title: "Brazilian Jiu Jitsu Fundamentals for Adults", ...evening },
      { ...base, sessionId: "b", title: "Competition Team Open Mat", ...evening },
    ]);
    const cards = screen.getAllByRole("button", { name: /18:00 – 19:00/ });
    expect(cards).toHaveLength(2);
    const slot = cards[0]!.closest(".cs-dayview-slot");
    expect(slot).toBe(cards[1]!.closest(".cs-dayview-slot"));
    expect(slot).toHaveAttribute("data-layout", "columns");
    expect(screen.getByText("Brazilian Jiu Jitsu Fundamentals for Adults")).toHaveClass(
      "cs-dayview-title",
    );
    expect(rule(".cs-dayview-title")).not.toMatch(/ellipsis|nowrap/u);
  });

  it("stacks simultaneous classes as rows when they do not fit side by side", () => {
    stubWidth(600);
    show(
      ["a", "b", "c", "d"].map((id) => ({
        ...base,
        sessionId: id,
        title: `Class ${id}`,
        ...evening,
      })),
    );
    const slot = screen.getByRole("button", { name: /Class a/ }).closest(".cs-dayview-slot");
    expect(slot).toHaveAttribute("data-layout", "rows");
    expect(within(slot as HTMLElement).getAllByRole("button")).toHaveLength(4);
  });

  it("shows name, time, occupancy with a bar, coach, location and type on each card", () => {
    show([{ ...base, sessionId: "a", title: "GI Fundamentals", ...evening }]);
    const card = screen.getByRole("button", { name: /GI Fundamentals/ });
    expect(card).toHaveTextContent("18:00 – 19:00");
    const occupancy = within(card).getByText("12 / 20");
    expect(occupancy).toHaveClass("cs-dayview-occupancy");
    expect(rule(".cs-dayview-occupancy")).toContain("tabular-nums");
    const meter = within(card).getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "12");
    expect(meter).toHaveAttribute("aria-valuemax", "20");
    expect(card).toHaveTextContent("Coach Silva");
    expect(card).toHaveTextContent("Town Dojo");
    expect(card).toHaveTextContent("GI All Levels");
    expect(card.style.getPropertyValue("--type-colour")).toBe("#1A7F4B");
  });

  it("marks a cancelled class in words and with a rule, without the bar", () => {
    show([{ ...base, sessionId: "a", title: "GI Fundamentals", status: "cancelled", ...evening }]);
    const card = screen.getByRole("button", { name: /GI Fundamentals/ });
    expect(card).toHaveAttribute("data-status", "cancelled");
    expect(card).toHaveTextContent("Cancelled");
    expect(within(card).queryByRole("meter")).not.toBeInTheDocument();
    expect(rule('.cs-dayview-card[data-status="cancelled"]')).toContain("border-left");
  });

  it("opens the session panel with the session id on click", () => {
    const onOpen = vi.fn();
    show([{ ...base, sessionId: "a", title: "GI Fundamentals", ...evening }], onOpen);
    fireEvent.click(screen.getByRole("button", { name: /GI Fundamentals/ }));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("marks today and draws the now line in the academy timezone", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 13:00 in Jersey but 12:00 UTC.
    vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));
    const { container } = show([
      // 12:15–12:45 local: already over at 13:00 local, still to come at 12:00 UTC.
      {
        ...base,
        sessionId: "a",
        title: "Lunch Drills",
        startAt: "2026-09-16T11:15:00.000Z",
        endAt: "2026-09-16T11:45:00.000Z",
      },
      {
        ...base,
        sessionId: "b",
        title: "Afternoon Class",
        startAt: "2026-09-16T12:30:00.000Z",
        endAt: "2026-09-16T13:30:00.000Z",
      },
    ]);
    expect(container.querySelector("[aria-current='date']")).toHaveTextContent("WED 16/9");
    const line = container.querySelector(".cs-dayview-now");
    expect(line).toHaveTextContent("Now 13:00");
    expect(line?.previousElementSibling).toHaveTextContent("Lunch Drills");
    expect(line?.nextElementSibling).toHaveTextContent("Afternoon Class");
  });

  it("treats a UTC evening that is already tomorrow in Jersey as today", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00:30 on 16 September in Jersey, 23:30 on the 15th in UTC.
    vi.setSystemTime(new Date("2026-09-15T23:30:00.000Z"));
    const { container } = show([]);
    expect(container.querySelector("[aria-current='date']")).toHaveTextContent("WED 16/9");
  });
});
