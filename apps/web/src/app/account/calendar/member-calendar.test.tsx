import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  selfCheckIn: vi.fn(),
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
  vi.useRealTimers();
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
    await waitFor(() => expect(document.querySelectorAll(".day-column")).toHaveLength(2));
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
    await waitFor(() => expect(document.querySelectorAll(".day-column")).toHaveLength(6));
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
    await waitFor(() => expect(document.querySelectorAll(".day-column")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Earlier" })).toBeDisabled();
    const before = Array.from(document.querySelectorAll(".day-column")).map((column) =>
      column.getAttribute("data-date"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => {
      const after = Array.from(document.querySelectorAll(".day-column")).map((column) =>
        column.getAttribute("data-date"),
      );
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

  describe("Ready for Jiu Jitsu", () => {
    const near = { coords: { latitude: 49.184224, longitude: -2.107142, accuracy: 12 } };

    function stubGeolocation() {
      Object.defineProperty(navigator, "geolocation", {
        value: { getCurrentPosition: (ok: (position: typeof near) => void) => ok(near) },
        configurable: true,
      });
    }

    it("renders the card as the first child of the app for a teen with an open window", async () => {
      stubViewport(false);
      render(
        <MemberCalendar
          onSignOut={vi.fn()}
          repository={createFixtureCalendarRepository("teenStudent")}
          session={teen}
        />,
      );
      const card = await screen.findByRole("region", { name: "Ready for Jiu Jitsu" });
      expect(document.querySelector("main.member-app")?.firstElementChild).toBe(card);
    });

    it("renders the top slot after the card and before the header", async () => {
      stubViewport(false);
      render(
        <MemberCalendar
          onSignOut={vi.fn()}
          repository={createFixtureCalendarRepository("teenStudent")}
          session={teen}
          topSlot={<section aria-label="Streak">streak slot</section>}
        />,
      );
      const card = await screen.findByRole("region", { name: "Ready for Jiu Jitsu" });
      const slot = screen.getByRole("region", { name: "Streak" });
      expect(card.nextElementSibling).toBe(slot);
      expect(slot.nextElementSibling).toBe(screen.getByRole("banner"));
    });

    it("hides the card when the loaded week has no eligible open-window session", async () => {
      stubViewport(false);
      const fixture = createFixtureCalendarRepository("teenStudent");
      const repository = {
        ...fixture,
        loadWeek: async (...args: Parameters<typeof fixture.loadWeek>) => {
          const loaded = await fixture.loadWeek(...args);
          return {
            ...loaded,
            sessions: loaded.sessions.filter((session) => !session.sessionId.endsWith("_ready")),
          };
        },
      };
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={teen} />);
      await waitFor(() => expect(document.querySelector(".skeleton-card")).not.toBeInTheDocument());
      expect(screen.queryByRole("region", { name: "Ready for Jiu Jitsu" })).not.toBeInTheDocument();
      expect(screen.queryByRole("slider", { name: /Slide to clock in/u })).not.toBeInTheDocument();
    });

    it("clocks in and turns the card into the confirmation and the session card into attended", async () => {
      stubViewport(false);
      stubGeolocation();
      render(
        <MemberCalendar
          onSignOut={vi.fn()}
          repository={createFixtureCalendarRepository("teenStudent")}
          session={teen}
        />,
      );
      const slider = await screen.findByRole("slider", { name: /Slide to clock in/u });
      fireEvent.change(slider, { target: { value: "100" } });
      fireEvent.keyUp(slider, { key: "End" });
      await screen.findByRole("heading", { name: "You're in" });
      await waitFor(() =>
        expect(
          document.querySelector('li[data-session-id$="_ready"]')?.getAttribute("data-status"),
        ).toBe("attended"),
      );
    });

    it("follows the guardian's child chips and names the sibling who is ready too", async () => {
      stubViewport(false);
      render(
        <MemberCalendar
          onSignOut={vi.fn()}
          repository={createFixtureCalendarRepository("guardian")}
          session={guardian}
        />,
      );
      await screen.findByRole("slider", { name: /Teens BJJ/u });
      await screen.findByText("Leo is ready too — switch to Leo");
      await userEvent.click(screen.getByRole("button", { name: "Leo" }));
      await screen.findByRole("slider", { name: /Kids BJJ/u });
      await screen.findByText("Maya is ready too — switch to Maya");
    });

    it("re-reads the week every 60 s while a window is open across minute-clock ticks", async () => {
      stubViewport(false);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const repository = createFixtureCalendarRepository("teenStudent");
      const loadWeek = vi.spyOn(repository, "loadWeek");
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={teen} />);
      await screen.findByRole("slider", { name: /Slide to clock in/u });
      await act(async () => {});
      const before = loadWeek.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(loadWeek.mock.calls.length).toBeGreaterThan(before);
      const afterFirstMinute = loadWeek.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(loadWeek.mock.calls.length).toBeGreaterThan(afterFirstMinute);
    });

    it("replaces the slider when a silent poll finds coach attendance", async () => {
      stubViewport(false);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fixture = createFixtureCalendarRepository("teenStudent");
      const loadWeek = vi.fn(async (...args: Parameters<typeof fixture.loadWeek>) => {
        const week = await fixture.loadWeek(...args);
        if (loadWeek.mock.calls.length < 2) return week;
        const ready = week.sessions.find((session) => session.sessionId.endsWith("_ready"));
        if (!ready) throw new Error("fixture ready session missing");
        return {
          ...week,
          attendance: [
            {
              attendanceId: ready.sessionId + "__sam",
              academyId: "bpt-jersey",
              sessionId: ready.sessionId,
              studentId: "sam",
              method: "manual" as const,
              state: "attended" as const,
              occurredAt: new Date().toISOString(),
              notes: null,
              correctionOf: null,
              schemaVersion: "1" as const,
              createdAt: new Date().toISOString(),
              createdBy: "coach",
              updatedAt: new Date().toISOString(),
              updatedBy: "coach",
            },
          ],
        };
      });
      const repository = { ...fixture, loadWeek };
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={teen} />);
      await screen.findByRole("slider", { name: /Slide to clock in/u });
      await vi.advanceTimersByTimeAsync(60_000);
      await screen.findByRole("heading", { name: "You're in" });
      expect(screen.queryByRole("slider", { name: /Slide to clock in/u })).not.toBeInTheDocument();
    });

    it("does not replace a successful clock-in with an earlier poll response", async () => {
      stubViewport(false);
      stubGeolocation();
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fixture = createFixtureCalendarRepository("teenStudent");
      let resolveStale: (() => void) | undefined;
      const loadWeek = vi.fn(async (...args: Parameters<typeof fixture.loadWeek>) => {
        const snapshot = await fixture.loadWeek(...args);
        if (loadWeek.mock.calls.length < 2) return snapshot;
        return new Promise<typeof snapshot>((resolve) => {
          resolveStale = () => resolve(snapshot);
        });
      });
      const repository = { ...fixture, loadWeek };
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={teen} />);
      const slider = await screen.findByRole("slider", { name: /Slide to clock in/u });
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(resolveStale).toBeDefined());
      fireEvent.change(slider, { target: { value: "100" } });
      fireEvent.keyUp(slider, { key: "End" });
      await screen.findByRole("heading", { name: "You're in" });
      await act(async () => {
        resolveStale?.();
      });
      await waitFor(() =>
        expect(document.querySelector('li[data-session-id$="_ready"]')).toHaveAttribute(
          "data-status",
          "attended",
        ),
      );
    });

    it("does not show the old child's ready session while the newly selected child's week loads", async () => {
      stubViewport(false);
      const fixture = createFixtureCalendarRepository("guardian");
      let holdLeo = false;
      let resolveLeo: (() => void) | undefined;
      const loadWeek = vi.fn(async (...args: Parameters<typeof fixture.loadWeek>) => {
        const loaded = await fixture.loadWeek(...args);
        if (!holdLeo || args[0] !== "leo") return loaded;
        return new Promise<typeof loaded>((resolve) => {
          resolveLeo = () => resolve(loaded);
        });
      });
      const repository = { ...fixture, loadWeek };
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={guardian} />);
      await screen.findByRole("slider", { name: /Teens BJJ/u });
      holdLeo = true;
      await userEvent.click(screen.getByRole("button", { name: "Leo" }));
      expect(screen.queryByRole("slider", { name: /Teens BJJ/u })).not.toBeInTheDocument();
      resolveLeo?.();
      await screen.findByRole("slider", { name: /Kids BJJ/u });
    });

    it("keeps the active child's loaded week when their chip is selected again", async () => {
      stubViewport(false);
      render(
        <MemberCalendar
          onSignOut={vi.fn()}
          repository={createFixtureCalendarRepository("guardian")}
          session={guardian}
        />,
      );
      await screen.findByRole("slider", { name: /Teens BJJ/u });
      await userEvent.click(screen.getByRole("button", { name: "Maya" }));
      expect(screen.getByRole("slider", { name: /Teens BJJ/u })).toBeInTheDocument();
    });

    it("keeps an active child's pending poll valid when their chip is selected again", async () => {
      stubViewport(false);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fixture = createFixtureCalendarRepository("guardian");
      let resolvePoll: (() => void) | undefined;
      const loadWeek = vi.fn(async (...args: Parameters<typeof fixture.loadWeek>) => {
        const loaded = await fixture.loadWeek(...args);
        if (
          args[0] !== "maya" ||
          loadWeek.mock.calls.filter(([studentId]) => studentId === "maya").length < 2
        ) {
          return loaded;
        }
        return new Promise<typeof loaded>((resolve) => {
          resolvePoll = () => resolve(loaded);
        });
      });
      const repository = { ...fixture, loadWeek };
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={guardian} />);
      await screen.findByRole("slider", { name: /Teens BJJ/u });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await waitFor(() => expect(resolvePoll).toBeDefined());
      await userEvent.click(screen.getByRole("button", { name: "Maya" }));
      await act(async () => {
        resolvePoll?.();
      });
      await screen.findByRole("slider", { name: /Teens BJJ/u });
    });

    it("ignores a deferred Maya clock-in while Leo's week is pending", async () => {
      stubViewport(false);
      stubGeolocation();
      const fixture = createFixtureCalendarRepository("guardian");
      let holdLeo = false;
      let resolveLeo: (() => void) | undefined;
      let resolveClockIn:
        ((record: Awaited<ReturnType<typeof fixture.clockIn>>) => void) | undefined;
      const loadWeek = vi.fn(async (...args: Parameters<typeof fixture.loadWeek>) => {
        const loaded = await fixture.loadWeek(...args);
        if (!holdLeo || args[0] !== "leo") return loaded;
        return new Promise<typeof loaded>((resolve) => {
          resolveLeo = () => resolve(loaded);
        });
      });
      const clockIn = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<typeof fixture.clockIn>>>((resolve) => {
            resolveClockIn = resolve;
          }),
      );
      const repository = { ...fixture, loadWeek, clockIn };
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={guardian} />);
      const slider = await screen.findByRole("slider", { name: /Teens BJJ/u });
      const mayaSessionId = document
        .querySelector('li[data-session-id$="_ready"]')
        ?.getAttribute("data-session-id");
      if (!mayaSessionId) throw new Error("Maya ready session missing");
      fireEvent.change(slider, { target: { value: "100" } });
      fireEvent.keyUp(slider, { key: "End" });
      await waitFor(() => expect(resolveClockIn).toBeDefined());
      holdLeo = true;
      await userEvent.click(screen.getByRole("button", { name: "Leo" }));
      await waitFor(() => expect(resolveLeo).toBeDefined());
      await act(async () => {
        resolveClockIn?.({
          attendanceId: mayaSessionId + "__maya",
          academyId: "bpt-jersey",
          sessionId: mayaSessionId,
          studentId: "maya",
          method: "self",
          state: "attended",
          occurredAt: new Date().toISOString(),
          notes: null,
          correctionOf: null,
          schemaVersion: "1",
          createdAt: new Date().toISOString(),
          createdBy: "maya",
          updatedAt: new Date().toISOString(),
          updatedBy: "maya",
        });
      });
      await act(async () => {
        resolveLeo?.();
      });
      await screen.findByRole("slider", { name: /Kids BJJ/u });
      expect(document.querySelector('[data-session-id="' + mayaSessionId + '"]')).toHaveAttribute(
        "data-status",
        "locked",
      );
    });

    it("ignores a deferred check-in after navigating to a new week", async () => {
      stubViewport(false);
      stubGeolocation();
      const fixture = createFixtureCalendarRepository("teenStudent");
      let resolveNextWeek: (() => void) | undefined;
      let nextWeek: Awaited<ReturnType<typeof fixture.loadWeek>> | undefined;
      let resolveClockIn:
        ((record: Awaited<ReturnType<typeof fixture.clockIn>>) => void) | undefined;
      const loadWeek = vi.fn(async (...args: Parameters<typeof fixture.loadWeek>) => {
        const loaded = await fixture.loadWeek(...args);
        if (loadWeek.mock.calls.length < 2) return loaded;
        nextWeek = loaded;
        return new Promise<typeof loaded>((resolve) => {
          resolveNextWeek = () => resolve(loaded);
        });
      });
      const clockIn = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<typeof fixture.clockIn>>>((resolve) => {
            resolveClockIn = resolve;
          }),
      );
      const repository = { ...fixture, loadWeek, clockIn };
      render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={teen} />);
      const slider = await screen.findByRole("slider", { name: /Teens BJJ/u });
      const sessionId = document
        .querySelector('li[data-session-id$="_ready"]')
        ?.getAttribute("data-session-id");
      if (!sessionId) throw new Error("ready session missing");
      fireEvent.change(slider, { target: { value: "100" } });
      fireEvent.keyUp(slider, { key: "End" });
      await waitFor(() => expect(resolveClockIn).toBeDefined());
      await userEvent.click(screen.getByRole("button", { name: "Later" }));
      await waitFor(() => expect(resolveNextWeek).toBeDefined());
      await act(async () => {
        resolveClockIn?.({
          attendanceId: sessionId + "__sam",
          academyId: "bpt-jersey",
          sessionId,
          studentId: "sam",
          method: "self",
          state: "attended",
          occurredAt: new Date().toISOString(),
          notes: null,
          correctionOf: null,
          schemaVersion: "1",
          createdAt: new Date().toISOString(),
          createdBy: "sam",
          updatedAt: new Date().toISOString(),
          updatedBy: "sam",
        });
        resolveNextWeek?.();
      });
      const sessionInNewRange = nextWeek?.sessions[0];
      if (!sessionInNewRange) throw new Error("new range session missing");
      await waitFor(() =>
        expect(
          document.querySelector('[data-session-id="' + sessionInNewRange.sessionId + '"]'),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByRole("heading", { name: "You're in" })).not.toBeInTheDocument();
    });
  });
});
