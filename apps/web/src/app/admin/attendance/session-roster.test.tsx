import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreClassAttendee } from "@bpt-jersey/domain/schedule/pre-class";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import { SessionRoster } from "./session-roster";

const session: SessionRecord = {
  sessionId: "session-1",
  academyId: "academy-1",
  classId: "class-1",
  programId: "program-1",
  locationId: "town",
  instructorId: "coach-miro",
  title: "Adults Gi",
  startAt: "2026-09-12T18:00:00.000Z",
  endAt: "2026-09-12T19:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-01T10:00:00.000Z",
  updatedBy: "admin-1",
};

function attendee(
  overrides: Partial<PreClassAttendee> & { studentId: string; displayName: string },
): PreClassAttendee {
  return {
    source: "booked",
    status: "booked_not_arrived",
    attendedCount: 0,
    comparableSessionCount: 0,
    lastAttendedAt: null,
    ...overrides,
  };
}

const attendees = [
  attendee({ studentId: "s-ready", displayName: "Ana Ready", status: "attended" }),
  attendee({ studentId: "s-booked", displayName: "Ben Booked" }),
  attendee({ studentId: "s-regular", displayName: "Reg Ular", source: "regular", status: null }),
];
const before = Date.parse("2026-09-12T17:45:00.000Z");
const after = Date.parse("2026-09-12T18:00:00.000Z");

afterEach(() => {
  cleanup();
});

describe("SessionRoster", () => {
  it("titles the block with the class and the coach, and lists only booked members", () => {
    render(
      <SessionRoster
        session={session}
        roster={{ status: "ready", attendees }}
        nowMs={before}
        onClockIn={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Adults Gi · Coach coach-miro" })).toBeVisible();
    const list = screen.getByRole("list", { name: "Adults Gi roster" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list).not.toHaveTextContent("Reg Ular");
  });

  it("tags ready, booked, then late once the class has started, with a button only where a clock-in is missing", async () => {
    const onClockIn = vi.fn();
    const { rerender } = render(
      <SessionRoster
        session={session}
        roster={{ status: "ready", attendees }}
        nowMs={before}
        onClockIn={onClockIn}
      />,
    );
    expect(screen.getByText("Ready")).toHaveClass("attendance-tag-ready");
    expect(screen.getByText("Booked")).toHaveClass("attendance-tag-booked");
    expect(screen.queryByRole("button", { name: "Clock in Ana Ready" })).not.toBeInTheDocument();
    expect(screen.getByText("1 ready")).toBeVisible();
    expect(screen.getByText("1 waiting")).toBeVisible();
    expect(screen.getByText("0 late")).toBeVisible();

    rerender(
      <SessionRoster
        session={session}
        roster={{ status: "ready", attendees }}
        nowMs={after}
        onClockIn={onClockIn}
      />,
    );
    expect(screen.getByText("Late")).toHaveClass("attendance-tag-late");
    expect(screen.getByText("1 late")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Clock in Ben Booked" }));
    expect(onClockIn).toHaveBeenCalledWith("s-booked", "Ben Booked");
  });

  it("disables every button of the block while one clock-in is in flight", () => {
    render(
      <SessionRoster
        session={session}
        roster={{ status: "ready", attendees }}
        nowMs={after}
        busyStudentId="s-booked"
        onClockIn={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Clock in Ben Booked" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clock in Ben Booked" })).toHaveTextContent(
      "Clocking in...",
    );
  });

  it("says so when nobody booked, when the roster failed and when the session is cancelled", () => {
    const { rerender } = render(
      <SessionRoster
        session={session}
        roster={{ status: "ready", attendees: [] }}
        nowMs={before}
        onClockIn={vi.fn()}
      />,
    );
    expect(screen.getByText("Nobody has booked this class.")).toBeVisible();
    rerender(
      <SessionRoster
        session={session}
        roster={{ status: "error" }}
        nowMs={before}
        onClockIn={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load this roster.");
    rerender(
      <SessionRoster
        session={{ ...session, status: "cancelled" }}
        roster={{ status: "ready", attendees }}
        nowMs={after}
        onClockIn={vi.fn()}
      />,
    );
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Clock in/ })).not.toBeInTheDocument();
  });
});
