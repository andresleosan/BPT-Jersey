import { cleanup, render, screen, within } from "@testing-library/react";
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

const levelsApi = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  getStudentProgressSummary: vi.fn(),
}));

vi.mock("../../../lib/levels-client", () => levelsApi);

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useClientSession: () => ({
    session: { uid: "user-1", email: "client@example.test", displayName: "Student" },
    signOut: vi.fn(),
  }),
}));

import AccountProgressPage from "./page";

describe("Account Progress Page", () => {
  afterEach(() => {
    cleanup();
    Object.values(levelsApi).forEach((mock) => mock.mockReset());
  });

  it("renders progression header and levels browser for client", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    levelsApi.getStudentProgressSummary.mockResolvedValue({
      state: "uninitialized",
      studentId: "student-1",
      calculatedAt: "2026-09-05T00:00:00.000Z",
    });

    render(<AccountProgressPage />);

    expect(
      screen.getByRole("heading", { name: "IBJJF Progression & Belt Requirements" }),
    ).toBeDefined();
    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
  });

  it("shows the connected own progress and never a synthetic peer cohort", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    levelsApi.getStudentProgressSummary.mockResolvedValue({
      state: "initialized",
      studentId: "student-1",
      currentDefinition: mockProjection.definitions[0],
      targetDefinition: { ...mockProjection.definitions[0], name: "WHITE BELT 1 STRIPE" },
      skillChecklist: [],
      criteria: {
        classes: { required: 10, completed: 4, met: false },
        time: { requiredDays: 90, elapsedDays: 12, met: false },
        skills: { total: 3, completed: 1, met: false },
      },
      totalAttendedClasses: 4,
      totalHours: 6,
      currentLevelStartedAt: "2026-08-01T00:00:00.000Z",
      calculatedAt: "2026-09-05T00:00:00.000Z",
    });

    render(<AccountProgressPage />);

    expect(await screen.findByRole("heading", { name: "Your progress" })).toBeInTheDocument();
    expect(levelsApi.getStudentProgressSummary).toHaveBeenCalledWith();
    const stats = within(await screen.findByTestId("own-progress-stats"));
    expect(stats.getByText("WHITE BELT")).toBeInTheDocument();
    expect(stats.getByText("WHITE BELT 1 STRIPE")).toBeInTheDocument();
    expect(stats.getByText("4 / 10 towards the next level")).toBeInTheDocument();
    expect(stats.getByText("6 h")).toBeInTheDocument();
    expect(stats.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.queryByText(/Competitors/u)).toBeNull();
    expect(screen.queryByText("Lucas Silva")).toBeNull();
    expect(screen.queryByText("Curriculum Technique Comparison")).toBeNull();
  });

  it("explains an unopened level record without inventing data", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    levelsApi.getStudentProgressSummary.mockResolvedValue({
      state: "uninitialized",
      studentId: "student-1",
      calculatedAt: "2026-09-05T00:00:00.000Z",
    });

    render(<AccountProgressPage />);

    expect(
      await screen.findByText(/Your level record has not been opened yet/u),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("own-progress-stats")).toBeNull();
  });
});
