import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AttendanceRecord,
  SessionOperationalView,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";

const schedule = vi.hoisted(() => ({
  correctAttendance: vi.fn(),
  getPreClassView: vi.fn(),
  getSessionOperationalView: vi.fn(),
  listSessions: vi.fn(),
  reconcileSessionNoShows: vi.fn(),
  recordCheckIn: vi.fn(),
  recordCheckout: vi.fn(),
}));

vi.mock("../../../lib/schedule-client", () => schedule);

import { AttendancePage } from "./page";

const attendanceCss = readFileSync(
  resolve(process.cwd(), "apps/web/src/app/admin/attendance/attendance.css"),
  "utf8",
);

/** Every block that opens with `marker`, joined (a media query may appear more than once). */
function cssBlock(css: string, marker: string): string {
  const blocks: string[] = [];
  for (let start = css.indexOf(marker); start !== -1; start = css.indexOf(marker, start + 1)) {
    let depth = 0;
    for (let index = css.indexOf("{", start); index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(css.slice(start, index + 1));
        break;
      }
    }
  }
  return blocks.join("\n");
}

const session: SessionRecord = {
  sessionId: "session-connected-1",
  academyId: "academy-1",
  classId: "class-1",
  programId: "program-1",
  locationId: "town",
  instructorId: "coach-1",
  title: "Connected fundamentals",
  startAt: "2026-09-03T18:00:00.000Z",
  endAt: "2026-09-03T19:00:00.000Z",
  capacity: 20,
  minParticipants: 2,
  status: "active",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-03T18:00:00.000Z",
  updatedBy: "admin-1",
};

const attended: AttendanceRecord = {
  attendanceId: "session-connected-1__student-attended",
  academyId: "academy-1",
  sessionId: "session-connected-1",
  studentId: "student-attended",
  method: "manual",
  state: "attended",
  occurredAt: "2026-09-03T17:58:00.000Z",
  notes: null,
  correctionOf: null,
  schemaVersion: "1",
  createdAt: "2026-09-03T17:58:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-03T17:58:00.000Z",
  updatedBy: "admin-1",
};

function view(
  pendingStatus: "booked_not_arrived" | "attended" | "no_show" = "booked_not_arrived",
): SessionOperationalView {
  const pendingAttendance =
    pendingStatus === "booked_not_arrived"
      ? null
      : {
          ...attended,
          attendanceId: "session-connected-1__student-pending",
          studentId: "student-pending",
          state: pendingStatus === "no_show" ? ("no_show" as const) : ("attended" as const),
        };
  return {
    session,
    summary: {
      capacity: 20,
      minParticipants: 2,
      quorumMet: true,
      totalBookings: 2,
      totalCheckedIn: pendingStatus === "attended" ? 2 : 1,
      totalCheckedOut: 0,
      totalNoShows: pendingStatus === "no_show" ? 1 : 0,
      totalPendingArrival: pendingStatus === "booked_not_arrived" ? 1 : 0,
    },
    roster: [
      {
        studentId: "student-pending",
        booking: {
          bookingId: "booking-pending",
          academyId: "academy-1",
          sessionId: "session-connected-1",
          studentId: "student-pending",
          membershipId: "membership-pending",
          status: "confirmed",
          requestedAt: "2026-09-02T12:00:00.000Z",
          cancelledAt: null,
          cancellationReason: null,
          schemaVersion: "1",
          createdAt: "2026-09-02T12:00:00.000Z",
          createdBy: "admin-1",
          updatedAt: "2026-09-02T12:00:00.000Z",
          updatedBy: "admin-1",
        },
        attendance: pendingAttendance,
        checkout: null,
        computedStatus: pendingStatus,
      },
      {
        studentId: "student-attended",
        booking: {
          bookingId: "booking-attended",
          academyId: "academy-1",
          sessionId: "session-connected-1",
          studentId: "student-attended",
          membershipId: "membership-attended",
          status: "confirmed",
          requestedAt: "2026-09-02T12:00:00.000Z",
          cancelledAt: null,
          cancellationReason: null,
          schemaVersion: "1",
          createdAt: "2026-09-02T12:00:00.000Z",
          createdBy: "admin-1",
          updatedAt: "2026-09-02T12:00:00.000Z",
          updatedBy: "admin-1",
        },
        attendance: attended,
        checkout: null,
        computedStatus: "attended",
      },
    ],
    unbookedCheckIns: [],
    refreshedAt: "2026-09-03T18:10:00.000Z",
  };
}

const preClass = {
  session,
  attendees: [
    {
      studentId: "student-attended",
      displayName: "Ana Ready",
      source: "booked" as const,
      status: "attended" as const,
      attendedCount: 0,
      comparableSessionCount: 0,
      lastAttendedAt: null,
    },
    {
      studentId: "student-pending",
      displayName: "Ben Booked",
      source: "booked" as const,
      status: "booked_not_arrived" as const,
      attendedCount: 0,
      comparableSessionCount: 0,
      lastAttendedAt: null,
    },
  ],
  evidence: {
    open: true,
    windowDays: 56,
    bookedCount: 2,
    suggestedCount: 0,
    comparableSessionCount: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  schedule.listSessions.mockResolvedValue([session]);
  schedule.getSessionOperationalView.mockResolvedValue(view());
  schedule.getPreClassView.mockResolvedValue(preClass);
  schedule.recordCheckIn.mockResolvedValue(attended);
  schedule.reconcileSessionNoShows.mockResolvedValue({ noShowsMarked: 1, records: [] });
  schedule.correctAttendance.mockResolvedValue({
    correction: { ...attended, attendanceId: "corr-1", correctionOf: attended.attendanceId },
    canonical: attended,
  });
  schedule.recordCheckout.mockResolvedValue({
    checkoutId: "session-connected-1__student-attended",
    academyId: "academy-1",
    sessionId: "session-connected-1",
    studentId: "student-attended",
    method: "authorizedAdult",
    authorizedAdultId: "adult-1",
    authorizedAdultName: "Approved Adult",
    notes: null,
    checkedOutAt: "2026-09-03T19:00:00.000Z",
    schemaVersion: "1",
    createdAt: "2026-09-03T19:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-09-03T19:00:00.000Z",
    updatedBy: "admin-1",
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("attendance page", () => {
  it("checks in a pending canonical booking, refreshes it, and marks session no-shows", async () => {
    const user = userEvent.setup();
    schedule.getSessionOperationalView
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view("attended"))
      .mockResolvedValueOnce(view("no_show"));
    render(<AttendancePage />);
    await user.click(await screen.findByText("Corrections and closeout"));

    expect(await screen.findByText("student-pending")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Check out student-pending/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Check in student-pending/i }));
    expect(schedule.recordCheckIn).toHaveBeenCalledWith({
      sessionId: "session-connected-1",
      studentId: "student-pending",
      method: "manual",
    });
    expect(await screen.findByText(/Manual check-in recorded for student-pending/i)).toBeVisible();
    await waitFor(() => expect(schedule.getSessionOperationalView).toHaveBeenCalledTimes(2));

    await user.click(
      screen.getByRole("button", { name: /Mark no-shows for Connected fundamentals/i }),
    );
    expect(schedule.reconcileSessionNoShows).toHaveBeenCalledWith("session-connected-1");
    expect(await screen.findByText(/Marked 1 no-show for Connected fundamentals/i)).toBeVisible();
    await waitFor(() => expect(schedule.getSessionOperationalView).toHaveBeenCalledTimes(3));
  });

  it("requires a correction reason and retains the exact dialog data after a backend failure", async () => {
    const user = userEvent.setup();
    schedule.correctAttendance.mockRejectedValueOnce(new Error("sensitive backend detail"));
    render(<AttendancePage />);

    await user.click(
      await screen.findByRole("button", { name: /Correct attendance for student-attended/i }),
    );
    const dialog = screen.getByRole("dialog", { name: "Correct attendance" });
    await user.selectOptions(within(dialog).getByLabelText("Corrected state"), "excused");
    await user.click(within(dialog).getByRole("button", { name: "Save correction" }));
    expect(schedule.correctAttendance).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/reason is required/i);

    await user.type(
      within(dialog).getByLabelText("Correction reason"),
      "Guardian confirmed medical absence",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save correction" }));

    expect(schedule.correctAttendance).toHaveBeenCalledWith({
      sessionId: "session-connected-1",
      studentId: "student-attended",
      newState: "excused",
      reason: "Guardian confirmed medical absence",
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Unable to correct attendance. Nothing was changed.",
    );
    expect(within(dialog).getByLabelText("Correction reason")).toHaveValue(
      "Guardian confirmed medical absence",
    );
    expect(within(dialog).queryByText("sensitive backend detail")).not.toBeInTheDocument();
  });

  it("checks out only an attended roster entry and preserves authorized-adult data on failure", async () => {
    const user = userEvent.setup();
    schedule.recordCheckout.mockRejectedValueOnce(new Error("private infrastructure error"));
    render(<AttendancePage />);

    expect(
      await screen.findByRole("button", { name: /Check out student-attended/i }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Check out student-pending/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Check out student-attended/i }));

    const dialog = screen.getByRole("dialog", { name: "Record checkout" });
    expect(within(dialog).getByRole("option", { name: "Independent release" })).toBeVisible();
    expect(within(dialog).getByRole("option", { name: "Staff override" })).toBeVisible();
    await user.type(within(dialog).getByLabelText("Authorized adult ID"), "adult-1");
    await user.type(within(dialog).getByLabelText("Authorized adult name"), "Approved Adult");
    await user.click(within(dialog).getByRole("button", { name: "Record checkout" }));

    expect(schedule.recordCheckout).toHaveBeenCalledWith({
      sessionId: "session-connected-1",
      studentId: "student-attended",
      method: "authorizedAdult",
      authorizedAdultId: "adult-1",
      authorizedAdultName: "Approved Adult",
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Unable to record checkout. Nothing was changed.",
    );
    expect(within(dialog).getByLabelText("Authorized adult ID")).toHaveValue("adult-1");
    expect(within(dialog).getByLabelText("Authorized adult name")).toHaveValue("Approved Adult");
    expect(within(dialog).queryByText("private infrastructure error")).not.toBeInTheDocument();
  });

  it("requires a note for staff override before sending the canonical checkout", async () => {
    const user = userEvent.setup();
    render(<AttendancePage />);
    await user.click(await screen.findByRole("button", { name: /Check out student-attended/i }));
    const dialog = screen.getByRole("dialog", { name: "Record checkout" });
    await user.selectOptions(within(dialog).getByLabelText("Release method"), "staffOverride");
    await user.click(within(dialog).getByRole("button", { name: "Record checkout" }));
    expect(schedule.recordCheckout).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/override note is required/i);

    await user.type(within(dialog).getByLabelText("Staff override note"), "Released by duty lead");
    await user.click(within(dialog).getByRole("button", { name: "Record checkout" }));
    expect(schedule.recordCheckout).toHaveBeenCalledWith({
      sessionId: "session-connected-1",
      studentId: "student-attended",
      method: "staffOverride",
      notes: "Released by duty lead",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Record checkout" })).not.toBeInTheDocument(),
    );
  });

  it("does not render synthetic attendance when the connected source is empty", async () => {
    schedule.listSessions.mockResolvedValue([]);
    render(<AttendancePage />);
    expect(screen.getByRole("heading", { name: "Attendance" })).toBeVisible();
    await userEvent.click(await screen.findByText("Corrections and closeout"));
    expect(screen.getByLabelText("Attendance state")).toBeVisible();
    expect(await screen.findByText(/No connected attendance records/i)).toBeVisible();
    expect(screen.queryByText("student-pending")).not.toBeInTheDocument();
  });

  it("stacks one roster block per session of the chosen premises and hides the rest", async () => {
    const west = {
      ...session,
      sessionId: "session-west",
      locationId: "west" as const,
      title: "West Kids",
    };
    schedule.listSessions.mockResolvedValue([session, west]);
    schedule.getSessionOperationalView.mockImplementation((sessionId: string) =>
      Promise.resolve(sessionId === "session-west" ? { ...view(), session: west } : view()),
    );
    render(<AttendancePage />);

    expect(
      await screen.findByRole("heading", { name: "Connected fundamentals · Coach coach-1" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: /West Kids/ })).not.toBeInTheDocument();
    expect(schedule.getPreClassView).toHaveBeenCalledWith("session-connected-1");
    expect(schedule.getPreClassView).not.toHaveBeenCalledWith("session-west");

    await userEvent.click(screen.getByRole("radio", { name: "West (St Peter)" }));
    expect(await screen.findByRole("heading", { name: "West Kids · Coach coach-1" })).toBeVisible();
    expect(window.localStorage.getItem("bpt_coach_premises")).toBe("west");
  });

  it("clocks a booked member in manually and refreshes that roster", async () => {
    schedule.recordCheckIn.mockResolvedValue(attended);
    render(<AttendancePage />);
    await userEvent.click(await screen.findByRole("button", { name: "Clock in Ben Booked" }));

    expect(schedule.recordCheckIn).toHaveBeenCalledWith({
      sessionId: "session-connected-1",
      studentId: "student-pending",
      method: "manual",
    });
    await waitFor(() =>
      expect(schedule.getPreClassView.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Clock-in recorded for Ben Booked.",
    );
  });

  it("re-reads the rosters every thirty seconds while the page is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<AttendancePage />);
      await waitFor(() => expect(schedule.getPreClassView).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() =>
        expect(schedule.getPreClassView.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the corrections table, folded under a summary", async () => {
    render(<AttendancePage />);
    const details = (await screen.findByText("Corrections and closeout")).closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Corrections and closeout"));
    expect(screen.getByRole("table", { name: "Attendance roster" })).toBeVisible();
  });

  it("keeps today's classes visible after changing the date and clocking someone in", async () => {
    render(<AttendancePage />);
    await screen.findByRole("button", { name: "Clock in Ben Booked" });

    fireEvent.change(screen.getByLabelText("Attendance date"), {
      target: { value: "2026-09-04" },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Clock in Ben Booked" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Clock-in recorded for Ben Booked.",
    );
    expect(
      screen.getByRole("heading", { name: "Connected fundamentals · Coach coach-1" }),
    ).toBeVisible();
    expect(screen.queryByText("Loading today's classes...")).not.toBeInTheDocument();
  });

  it("ignores a stale roster response that resolves after a newer one issued later", async () => {
    let resolveStale: (value: typeof preClass) => void = () => {};
    let call = 0;
    schedule.getPreClassView.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(preClass);
      if (call === 2) {
        return new Promise((resolve) => {
          resolveStale = resolve;
        });
      }
      return Promise.resolve({
        ...preClass,
        attendees: preClass.attendees.map((a) =>
          a.studentId === "student-pending" ? { ...a, displayName: "Fresh Ben" } : a,
        ),
      });
    });
    schedule.recordCheckIn.mockResolvedValue(attended);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<AttendancePage />);
      await waitFor(() => expect(schedule.getPreClassView).toHaveBeenCalledTimes(1));
      await screen.findByRole("button", { name: "Clock in Ben Booked" });

      // The thirty-second poll fires and issues the stale (slow) request.
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(schedule.getPreClassView).toHaveBeenCalledTimes(2));

      // The clock-in issues a newer request that resolves immediately.
      await user.click(screen.getByRole("button", { name: "Clock in Ben Booked" }));
      await waitFor(() => expect(schedule.getPreClassView).toHaveBeenCalledTimes(3));
      expect(await screen.findByText("Fresh Ben")).toBeVisible();

      // The stale poll response arrives last; it must not overwrite the newer roster.
      resolveStale(preClass);
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.getByText("Fresh Ben")).toBeVisible();
      expect(screen.queryByText("Ben Booked")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("seeds the chosen premises from storage after mount without a hydration mismatch", async () => {
    localStorage.setItem("bpt_coach_premises", "west");
    const west = {
      ...session,
      sessionId: "session-west",
      locationId: "west" as const,
      title: "West Kids",
    };
    schedule.listSessions.mockResolvedValue([session, west]);
    schedule.getSessionOperationalView.mockImplementation((sessionId: string) =>
      Promise.resolve(sessionId === "session-west" ? { ...view(), session: west } : view()),
    );
    render(<AttendancePage />);

    expect(await screen.findByRole("heading", { name: "West Kids · Coach coach-1" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Connected fundamentals · Coach coach-1" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "West (St Peter)" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("still fills the roster under the StrictMode double mount", async () => {
    render(
      <StrictMode>
        <AttendancePage />
      </StrictMode>,
    );

    expect(await screen.findByText("Ana Ready")).toBeVisible();
    expect(screen.getByText("Ben Booked")).toBeVisible();
  });
  it("keeps every attendance control under the same accessible name", async () => {
    const user = userEvent.setup();
    render(<AttendancePage />);

    expect(await screen.findByRole("button", { name: "Clock in Ben Booked" })).toBeEnabled();
    await user.click(screen.getByText("Corrections and closeout"));
    expect(await screen.findByRole("button", { name: "Check in student-pending" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Correct attendance for student-attended" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check out student-attended" })).toBeEnabled();
  });

  it("labels every correction cell so the table can stack into a list on phones", async () => {
    const user = userEvent.setup();
    render(<AttendancePage />);
    await user.click(await screen.findByText("Corrections and closeout"));

    const table = await screen.findByRole("table", { name: "Attendance roster" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.replace(/[↑↓↕]/gu, "").trim());
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const cells = within(row).getAllByRole("cell");
      expect(cells.map((cell) => cell.getAttribute("data-label"))).toEqual(headers);
    }
  });

  it("styles attendance for phones: stacked corrections, 16px fields, 44px targets, dvh dialog", () => {
    const phone = cssBlock(attendanceCss, "@media (max-width: 47.99rem)");
    expect(phone).toMatch(
      /\.attendance-corrections \.admin-data-table thead\s*\{[^}]*display: none;/u,
    );
    expect(phone).toMatch(
      /\.attendance-corrections \.admin-data-table td::before\s*\{[^}]*content: attr\(data-label\);/u,
    );
    expect(attendanceCss).not.toMatch(/max-width: (?:700|720)px/u);
    expect(attendanceCss).toMatch(/\.attendance-field textarea\s*\{[^}]*font-size: 1rem;/u);
    expect(attendanceCss).toMatch(
      /\.attendance-page \.admin-filter-control select\s*\{[^}]*font-size: 1rem;/u,
    );
    expect(attendanceCss).not.toMatch(/100vh/u);
    expect(cssBlock(attendanceCss, ".attendance-dialog {")).toMatch(
      /max-height: calc\(100dvh - 2rem\);/u,
    );
    expect(attendanceCss).not.toMatch(/min-width: 12rem/u);
    expect(attendanceCss).not.toMatch(/minmax\(12rem/u);
    expect(attendanceCss).not.toMatch(/box-shadow/u);
    for (const [, selector, minHeight] of attendanceCss.matchAll(
      /([^{}]+)\{[^}]*min-height: ([\d.]+)rem;/gu,
    )) {
      if (/button|clock-in|summary|input|select/u.test(selector ?? "")) {
        expect(Number(minHeight), selector?.trim()).toBeGreaterThanOrEqual(2.75);
      }
    }
  });
});
