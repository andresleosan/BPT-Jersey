import { cleanup, render, screen } from "@testing-library/react";
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

    render(<AccountProgressPage />);

    expect(
      screen.getByRole("heading", { name: "IBJJF Progression & Belt Requirements" }),
    ).toBeDefined();
    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
  });

  it("renders peer progression widget with peers above and below", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<AccountProgressPage />);

    // Peer comparison section
    expect(
      screen.getByRole("heading", { name: /Peer Progression & Competitors/ }),
    ).toBeInTheDocument();

    // Verify peers are displayed
    expect(screen.getByText("Lucas Silva")).toBeInTheDocument();
    expect(screen.getByText("Mateo Rossi")).toBeInTheDocument();
    expect(screen.getByText("Chloe Martin")).toBeInTheDocument();
    expect(screen.getByText("David De La Haye")).toBeInTheDocument();

    // Verify technique comparison is present
    expect(
      screen.getByRole("heading", { name: "Curriculum Technique Comparison" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Closed Guard Fundamentals")).toBeInTheDocument();
  });
});
