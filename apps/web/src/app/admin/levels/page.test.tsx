import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const editorApi = vi.hoisted(() => ({
  listLevelCatalogVersions: vi.fn(),
  getLevelCatalogVersion: vi.fn(),
  createLevelCatalogDraft: vi.fn(),
  saveLevelCatalogDraft: vi.fn(),
  publishLevelCatalogDraft: vi.fn(),
  activateLevelCatalog: vi.fn(),
}));
const gate = vi.hoisted(() => ({ useAdminOrStaffSession: vi.fn() }));
const editorModule = vi.hoisted(() => ({ loads: 0 }));

vi.mock("../../../lib/levels-client", () => levelsApi);
vi.mock("../../../lib/level-editor-client", () => editorApi);
vi.mock("../admin-gate", () => gate);
vi.mock("./level-versions", async (importOriginal) => {
  editorModule.loads += 1;
  return importOriginal();
});

import AdminLevelsPage from "./page";

describe("Admin Levels Page", () => {
  afterEach(() => {
    cleanup();
    Object.values(levelsApi).forEach((mock) => mock.mockReset());
    Object.values(editorApi).forEach((mock) => mock.mockReset());
    gate.useAdminOrStaffSession.mockReset();
  });

  // Runs first: the module counter is per file, so later tests may already have loaded it.
  it("loads the version editor only when the office opens Versions", async () => {
    gate.useAdminOrStaffSession.mockReturnValue({ role: "owner" });
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    editorApi.listLevelCatalogVersions.mockResolvedValue({ versions: [] });

    render(<AdminLevelsPage />);
    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
    expect(editorModule.loads).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));
    // The first dynamic import compiles the editor, which can take longer than the default wait.
    expect(
      await screen.findByRole("heading", { name: "Catalogue versions" }, { timeout: 4_000 }),
    ).toBeDefined();
    expect(editorModule.loads).toBe(1);
  });

  it("renders admin header and levels browser", async () => {
    gate.useAdminOrStaffSession.mockReturnValue({ role: "owner" });
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<AdminLevelsPage />);

    expect(screen.getByRole("heading", { name: "IBJJF Levels & Belts" })).toBeDefined();
    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Belts" })).toBeDefined();
  });

  it("shows the owner a Versions tab with the list and Create draft from active", async () => {
    gate.useAdminOrStaffSession.mockReturnValue({ role: "owner" });
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    editorApi.listLevelCatalogVersions.mockResolvedValue({
      versions: [
        {
          systemId: "ibjjf-v3",
          displayName: "JIU-JITSU - IBJJF",
          origin: "code",
          status: "published",
          active: true,
          publishedAt: null,
        },
      ],
    });

    render(<AdminLevelsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

    expect(await screen.findByRole("cell", { name: "ibjjf-v3" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Create draft from active" })).toBeDefined();
  });

  it("shows a coach only the active catalogue and no editing controls", async () => {
    gate.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<AdminLevelsPage />);

    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
    expect(screen.queryByRole("tab", { name: "Versions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create draft from active" })).toBeNull();
    expect(screen.queryByRole("button", { name: /save draft|publish|activate/iu })).toBeNull();
    expect(editorApi.listLevelCatalogVersions).not.toHaveBeenCalled();
  });
});
