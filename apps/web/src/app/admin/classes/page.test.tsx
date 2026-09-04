import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClassesPage } from "./page";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  cancelSession: vi.fn(),
  generateSessions: vi.fn(),
  getScheduleCatalog: vi.fn(),
  listClasses: vi.fn(),
  listMembers: vi.fn(),
  listMemberships: vi.fn(),
  listSessionBookings: vi.fn(),
  listSessions: vi.fn(),
  listStaffProfiles: vi.fn(),
  requestBooking: vi.fn(),
  saveClass: vi.fn(),
  saveSession: vi.fn(),
  updateClass: vi.fn(),
}));

vi.mock("../../../lib/schedule-client", () => ({
  cancelBooking: mocks.cancelBooking,
  cancelSession: mocks.cancelSession,
  generateSessions: mocks.generateSessions,
  getScheduleCatalog: mocks.getScheduleCatalog,
  listClasses: mocks.listClasses,
  listSessionBookings: mocks.listSessionBookings,
  listSessions: mocks.listSessions,
  requestBooking: mocks.requestBooking,
  saveClass: mocks.saveClass,
  saveSession: mocks.saveSession,
  updateClass: mocks.updateClass,
}));

vi.mock("../../../lib/members-client", () => ({
  listMembers: mocks.listMembers,
}));

vi.mock("../../../lib/membership-admin-client", () => ({
  listMemberships: mocks.listMemberships,
}));

vi.mock("../../../lib/staff-client", () => ({
  listStaffProfiles: mocks.listStaffProfiles,
}));

const academyId = "academy-test";
const now = "2026-09-03T10:00:00.000Z";

describe("classes administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getScheduleCatalog.mockResolvedValue({
      locations: [
        {
          locationId: "town",
          academyId,
          name: "BPT Town",
          address: "Town address",
          timezone: "Europe/Jersey",
          active: true,
          schemaVersion: "1",
        },
        {
          locationId: "west",
          academyId,
          name: "BPT West",
          address: "West address",
          timezone: "Europe/Jersey",
          active: true,
          schemaVersion: "1",
        },
      ],
      programs: [
        {
          programId: "program-adults",
          academyId,
          name: "Adults BJJ",
          ageBand: "adult",
          discipline: "bjj",
          level: "fundamentals",
          active: true,
          schemaVersion: "1",
        },
      ],
    });
    mocks.listClasses.mockResolvedValue([
      {
        classId: "class-adults",
        academyId,
        programId: "program-adults",
        locationId: "town",
        name: "Adult Fundamentals",
        recurrenceRule: { dayOfWeek: 2, startTime: "18:00", durationMinutes: 60 },
        instructorIds: ["coach-ada"],
        capacity: 24,
        minParticipants: 4,
        active: true,
        schemaVersion: "1",
        createdAt: now,
        createdBy: "admin-test",
        updatedAt: now,
        updatedBy: "admin-test",
      },
    ]);
    mocks.listSessions.mockResolvedValue([
      {
        sessionId: "session-adults",
        academyId,
        classId: "class-adults",
        programId: "program-adults",
        locationId: "town",
        instructorId: "coach-ada",
        title: "Adult Fundamentals · Tuesday",
        startAt: "2026-09-08T17:00:00.000Z",
        endAt: "2026-09-08T18:00:00.000Z",
        capacity: 24,
        minParticipants: 4,
        status: "scheduled",
        isSeminar: false,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: "admin-test",
        updatedAt: now,
        updatedBy: "admin-test",
      },
    ]);
    mocks.listMembers.mockResolvedValue({
      rows: [
        {
          studentId: "student-avery",
          fullName: "Avery Lane",
          trainingCenter: "Town",
          participantType: "adult",
          active: true,
          status: "active",
          membershipReference: "****1234",
        },
      ],
    });
    mocks.listMemberships.mockResolvedValue([
      {
        membershipId: "membership-avery",
        familyId: "family-avery",
        studentId: "student-avery",
        planId: "adult-unlimited",
        status: "active",
        startsAt: now,
        endsAt: null,
        nextBillingAt: null,
      },
    ]);
    mocks.listStaffProfiles.mockResolvedValue([
      {
        staffKey: "coach-ada",
        role: "coach",
        active: true,
        status: "active",
        schemaVersion: "1",
      },
    ]);
    mocks.updateClass.mockRejectedValue(new Error("private backend detail"));
  });

  it("keeps a failed connected class edit open without reporting success", async () => {
    render(<ClassesPage />);

    expect((await screen.findAllByText("BPT Town")).length).toBeGreaterThan(0);
    expect(screen.getByText("BPT West")).toBeVisible();
    expect(screen.getByText("Adult Fundamentals")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit Adult Fundamentals" }));
    fireEvent.change(screen.getByLabelText("Class name"), {
      target: { value: "Adult Fundamentals Plus" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Edit class" }));

    await waitFor(() =>
      expect(mocks.updateClass).toHaveBeenCalledWith({
        classId: "class-adults",
        name: "Adult Fundamentals Plus",
        instructorIds: ["coach-ada"],
        capacity: 24,
        minParticipants: 4,
        active: true,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to update the class. Review the fields and try again.",
    );
    expect(screen.getByRole("dialog", { name: "Edit class" })).toBeVisible();
    expect(screen.queryByText("Class updated.")).not.toBeInTheDocument();
    expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
  });
});
