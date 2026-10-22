import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  getRegistrationChoice: vi.fn(),
  listMemberNames: vi.fn(),
  listMemberships: vi.fn(),
  listSessionBookings: vi.fn(),
  requestBooking: vi.fn(),
  confirmPaygClassPayment: vi.fn(),
  listSessionGroups: vi.fn(),
  registerMemberGroup: vi.fn(),
}));

vi.mock("../../../../lib/schedule-client", () => ({
  cancelBooking: mocks.cancelBooking,
  listSessionBookings: mocks.listSessionBookings,
  requestBooking: mocks.requestBooking,
}));
vi.mock("../../../../lib/members-client", () => ({ listMemberNames: mocks.listMemberNames }));
vi.mock("../../../../lib/membership-admin-client", () => ({
  getRegistrationChoice: mocks.getRegistrationChoice,
  listMemberships: mocks.listMemberships,
}));
vi.mock("../../../../lib/groups-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmPaygClassPayment: mocks.confirmPaygClassPayment,
  listSessionGroups: mocks.listSessionGroups,
  registerMemberGroup: mocks.registerMemberGroup,
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

function bookWith(membershipId: string, studentId = "st2") {
  return { studentId, choice: { kind: "membership", membershipId }, reason: null };
}

function refused(reason: string, studentId = "st2") {
  return { studentId, choice: null, reason };
}

async function enrolByName(name: string, search = name.slice(0, 2)) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Enrol a member of this gym" }), {
    target: { value: search },
  });
  fireEvent.click(await screen.findByRole("button", { name }));
}

describe("RegistrationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessionBookings.mockResolvedValue([]);
    mocks.listMemberNames.mockResolvedValue([]);
    mocks.listMemberships.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("shows loading instead of an empty list while registrations are pending", async () => {
    let resolveBookings!: (rows: readonly unknown[]) => void;
    mocks.listSessionBookings.mockReturnValue(
      new Promise((resolve) => {
        resolveBookings = resolve;
      }),
    );
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading registrations");
    expect(screen.queryByText("No one is registered yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeDisabled();
    resolveBookings([]);
    expect(await screen.findByText("No one is registered yet.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeEnabled();
  });

  it("lists confirmed bookings with a remove button and enrols a member by search", async () => {
    mocks.listSessionBookings.mockResolvedValue([
      { bookingId: "b1", sessionId: "s1", studentId: "st1", status: "confirmed" },
    ]);
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    mocks.getRegistrationChoice.mockResolvedValue(bookWith("m2"));
    mocks.requestBooking.mockResolvedValue({
      bookingId: "b2",
      sessionId: "s1",
      studentId: "st2",
      status: "confirmed",
    });
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    expect(await screen.findByRole("button", { name: /remove/i })).toBeInTheDocument();
    await enrolByName("Willow S.", "wi");
    await waitFor(() =>
      expect(mocks.requestBooking).toHaveBeenCalledWith({
        kind: "membership",
        sessionId: "s1",
        studentId: "st2",
        membershipId: "m2",
      }),
    );
    expect(mocks.getRegistrationChoice).toHaveBeenCalledWith("s1", "st2");
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

  // 2026-09-22 (fb95011, ADR-018 group exception): the Group tab no longer books each student of a
  // directory family from the browser; the office registers a group and the server books its members.
  it("enrols every member of a group from the Group tab", async () => {
    const notYet = { missingPayment: false, state: "pending", reason: "Not registered yet" };
    const group = {
      groupId: "g1",
      name: "Scally family",
      site: "Town",
      active: true,
      assigned: false,
      recurring: false,
      members: [
        { studentId: "st3", fullName: "Ada Scally", ...notYet },
        { studentId: "st4", fullName: "Ben Scally", ...notYet },
      ],
    };
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st3", fullName: "Ada Scally", familyId: "f1" },
      { studentId: "st4", fullName: "Ben Scally", familyId: "f1" },
    ]);
    mocks.listSessionGroups.mockResolvedValue([group]);
    mocks.registerMemberGroup.mockResolvedValue([
      {
        ...group,
        assigned: true,
        members: group.members.map((member) => ({
          ...member,
          state: "registered",
          reason: "Registered",
        })),
      },
    ]);
    mocks.listSessionBookings.mockResolvedValueOnce([]).mockResolvedValue([
      { bookingId: "b3", sessionId: "s1", studentId: "st3", status: "confirmed" },
      { bookingId: "b4", sessionId: "s1", studentId: "st4", status: "confirmed" },
    ]);
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    fireEvent.click(screen.getByRole("tab", { name: "Group" }));
    fireEvent.click(await screen.findByRole("button", { name: /Scally family/ }));
    fireEvent.click(screen.getByRole("button", { name: "Register group" }));
    await waitFor(() => expect(mocks.registerMemberGroup).toHaveBeenCalledTimes(1));
    expect(mocks.registerMemberGroup).toHaveBeenCalledWith("g1", "s1");
    expect(await screen.findByRole("button", { name: "Remove Ben Scally" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Ada Scally" })).toBeInTheDocument();
    expect(mocks.requestBooking).not.toHaveBeenCalled();
  });

  it("refuses to enrol a member without an active membership", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    mocks.getRegistrationChoice.mockResolvedValue(refused("no-plan"));
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    await enrolByName("Willow S.", "wi");
    expect(await screen.findByText("No active membership")).toBeInTheDocument();
    expect(mocks.requestBooking).not.toHaveBeenCalled();
  });

  it("refuses a class outside the paid period, as the server judged it", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    mocks.getRegistrationChoice.mockResolvedValue(refused("plan-dates"));
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    await screen.findByText("No one is registered yet.");
    await enrolByName("Willow S.", "wi");
    expect(
      await screen.findByText(/outside the member's paid membership period/),
    ).toBeInTheDocument();
    expect(mocks.requestBooking).not.toHaveBeenCalled();
  });

  it("names a failed membership check instead of blaming the member", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    mocks.getRegistrationChoice.mockRejectedValue(
      new Error("Unable to check this member's membership. Please try again."),
    );
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
    await screen.findByText("No one is registered yet.");
    expect(screen.getByRole("searchbox", { name: "Enrol a member of this gym" })).toBeEnabled();
    await enrolByName("Willow S.", "wi");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to check this member's membership. Please try again.",
    );
    expect(screen.queryByText("No active membership")).not.toBeInTheDocument();
    expect(mocks.requestBooking).not.toHaveBeenCalled();
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

  it("lets a coach confirm a Pay-at-venue PAYG payment from the roster", async () => {
    mocks.listSessionBookings.mockResolvedValue([
      {
        bookingId: "b1",
        sessionId: "s1",
        studentId: "st1",
        status: "confirmed",
        paymentLabel: "PAYG Pay at venue",
      },
    ]);
    mocks.confirmPaygClassPayment.mockResolvedValue({ status: "paid" });
    render(
      <RegistrationsPanel session={sessionFixture} canEdit={false} canReadMemberships={false} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm paid" }));
    await waitFor(() =>
      expect(mocks.confirmPaygClassPayment).toHaveBeenCalledWith("s1", "st1"),
    );
  });

  it("tells a head coach that enrolment needs an office account", async () => {
    mocks.listMemberNames.mockResolvedValue([
      { studentId: "st2", fullName: "Willow S.", familyId: null },
    ]);
    render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships={false} />);
    expect(await screen.findByText("Enrolment needs an office account")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Enrol a member of this gym" })).toBeDisabled();
    expect(mocks.listMemberships).not.toHaveBeenCalled();
    expect(mocks.getRegistrationChoice).not.toHaveBeenCalled();
    // The directory is office-only too: asking for it would only earn a refusal.
    expect(mocks.listMemberNames).not.toHaveBeenCalled();
  });

  // 2026-10-20: the panel read the academy-wide list, which stops at 100 of 122 memberships, matched
  // ids exactly and always booked as "membership"; it now asks the server per student.
  describe("per-student registration choice", () => {
    it("books a member whose plan is past the academy's first hundred memberships", async () => {
      mocks.listMemberships.mockResolvedValue(
        Array.from({ length: 100 }, (_, index) =>
          membership(`m${index}`, `other-${index}`, `f${index}`, "active"),
        ),
      );
      mocks.listMemberNames.mockResolvedValue([
        { studentId: "st101", fullName: "Rowan Late", familyId: null },
      ]);
      mocks.getRegistrationChoice.mockResolvedValue(bookWith("m101", "st101"));
      mocks.requestBooking.mockResolvedValue({ bookingId: "b101", status: "confirmed" });
      render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
      await enrolByName("Rowan Late");

      await waitFor(() =>
        expect(mocks.requestBooking).toHaveBeenCalledWith({
          kind: "membership",
          sessionId: "s1",
          studentId: "st101",
          membershipId: "m101",
        }),
      );
      expect(mocks.getRegistrationChoice).toHaveBeenCalledWith("s1", "st101");
      expect(mocks.listMemberships).not.toHaveBeenCalled();
    });

    it("books a Free Trial student as an intro, with no membership", async () => {
      mocks.listMemberNames.mockResolvedValue([
        { studentId: "st5", fullName: "Tia Trial", familyId: null },
      ]);
      mocks.getRegistrationChoice.mockResolvedValue({
        studentId: "st5",
        choice: { kind: "intro" },
        reason: null,
      });
      mocks.requestBooking.mockResolvedValue({ bookingId: "b5", status: "confirmed" });
      render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
      await enrolByName("Tia Trial");

      await waitFor(() =>
        expect(mocks.requestBooking).toHaveBeenCalledWith({
          kind: "intro",
          sessionId: "s1",
          studentId: "st5",
        }),
      );
      expect(screen.queryByText("No active membership")).not.toBeInTheDocument();
    });

    it("explains a Free Trial that cannot be used and books nothing", async () => {
      mocks.listMemberNames.mockResolvedValue([
        { studentId: "st5", fullName: "Tia Trial", familyId: null },
      ]);
      mocks.getRegistrationChoice.mockResolvedValue(refused("trial-unavailable", "st5"));
      render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
      await enrolByName("Tia Trial");

      expect(
        await screen.findByText(
          "This member's Free Trial is used up, has ended or is for the other centre",
        ),
      ).toBeInTheDocument();
      expect(mocks.requestBooking).not.toHaveBeenCalled();
    });

    it("books with a membership the member holds under an earlier id", async () => {
      mocks.listMemberNames.mockResolvedValue([
        { studentId: "st-new", fullName: "Alias Member", familyId: null },
      ]);
      mocks.getRegistrationChoice.mockResolvedValue(bookWith("m-old", "st-canonical"));
      mocks.requestBooking.mockResolvedValue({ bookingId: "b6", status: "confirmed" });
      render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
      await enrolByName("Alias Member");

      await waitFor(() =>
        expect(mocks.requestBooking).toHaveBeenCalledWith({
          kind: "membership",
          sessionId: "s1",
          studentId: "st-new",
          membershipId: "m-old",
        }),
      );
    });

    it("shows a refused office session as safe text and books nothing", async () => {
      const refusal =
        "An active administrator session is required. Sign in again and reopen this class.";
      mocks.listMemberNames.mockResolvedValue([
        { studentId: "st2", fullName: "Willow S.", familyId: null },
      ]);
      mocks.getRegistrationChoice.mockRejectedValue(new Error(refusal));
      render(<RegistrationsPanel session={sessionFixture} canEdit canReadMemberships />);
      await enrolByName("Willow S.", "wi");

      expect(await screen.findByRole("alert")).toHaveTextContent(refusal);
      expect(mocks.requestBooking).not.toHaveBeenCalled();
    });
  });
});
