import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AttendanceRecord,
  SessionOperationalView,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";

const schedule = vi.hoisted(() => ({
  correctAttendance: vi.fn(),
  getSessionOperationalView: vi.fn(),
  listSessions: vi.fn(),
  reconcileSessionNoShows: vi.fn(),
  recordCheckIn: vi.fn(),
  recordCheckout: vi.fn(),
}));

vi.mock("../../../lib/schedule-client", () => schedule);

import { AttendancePage } from "./page";

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

beforeEach(() => {
  vi.clearAllMocks();
  schedule.listSessions.mockResolvedValue([session]);
  schedule.getSessionOperationalView.mockResolvedValue(view());
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
});

describe("attendance page", () => {
  it("checks in a pending canonical booking, refreshes it, and marks session no-shows", async () => {
    const user = userEvent.setup();
    schedule.getSessionOperationalView
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view("attended"))
      .mockResolvedValueOnce(view("no_show"));
    render(<AttendancePage />);

    expect(await screen.findByText("student-pending")).toBeVisible();
    expect(screen.getByText(/QR and PIN check-in are unavailable/i)).toBeVisible();
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
    expect(screen.getByLabelText("Attendance state")).toBeVisible();
    expect(await screen.findByText(/No connected attendance records/i)).toBeVisible();
    expect(screen.queryByText("student-pending")).not.toBeInTheDocument();
  });
});
