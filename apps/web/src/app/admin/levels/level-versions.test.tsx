import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const levelsApi = vi.hoisted(() => ({ getLevelCatalog: vi.fn() }));
const editorApi = vi.hoisted(() => ({
  listLevelCatalogVersions: vi.fn(),
  getLevelCatalogVersion: vi.fn(),
  createLevelCatalogDraft: vi.fn(),
  saveLevelCatalogDraft: vi.fn(),
  publishLevelCatalogDraft: vi.fn(),
  activateLevelCatalog: vi.fn(),
}));

vi.mock("../../../lib/levels-client", () => levelsApi);
vi.mock("../../../lib/level-editor-client", () => editorApi);

import { LevelVersions } from "./level-versions";

const activeCatalogue = {
  system: { systemId: "ibjjf-v3", displayName: "JIU-JITSU - IBJJF" },
  definitions: [
    { definitionKey: "white", name: "White belt", kind: "belt" },
    { definitionKey: "white-stripe-2", name: "White belt · stripe 2", kind: "stripe" },
  ],
  skills: [],
  requirements: [],
  sourceHash: "a".repeat(64),
};

const versions = [
  {
    systemId: "bpt-20260926-1",
    displayName: "BPT 2026",
    origin: "custom",
    status: "published",
    active: false,
    publishedAt: "2026-09-26T10:00:00.000Z",
  },
  {
    systemId: "ibjjf-v3",
    displayName: "JIU-JITSU - IBJJF",
    origin: "code",
    status: "published",
    active: true,
    publishedAt: null,
  },
];

afterEach(() => {
  cleanup();
  Object.values(levelsApi).forEach((mock) => mock.mockReset());
  Object.values(editorApi).forEach((mock) => mock.mockReset());
});

describe("LevelVersions", () => {
  it("explains a refused activation and keeps the active version on screen", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(activeCatalogue);
    editorApi.listLevelCatalogVersions.mockResolvedValue({ versions });
    editorApi.activateLevelCatalog.mockResolvedValue({
      kind: "missing",
      missing: [{ definitionKey: "white-stripe-2", students: 2 }],
    });

    render(<LevelVersions />);
    const row = (await screen.findByRole("cell", { name: "bpt-20260926-1" })).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Activate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm activation" }));

    expect(
      await screen.findByText(
        "2 students hold White belt · stripe 2, which this version removes. Keep that level or move those students first.",
      ),
    ).toBeDefined();
    const activeRow = screen.getByRole("cell", { name: "ibjjf-v3" }).closest("tr")!;
    expect(within(activeRow).getByText("Active")).toBeDefined();
    expect(within(row).queryByText("Active")).toBeNull();
    expect(editorApi.listLevelCatalogVersions).toHaveBeenCalledTimes(1);
  });

  it("creates a draft from the active version and opens it", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(activeCatalogue);
    editorApi.listLevelCatalogVersions.mockResolvedValue({ versions });
    editorApi.createLevelCatalogDraft.mockResolvedValue({
      systemId: "bpt-20260926-2",
      origin: "custom",
      status: "draft",
      displayName: "JIU-JITSU - IBJJF",
      levels: [],
      skills: [],
      requirements: [],
    });

    render(<LevelVersions />);
    fireEvent.click(await screen.findByRole("button", { name: "Create draft from active" }));

    expect(await screen.findByRole("heading", { name: "Draft bpt-20260926-2" })).toBeDefined();
    expect(editorApi.createLevelCatalogDraft).toHaveBeenCalledWith("ibjjf-v3");
  });
});
