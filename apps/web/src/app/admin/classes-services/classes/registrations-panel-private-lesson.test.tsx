import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  listMemberNames: vi.fn(),
  listMemberships: vi.fn(),
  listSessionBookings: vi.fn(),
  requestBooking: vi.fn(),
  bookPrivateLesson: vi.fn(),
  cancelPrivateLessonBooking: vi.fn(),
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
vi.mock("../../../../lib/private-lesson-client", () => ({
  bookPrivateLesson: mocks.bookPrivateLesson,
  cancelPrivateLessonBooking: mocks.cancelPrivateLessonBooking,
}));
vi.mock("./group-registrations", () => ({ GroupRegistrations: () => null }));

import { RegistrationsPanel } from "./registrations-panel";

const stamp = "2026-09-10T09:00:00.000Z";
const privateLesson = {
  sessionId: "s1",
  academyId: "academy-test",
  classId: null,
  programId: "p1",
  locationId: "town",
  instructorId: "coach-a",
  title: "Private lesson",
  startAt: "2026-09-14T16:30:00.000Z",
  endAt: "2026-09-14T17:30:00.000Z",
  capacity: 1,
  minParticipants: 0,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: stamp,
  createdBy: "admin",
  updatedAt: stamp,
  updatedBy: "admin",
  accessMode: "private-lesson",
} as const;

const booked = {
  bookingId: "b1",
  sessionId: "s1",
  studentId: "st1",
  status: "confirmed",
  schemaVersion: "4",
  membershipId: null,
  source: { kind: "private-lesson", purchaseId: "p1" },
  displayName: "Ana Silva",
  paymentLabel: "Private lesson",
};

describe("RegistrationsPanel for a private lesson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessionBookings.mockResolvedValue([]);
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st1", fullName: "Ana Silva", familyId: null },
    ]);
    mocks.listMemberships.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("registers a member with a private lesson credit instead of a membership", async () => {
    mocks.bookPrivateLesson.mockResolvedValue({ bookingId: "b1" });
    render(<RegistrationsPanel session={privateLesson} canEdit canReadMemberships />);
    const search = await screen.findByRole("searchbox", { name: "Enrol a member of this gym" });
    await waitFor(() => expect(search).toBeEnabled());
    fireEvent.change(search, { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Ana Silva" }));
    await waitFor(() =>
      expect(mocks.bookPrivateLesson).toHaveBeenCalledWith({ sessionId: "s1", studentId: "st1" }),
    );
    expect(mocks.requestBooking).not.toHaveBeenCalled();
  });

  it("cancels through the private lesson cancellation and says whether the credit came back", async () => {
    mocks.listSessionBookings.mockResolvedValue([booked]);
    mocks.cancelPrivateLessonBooking.mockResolvedValue({ booking: booked, creditRestored: false });
    render(<RegistrationsPanel session={privateLesson} canEdit canReadMemberships />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Ana Silva" }));
    await waitFor(() =>
      expect(mocks.cancelPrivateLessonBooking).toHaveBeenCalledWith({
        bookingId: "b1",
        reason: "Removed by the office",
      }),
    );
    expect(mocks.cancelBooking).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Cancelled. The purchase had expired, so the credit was not returned.",
      ),
    ).toBeVisible();
  });

  it("shows a coach the lesson without any control or amount", async () => {
    mocks.listSessionBookings.mockResolvedValue([booked]);
    render(<RegistrationsPanel session={privateLesson} canEdit canReadMemberships={false} />);
    expect(await screen.findByText("Ana Silva")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Remove/u })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByText(/£/u)).toBeNull();
    expect(screen.getByText("Private lessons are booked by the office.")).toBeVisible();
  });
});
