import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClassesPage } from "./page";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  cancelSession: vi.fn(),
  generateSessions: vi.fn(),
  getScheduleCatalog: vi.fn(),
  getLevelCatalog: vi.fn(),
  listClasses: vi.fn(),
  listMembers: vi.fn(),
  listMemberships: vi.fn(),
  listSessionBookings: vi.fn(),
  listSessions: vi.fn(),
  listStaffProfiles: vi.fn(),
  removeClass: vi.fn(),
  requestBooking: vi.fn(),
  saveClass: vi.fn(),
  saveSession: vi.fn(),
  updateClass: vi.fn(),
  updateSession: vi.fn(),
  useAdminOrStaffSession: vi.fn(),
}));

vi.mock("../../../lib/schedule-client", () => ({
  cancelBooking: mocks.cancelBooking,
  cancelSession: mocks.cancelSession,
  generateSessions: mocks.generateSessions,
  getScheduleCatalog: mocks.getScheduleCatalog,
  listClasses: mocks.listClasses,
  listSessionBookings: mocks.listSessionBookings,
  listSessions: mocks.listSessions,
  removeClass: mocks.removeClass,
  requestBooking: mocks.requestBooking,
  saveClass: mocks.saveClass,
  saveSession: mocks.saveSession,
  updateClass: mocks.updateClass,
  updateSession: mocks.updateSession,
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

vi.mock("../../../lib/levels-client", () => ({
  getLevelCatalog: mocks.getLevelCatalog,
}));

vi.mock("../admin-gate", () => ({
  useAdminOrStaffSession: mocks.useAdminOrStaffSession,
}));

const academyId = "academy-test";
const now = "2026-09-03T10:00:00.000Z";

const classFixture = {
  classId: "class-adults",
  academyId,
  programId: "program-adults",
  locationId: "town",
  name: "Adult Fundamentals",
  recurrenceRules: [
    { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
    { dayOfWeek: 3, startTime: "18:00", durationMinutes: 60 },
  ],
  description: "",
  ageRange: { minAge: 8, maxAge: 11 },
  levelRange: { fromKey: "k-white", toKey: "k-grey", fromName: "White", toName: "Grey" },
  instructorIds: ["coach-1"],
  capacity: 24,
  minParticipants: 4,
  active: true,
  schemaVersion: "2",
  createdAt: now,
  createdBy: "admin-test",
  updatedAt: now,
  updatedBy: "admin-test",
} as const;

const sessionFixture = {
  sessionId: "session-adults",
  academyId,
  classId: "class-adults",
  programId: "program-adults",
  locationId: "town",
  instructorId: "coach-1",
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
} as const;

describe("classes administration", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "owner" });
    mocks.getLevelCatalog.mockResolvedValue({
      system: {
        systemId: "ibjjf",
        displayName: "IBJJF",
        schemaVersion: 1,
        precedence: {},
        counts: { definitions: 2, belts: 2, stripes: 0 },
        skillCatalog: [],
      },
      definitions: [
        {
          definitionKey: "k-white",
          systemId: "ibjjf",
          kind: "belt",
          parentDefinitionKey: null,
          name: "White",
          sequence: 1,
          stripeNumber: null,
          criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null },
          observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
          visual: {
            colorMode: 1,
            colors: ["#ffffff"],
            stripeColor: null,
            stripeCenter: null,
            stripeWidth: null,
            stripePosition: null,
          },
          observedSkillRequirementSetKey: null,
          observedSkillRequirementsState: "none",
          anomalyFlags: [],
          schemaVersion: 1,
        },
        {
          definitionKey: "k-grey",
          systemId: "ibjjf",
          kind: "belt",
          parentDefinitionKey: null,
          name: "Grey",
          sequence: 2,
          stripeNumber: null,
          criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null },
          observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
          visual: {
            colorMode: 1,
            colors: ["#8a8880"],
            stripeColor: null,
            stripeCenter: null,
            stripeWidth: null,
            stripePosition: null,
          },
          observedSkillRequirementSetKey: null,
          observedSkillRequirementsState: "none",
          anomalyFlags: [],
          schemaVersion: 1,
        },
      ],
      skills: [],
      requirements: [],
      sourceHash: "test",
    });
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
    mocks.listClasses.mockResolvedValue([classFixture]);
    mocks.listSessions.mockResolvedValue([sessionFixture]);
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
        staffKey: "coach-1",
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
    expect(screen.getAllByText("BPT West").length).toBeGreaterThan(0);
    // T109: the site coordinates editor is part of the catalog section, one form per site.
    expect(screen.getByTestId("site-geofence-panel")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "BPT Town coordinates" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "BPT West coordinates" })).toBeInTheDocument();
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
        recurrenceRules: [
          { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
          { dayOfWeek: 3, startTime: "18:00", durationMinutes: 60 },
        ],
        instructorIds: ["coach-1"],
        capacity: 24,
        minParticipants: 4,
        active: true,
        description: "",
        ageRange: { minAge: 8, maxAge: 11 },
        levelRange: { fromKey: "k-white", toKey: "k-grey", fromName: "White", toName: "Grey" },
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to update the class. Review the fields and try again.",
    );
    expect(screen.getByRole("dialog", { name: "Edit class" })).toBeVisible();
    expect(screen.queryByText("Class updated.")).not.toBeInTheDocument();
    expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
  });

  it("creates a two-day class with ranges through the new form", async () => {
    mocks.getLevelCatalog.mockResolvedValue({
      system: {
        systemId: "ibjjf",
        displayName: "IBJJF",
        schemaVersion: 1,
        precedence: {},
        counts: { definitions: 2, belts: 2, stripes: 0 },
        skillCatalog: [],
      },
      definitions: [
        {
          definitionKey: "k-white",
          systemId: "ibjjf",
          kind: "belt",
          parentDefinitionKey: null,
          name: "White",
          sequence: 1,
          stripeNumber: null,
          criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null },
          observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
          visual: {
            colorMode: 1,
            colors: ["#ffffff"],
            stripeColor: null,
            stripeCenter: null,
            stripeWidth: null,
            stripePosition: null,
          },
          observedSkillRequirementSetKey: null,
          observedSkillRequirementsState: "none",
          anomalyFlags: [],
          schemaVersion: 1,
        },
        {
          definitionKey: "k-grey",
          systemId: "ibjjf",
          kind: "belt",
          parentDefinitionKey: null,
          name: "Grey",
          sequence: 2,
          stripeNumber: null,
          criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null },
          observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
          visual: {
            colorMode: 1,
            colors: ["#8a8880"],
            stripeColor: null,
            stripeCenter: null,
            stripeWidth: null,
            stripePosition: null,
          },
          observedSkillRequirementSetKey: null,
          observedSkillRequirementsState: "none",
          anomalyFlags: [],
          schemaVersion: 1,
        },
      ],
      skills: [],
      requirements: [],
      sourceHash: "test",
    });
    mocks.saveClass.mockImplementation(async (input) => ({
      ...input,
      classId: "class-new",
      academyId,
      active: true,
      schemaVersion: "2",
      createdAt: now,
      createdBy: "u",
      updatedAt: now,
      updatedBy: "u",
    }));
    render(<ClassesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New class" }));
    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Kids BJJ" } });
    fireEvent.change(screen.getByLabelText("Program"), {
      target: { value: "program-adults" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "BPT Town" }));
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
    fireEvent.click(screen.getByRole("radio", { name: "8–11" }));
    fireEvent.change(screen.getByLabelText("From belt"), { target: { value: "k-white" } });
    fireEvent.change(screen.getByLabelText("To belt"), { target: { value: "k-grey" } });
    fireEvent.click(screen.getByLabelText("coach-1"));
    fireEvent.click(screen.getByRole("button", { name: "Create class" }));
    await waitFor(() => expect(mocks.saveClass).toHaveBeenCalledTimes(1));
    expect(mocks.saveClass.mock.calls[0]![0]).toMatchObject({
      recurrenceRules: [
        { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
        { dayOfWeek: 3, startTime: "18:00", durationMinutes: 60 },
      ],
      ageRange: { minAge: 8, maxAge: 11 },
      levelRange: { fromKey: "k-white", toKey: "k-grey", fromName: "White", toName: "Grey" },
    });
    expect(await screen.findByText("Class created.")).toBeInTheDocument();
  });

  it("edits a session and removes a class with a reason", async () => {
    mocks.updateSession.mockImplementation(async (input) => ({ ...sessionFixture, ...input }));
    mocks.removeClass.mockResolvedValue({
      class: { ...classFixture, active: false },
      cancelledSessions: [sessionFixture, sessionFixture],
    });
    render(<ClassesPage />);
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${sessionFixture.title}` }));
    fireEvent.change(screen.getByLabelText("Session title"), {
      target: { value: "Adults Gi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save session" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: sessionFixture.sessionId, title: "Adults Gi" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: `Remove ${classFixture.name}` }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Coach left" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove class" }));
    await waitFor(() =>
      expect(mocks.removeClass).toHaveBeenCalledWith({
        classId: classFixture.classId,
        reason: "Coach left",
      }),
    );
    expect(
      await screen.findByText("Class removed. 2 upcoming sessions cancelled."),
    ).toBeInTheDocument();
  });

  it("shows every weekly rule, the age and level ranges, and hides actions from a coach", async () => {
    render(<ClassesPage />);
    expect(await screen.findByText("Mon 18:00 · Wed 18:00")).toBeInTheDocument();
    expect(screen.getByText("Ages 8–11 · White → Grey")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Remove ${classFixture.name}` })).toBeInTheDocument();
  });

  it("renders read-only for a coach", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({
      uid: "c",
      email: "c@x",
      displayName: "Coach",
      academyId,
      role: "coach",
    });
    render(<ClassesPage />);
    await screen.findByText(classFixture.name);
    expect(screen.queryByRole("button", { name: "New class" })).toBeNull();
    expect(screen.queryByRole("button", { name: `Edit ${classFixture.name}` })).toBeNull();
    expect(
      screen.queryByRole("button", { name: `Generate sessions for ${classFixture.name}` }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: `Cancel ${sessionFixture.title}` })).toBeNull();
    expect(
      screen.getByRole("button", { name: `View reservations for ${sessionFixture.title}` }),
    ).toBeInTheDocument();
  });

  it("shows a session description when present and omits it when empty", async () => {
    mocks.listSessions.mockResolvedValue([
      { ...sessionFixture, description: "Gi only. Bring a mouthguard." },
      {
        ...sessionFixture,
        sessionId: "session-adults-2",
        title: "Adult Fundamentals · Thursday",
        description: "",
      },
    ]);
    render(<ClassesPage />);
    await screen.findByText(sessionFixture.title);
    expect(screen.getByText("Gi only. Bring a mouthguard.")).toBeInTheDocument();
    const noDescriptionRow = screen.getByText("Adult Fundamentals · Thursday").closest("td")!;
    expect(noDescriptionRow.querySelector("small:last-child")).toHaveTextContent("Adults BJJ");
  });
});
