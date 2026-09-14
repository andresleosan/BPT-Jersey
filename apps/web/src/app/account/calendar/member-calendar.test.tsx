import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureCalendarRepository } from "../../../lib/calendar/fixture-calendar-repository";
import { MemberCalendar } from "./member-calendar";

const schedule = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getScheduleCatalog: vi.fn(),
  listStudentBookings: vi.fn(),
  listStudentAttendance: vi.fn(),
  requestBooking: vi.fn(),
  cancelBooking: vi.fn(),
  listSessionBookedCounts: vi.fn(),
}));
vi.mock("../../../lib/schedule-client", () => schedule);
vi.mock("../../../lib/waitlist-client", () => ({
  listClientMemberships: vi
    .fn()
    .mockResolvedValue([
      { membershipId: "m-1", studentId: "s-1", planId: "bpt-jersey-adult", status: "active" },
    ]),
}));
vi.mock("../../../lib/family-client", () => ({ getFamily: vi.fn() }));
vi.mock("../../../lib/no-show-penalties-client", () => ({
  listNoShowPenalties: vi.fn().mockResolvedValue([]),
}));

import { createFirebaseCalendarRepository } from "../../../lib/calendar/firebase-calendar-repository";

function stubViewport(desktop: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: desktop && query.includes("58rem"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const teen = { role: "teenStudent" as const, displayName: "Sam Demo" };
const guardian = { role: "guardian" as const, displayName: "Jordan Demo" };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MemberCalendar", () => {
  it("phone: renders two day columns for a teen and no chips", async () => {
    stubViewport(false);
    render(
      <MemberCalendar
        onSignOut={vi.fn()}
        repository={createFixtureCalendarRepository("teenStudent")}
        session={teen}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(2));
    expect(screen.queryByRole("group", { name: "Choose member" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sam" })).toBeInTheDocument();
  });

  it("desktop: renders six columns with today wider", async () => {
    stubViewport(true);
    render(
      <MemberCalendar
        onSignOut={vi.fn()}
        repository={createFixtureCalendarRepository("teenStudent")}
        session={teen}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(6));
    const week = document.querySelector<HTMLElement>(".member-week");
    expect(week?.style.getPropertyValue("--week-columns")).toContain("1.6fr");
  });

  it("guardian: chips switch the selected child and the penalty banner follows Maya", async () => {
    stubViewport(false);
    render(
      <MemberCalendar
        onSignOut={vi.fn()}
        repository={createFixtureCalendarRepository("guardian")}
        session={guardian}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Maya" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("£15 no-show penalty");
    await userEvent.click(screen.getByRole("button", { name: "Leo" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Leo" })).toHaveAttribute("aria-pressed", "true"),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("books with one tap and shows the £15 note, then cancels through the dialog", async () => {
    stubViewport(true);
    render(
      <MemberCalendar
        onSignOut={vi.fn()}
        repository={createFixtureCalendarRepository("teenStudent")}
        session={teen}
      />,
    );
    const [first] = await screen.findAllByRole("button", { name: "Book" });
    const card = first?.closest("li");
    if (!first || !card) throw new Error("no open session in fixtures");
    await userEvent.click(first);
    await waitFor(() =>
      expect(within(card).getByText("Booked. Missing it costs £15.")).toBeInTheDocument(),
    );
    await userEvent.click(within(card).getByRole("button", { name: "Booked · Cancel" }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    await waitFor(() =>
      expect(within(card).getByRole("button", { name: "Book" })).toBeInTheDocument(),
    );
  });

  it("navigates forward and disables Earlier at offset 0", async () => {
    stubViewport(false);
    render(
      <MemberCalendar
        onSignOut={vi.fn()}
        repository={createFixtureCalendarRepository("teenStudent")}
        session={teen}
      />,
    );
    await screen.findAllByRole("region");
    expect(screen.getByRole("button", { name: "Earlier" })).toBeDisabled();
    const before = screen.getAllByRole("region").map((r) => r.getAttribute("data-date"));
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => {
      const after = screen.getAllByRole("region").map((r) => r.getAttribute("data-date"));
      expect(after).not.toEqual(before);
    });
    expect(screen.getByRole("button", { name: "Earlier" })).toBeEnabled();
  });

  it("shows an error panel with retry when loading fails", async () => {
    stubViewport(false);
    const broken = {
      ...createFixtureCalendarRepository("teenStudent"),
      loadMember: () => Promise.reject(new Error("x")),
    };
    render(<MemberCalendar onSignOut={vi.fn()} repository={broken} session={teen} />);
    expect(await screen.findByText("Couldn't load your calendar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  describe("with the Firebase adapter", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-14T09:00:00.000Z") }); // Monday 10:00 Europe/Jersey
      schedule.listSessions.mockResolvedValue([
        {
          sessionId: "s-full",
          academyId: "bpt-jersey",
          classId: null,
          programId: "prog-adult",
          locationId: "town",
          instructorId: "coach-1",
          title: "Adults BJJ",
          startAt: "2026-09-15T17:00:00.000Z",
          endAt: "2026-09-15T18:00:00.000Z",
          capacity: 2,
          minParticipants: 4,
          status: "scheduled",
          isSeminar: false,
          cancellationReason: null,
          schemaVersion: "1",
          createdAt: "2026-09-01T00:00:00.000Z",
          createdBy: "fixture",
          updatedAt: "2026-09-01T00:00:00.000Z",
          updatedBy: "fixture",
        },
      ]);
      schedule.getScheduleCatalog.mockResolvedValue({
        locations: [],
        programs: [
          {
            programId: "prog-adult",
            academyId: "bpt-jersey",
            name: "Adults BJJ",
            ageBand: "adult",
            discipline: "bjj",
            level: "all-levels",
            active: true,
            schemaVersion: "1",
          },
        ],
      });
      schedule.listStudentBookings.mockResolvedValue([]);
      schedule.listStudentAttendance.mockResolvedValue([]);
      schedule.listSessionBookedCounts.mockResolvedValue({ "s-full": 2 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders a full session as Full when the Firebase adapter reports the count", async () => {
      stubViewport(true);
      render(
        <MemberCalendar
          onSignOut={vi.fn()}
          repository={createFirebaseCalendarRepository({
            role: "adultStudent",
            displayName: "Alex",
          })}
          session={{ role: "adultStudent", displayName: "Alex" }}
        />,
      );
      await screen.findByText("Adults BJJ");
      const card = document.querySelector('[data-session-id="s-full"]');
      expect(card).toHaveAttribute("data-status", "full");
    });
  });
});
