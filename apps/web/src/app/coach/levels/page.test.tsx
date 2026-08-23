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

import CoachLevelsPage from "./page";

describe("Coach Levels Page", () => {
  afterEach(() => {
    cleanup();
    Object.values(levelsApi).forEach((mock) => mock.mockReset());
  });

  it("renders levels browser for coaches", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<CoachLevelsPage />);

    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
    expect(screen.getByRole("button", { name: /All \(1\)/ })).toBeDefined();
  });
});
