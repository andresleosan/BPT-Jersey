import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LevelCatalogProjection } from "@bpt-jersey/domain/levels";

const mockProjection: LevelCatalogProjection = {
  system: {
    systemId: "ibjjf-v1",
    displayName: "JIU-JITSU - IBJJF",
    schemaVersion: 1,
    precedence: {
      businessRules: "DOCX",
      hierarchyVisualsAndObservedSkills: "Regyfit",
      conflicts: "DOCX wins",
    },
    counts: { definitions: 171, belts: 27, stripes: 144 },
    skillCatalog: [],
  },
  definitions: [
    {
      definitionKey: "white-belt",
      systemId: "ibjjf-v1",
      kind: "belt",
      parentDefinitionKey: null,
      name: "WHITE BELT",
      sequence: 1,
      stripeNumber: null,
      criteria: { minAge: 4, maxAge: null, minClasses: 10, minimumTime: null },
      observedCriteria: { minAge: 4, maxAge: null, minClasses: 4, minimumTime: null },
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
  ],
  skills: [],
  requirements: [],
  sourceHash: "test-hash",
};

// The rank after the white belt: its first stripe.
const firstStripe = {
  ...mockProjection.definitions[0],
  definitionKey: "white-belt-stripe-1",
  kind: "stripe",
  parentDefinitionKey: "white-belt",
  name: "WHITE BELT 1 STRIPE",
  sequence: 2,
  stripeNumber: 1,
};

const levelsApi = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  getStudentProgressSummary: vi.fn(),
}));

const familyApi = vi.hoisted(() => ({ getFamily: vi.fn() }));

// Who trains on the account comes from listMyMemberProfiles, never from the role claim (35ba6b6).
const accountApi = vi.hoisted(() => ({
  profiles: [] as unknown[],
  getClientProfile: vi.fn(),
}));

vi.mock("../../../lib/levels-client", () => levelsApi);

vi.mock("../../../lib/family-client", () => familyApi);

vi.mock("../../../lib/profile-client", () => ({ getClientProfile: accountApi.getClientProfile }));

vi.mock("../../../lib/firebase-client", () => ({
  getFirebaseAuth: () => ({ currentUser: null }),
  getFirebaseFunctions: () => ({}),
}));

vi.mock("../../../lib/callable", () => ({
  httpsCallable: (_functions: unknown, name: string) => async () => {
    if (name !== "listMyMemberProfiles") throw new Error(`Unexpected callable ${name}`);
    return { data: { profiles: accountApi.profiles } };
  },
}));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AccountProgressPage from "./page";

/** The account holder trains: one `self` profile, read through their own client profile. */
function holderTrains() {
  accountApi.profiles = [
    { studentId: "student-1", fullName: "Student", via: "self", trainingDetailsRequired: false },
  ];
  accountApi.getClientProfile.mockResolvedValue({
    student: { studentId: "student-1", fullName: "Student", trainingCenter: "town" },
  });
}

describe("Account Progress Page", () => {
  afterEach(() => {
    cleanup();
    Object.values(levelsApi).forEach((mock) => mock.mockReset());
    familyApi.getFamily.mockReset();
    accountApi.getClientProfile.mockReset();
    accountApi.profiles = [];
  });

  // d349622 took the catalogue of every belt and the old panels off this page.
  it("renders the progress header for a client, without the catalogue of every belt", async () => {
    holderTrains();
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    levelsApi.getStudentProgressSummary.mockResolvedValue({
      state: "uninitialized",
      studentId: "student-1",
      calculatedAt: "2026-09-05T00:00:00.000Z",
    });

    render(<AccountProgressPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Progress" })).toBeDefined();
    expect(await screen.findByRole("heading", { name: "No belt recorded yet" })).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "IBJJF Progression & Belt Requirements" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeNull();
  });

  it("shows the connected own progress and never a synthetic peer cohort", async () => {
    holderTrains();
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    levelsApi.getStudentProgressSummary.mockResolvedValue({
      state: "initialized",
      studentId: "student-1",
      currentDefinition: mockProjection.definitions[0],
      targetDefinition: firstStripe,
      skillChecklist: [],
      criteria: {
        classes: { required: 20, completed: 20, met: true },
        time: { requiredDays: 60, elapsedDays: 60, met: true },
        skills: { total: 3, completed: 1, met: false },
      },
      totalAttendedClasses: 20,
      totalHours: 6,
      currentLevelStartedAt: "2026-08-01T00:00:00.000Z",
      calculatedAt: "2026-09-05T00:00:00.000Z",
    });

    render(<AccountProgressPage />);

    // d349622: the holder's belt, stripes and classes to the next rank, read by their own record.
    expect(await screen.findByText("Your belt")).toBeInTheDocument();
    expect(levelsApi.getStudentProgressSummary).toHaveBeenCalledWith("student-1");
    expect(screen.getByRole("img", { name: "WHITE BELT belt" })).toBeInTheDocument();
    expect(screen.getByText("No stripes yet")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Next stripe WHITE BELT 1 STRIPE: 20 of 20 classes",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Classes complete.")).toBeInTheDocument();
    expect(screen.queryByText(/Competitors/u)).toBeNull();
    expect(screen.queryByText("Lucas Silva")).toBeNull();
    expect(screen.queryByText("Curriculum Technique Comparison")).toBeNull();
  });

  it("shows a guardian the progress of every linked child instead of an own-progress panel", async () => {
    accountApi.profiles = [
      {
        studentId: "student-1",
        fullName: "Ana Child",
        via: "guardian",
        trainingDetailsRequired: false,
      },
      {
        studentId: "student-2",
        fullName: "Ben Child",
        via: "guardian",
        trainingDetailsRequired: false,
      },
      {
        studentId: "student-3",
        fullName: "Former Child",
        via: "guardian",
        trainingDetailsRequired: false,
      },
    ];
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    familyApi.getFamily.mockResolvedValue({
      family: { familyId: "family-1", active: true, status: "active" },
      tutor: {
        userId: "user-1",
        displayName: "Tutor",
        email: "tutor@example.test",
        phoneNumber: "+441534000000",
      },
      students: [
        {
          studentId: "student-1",
          fullName: "Ana Child",
          dateOfBirth: "2016-01-01",
          trainingCenter: "town",
          trainingTimePreferences: ["evening"],
          active: true,
          status: "active",
        },
        {
          studentId: "student-2",
          fullName: "Ben Child",
          dateOfBirth: "2018-01-01",
          trainingCenter: "west",
          trainingTimePreferences: ["evening"],
          active: true,
          status: "active",
        },
        {
          studentId: "student-3",
          fullName: "Former Child",
          dateOfBirth: "2014-01-01",
          trainingCenter: "town",
          trainingTimePreferences: ["evening"],
          active: false,
          status: "inactive",
        },
      ],
    });
    levelsApi.getStudentProgressSummary.mockImplementation(async (studentId: string) =>
      studentId === "student-1"
        ? {
            state: "initialized",
            studentId: "student-1",
            currentDefinition: mockProjection.definitions[0],
            targetDefinition: firstStripe,
            skillChecklist: [],
            criteria: {
              classes: { required: 20, completed: 20, met: true },
              time: { requiredDays: 60, elapsedDays: 60, met: true },
              skills: { total: 3, completed: 1, met: false },
            },
            totalAttendedClasses: 20,
            totalHours: 6,
            currentLevelStartedAt: "2026-08-01T00:00:00.000Z",
            calculatedAt: "2026-09-05T00:00:00.000Z",
          }
        : {
            state: "uninitialized",
            studentId: "student-2",
            calculatedAt: "2026-09-05T00:00:00.000Z",
          },
    );

    render(<AccountProgressPage />);

    // 35ba6b6: one choice per child who trains on the account, one child on screen at a time. The
    // holder does not train here, so there is no "You" and no own progress.
    const people = within(await screen.findByRole("group", { name: "Choose member" }));
    expect(people.getAllByRole("button").map((chip) => chip.textContent)).toEqual(["Ana", "Ben"]);
    expect(await screen.findByText("Ana's belt")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Next stripe WHITE BELT 1 STRIPE: 20 of 20 classes",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your belt")).toBeNull();
    expect(accountApi.getClientProfile).not.toHaveBeenCalled();

    await userEvent.setup().click(people.getByRole("button", { name: "Ben" }));
    expect(
      await screen.findByRole("heading", { name: "No belt recorded yet" }),
    ).toBeInTheDocument();

    // Inactive children are not listed, and each child is read by its own identifier.
    expect(screen.queryByText(/Former/u)).toBeNull();
    expect(levelsApi.getStudentProgressSummary).toHaveBeenCalledTimes(2);
    expect(levelsApi.getStudentProgressSummary).toHaveBeenCalledWith("student-1");
    expect(levelsApi.getStudentProgressSummary).toHaveBeenCalledWith("student-2");
  });

  it("tells a guardian with no linked child that nothing is connected yet", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<AccountProgressPage />);

    expect(
      await screen.findByRole("heading", { name: "No children linked yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The academy links each child to your account when they enrol."),
    ).toBeInTheDocument();
    expect(levelsApi.getStudentProgressSummary).not.toHaveBeenCalled();
  });

  it("explains an unopened level record without inventing data", async () => {
    holderTrains();
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    levelsApi.getStudentProgressSummary.mockResolvedValue({
      state: "uninitialized",
      studentId: "student-1",
      calculatedAt: "2026-09-05T00:00:00.000Z",
    });

    render(<AccountProgressPage />);

    expect(
      await screen.findByText(/Your coach sets the starting belt after the first classes/u),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Classes to your next rank" })).toBeNull();
  });
});
