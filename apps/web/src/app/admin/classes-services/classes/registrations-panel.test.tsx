import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  listMemberNames: vi.fn(),
  listMemberships: vi.fn(),
  listSessionBookings: vi.fn(),
  requestBooking: vi.fn(),
}));

vi.mock("../../../../lib/schedule-client", () => ({
  cancelBooking: mocks.cancelBooking,
  listSessionBookings: mocks.listSessionBookings,
  requestBooking: mocks.requestBooking,
}));
vi.mock("../../../../lib/members-client", () => ({ listMemberNames: mocks.listMemberNames }));
vi.mock("../../../../lib/membership-admin-client", () => ({
  listMemberships: mocks.listMemberships,
}));

import { RegistrationsPanel } from "./registrations-panel";

const academyId = "academy-test";
const stamp = "2026-09-10T09:00:00.000Z";

const sessionFixture = {
  sessionId: "s1",
  academyId,
  classId: null,
  programId: "p1",
  locationId: "town",
  instructorId: "coach-a",
  instructorIds: ["coach-a"],
  title: "GI All Levels Evenings",
  startAt: "2026-09-14T16:30:00.000Z",
  endAt: "2026-09-14T17:30:00.000Z",
  capacity: 40,
  minParticipants: 0,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: stamp,
  createdBy: "admin",
  updatedAt: stamp,
  updatedBy: "admin",
} as const;

function membership(membershipId: string, studentId: string, familyId: string, status: string) {
  return {
    membershipId,
    familyId,
    studentId,
    planId: "plan-adult",
    status,
    startsAt: stamp,
    endsAt: null,
    nextBillingAt: null,
  };
}

describe("RegistrationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessionBookings.mockResolvedValue([]);
    mocks.listMemberNames.mockResolvedValue([]);
    mocks.listMemberships.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("lists confirmed bookings with a remove button and enrols a member by search", async () => {
    mocks.listSessionBookings.mockResolvedValue([
      { bookingId: "b1", sessionId: "s1", studentId: "st1", status: "confirmed" },
    ]);
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    mocks.listMemberships.mockResolvedValue([membership("m2", "st2", "f2", "active")]);
    mocks.requestBooking.mockResolvedValue({
      bookingId: "b2",
      sessionId: "s1",
      studentId: "st2",
      status: "confirmed",
    });
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    expect(await screen.findByRole("button", { name: /remove/i })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Enrol a member of this gym" }), {
      target: { value: "wi" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Willow S." }));
    await waitFor(() =>
      expect(mocks.requestBooking).toHaveBeenCalledWith({
        sessionId: "s1",
        studentId: "st2",
        membershipId: "m2",
      }),
    );
  });

  it("removes a registration with the office reason", async () => {
    mocks.listSessionBookings.mockResolvedValue([
      { bookingId: "b1", sessionId: "s1", studentId: "st1", status: "confirmed" },
    ]);
    mocks.cancelBooking.mockResolvedValue({
      bookingId: "b1",
      sessionId: "s1",
      studentId: "st1",
      status: "cancelled",
    });
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    fireEvent.click(await screen.findByRole("button", { name: /remove/i }));
    await waitFor(() =>
      expect(mocks.cancelBooking).toHaveBeenCalledWith({
        sessionId: "s1",
        studentId: "st1",
        reason: "Removed by the office",
      }),
    );
  });

  it("enrols every student of a family from the Group tab", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st3", fullName: "Ada Scally", familyId: "f1" },
      { studentId: "st4", fullName: "Ben Scally", familyId: "f1" },
    ]);
    mocks.listMemberships.mockResolvedValue([
      membership("m3", "st3", "f1", "active"),
      membership("m4", "st4", "f1", "active"),
    ]);
    mocks.requestBooking.mockResolvedValue({
      bookingId: "b",
      sessionId: "s1",
      studentId: "st3",
      status: "confirmed",
    });
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    fireEvent.click(screen.getByRole("tab", { name: "Group" }));
    fireEvent.click(await screen.findByRole("button", { name: "Scally family" }));
    await waitFor(() => expect(mocks.requestBooking).toHaveBeenCalledTimes(2));
    expect(mocks.requestBooking).toHaveBeenCalledWith({
      sessionId: "s1",
      studentId: "st4",
      membershipId: "m4",
    });
  });

  it("refuses to enrol a member without an active membership", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    mocks.listMemberships.mockResolvedValue([membership("m2", "st2", "f2", "cancelled")]);
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Enrol a member of this gym" }), {
      target: { value: "wi" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Willow S." }));
    expect(await screen.findByText("No active membership")).toBeInTheDocument();
    expect(mocks.requestBooking).not.toHaveBeenCalled();
  });

  it("names a refused membership list instead of blaming the member", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    mocks.listMemberships.mockRejectedValue(new Error("unavailable"));
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    expect(await screen.findByText("Membership list unavailable")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Enrol a member of this gym" })).toBeDisabled();
    expect(screen.queryByText("No active membership")).not.toBeInTheDocument();
  });

  it("explains that External registrations arrive with Drop-ins", () => {
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    fireEvent.click(screen.getByRole("tab", { name: "External" }));
    expect(
      screen.getByText(/Drop-in registrations arrive with the Drop-ins release/i),
    ).toBeInTheDocument();
  });

  it("gives a coach no enrolment or removal controls", async () => {
    mocks.listSessionBookings.mockResolvedValue([
      { bookingId: "b1", sessionId: "s1", studentId: "st1", status: "confirmed" },
    ]);
    render(
      <RegistrationsPanel session={sessionFixture} canEdit={false} canReadMemberships={false} />,
    );
    expect(await screen.findByText("st1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("falls back to the studentId when the member directory is refused", async () => {
    mocks.listSessionBookings.mockResolvedValue([
      { bookingId: "b1", sessionId: "s1", studentId: "st1", status: "confirmed" },
    ]);
    mocks.listMemberNames.mockRejectedValue(new Error("permission-denied"));
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    expect(await screen.findByText("st1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells a head coach that enrolment needs an office account", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships={false} />);
    expect(await screen.findByText("Enrolment needs an office account")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Enrol a member of this gym" })).toBeDisabled();
    expect(mocks.listMemberships).not.toHaveBeenCalled();
    // The directory is office-only too: asking for it would only earn a refusal.
    expect(mocks.listMemberNames).not.toHaveBeenCalled();
  });
});
