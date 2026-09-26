import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const editorApi = vi.hoisted(() => ({
  listLevelCatalogVersions: vi.fn(),
  getLevelCatalogVersion: vi.fn(),
  createLevelCatalogDraft: vi.fn(),
  saveLevelCatalogDraft: vi.fn(),
  publishLevelCatalogDraft: vi.fn(),
  activateLevelCatalog: vi.fn(),
}));
vi.mock("../../../lib/level-editor-client", () => editorApi);

import { LevelDraftEditor } from "./level-draft-editor";

const draft = {
  systemId: "bpt-20260926-1",
  origin: "custom" as const,
  status: "draft" as const,
  displayName: "BPT 2026",
  levels: [
    {
      definitionKey: "white",
      kind: "belt" as const,
      parentDefinitionKey: null,
      name: "White belt",
      sequence: 1,
      stripeNumber: null,
      criteria: { minAge: 4, maxAge: null, minClasses: 20, minimumTime: null },
      visual: { colors: ["#FFFFFF"], stripeColor: "#111111", stripeCount: 1 },
    },
    {
      definitionKey: "white-stripe-1",
      kind: "stripe" as const,
      parentDefinitionKey: "white",
      name: "White belt · stripe 1",
      sequence: 2,
      stripeNumber: 1,
      criteria: { minAge: 4, maxAge: null, minClasses: 20, minimumTime: null },
      visual: { colors: ["#FFFFFF"], stripeColor: "#111111", stripeCount: 0 },
    },
    {
      definitionKey: "blue",
      kind: "belt" as const,
      parentDefinitionKey: null,
      name: "Blue belt",
      sequence: 3,
      stripeNumber: null,
      criteria: { minAge: 16, maxAge: null, minClasses: 100, minimumTime: null },
      visual: { colors: ["#1F4E9A"], stripeColor: "#FFFFFF", stripeCount: 0 },
    },
  ],
  skills: [{ key: "shrimp", displayLabel: "Shrimp", minimumRating: 3, sequence: 1 }],
  requirements: [{ definitionKey: "white", skillKey: "shrimp", minimumRating: 3 }],
};

afterEach(() => {
  cleanup();
  Object.values(editorApi).forEach((mock) => mock.mockReset());
});

function renderEditor() {
  return render(<LevelDraftEditor draft={draft} onClose={() => {}} onSaved={() => {}} />);
}

describe("LevelDraftEditor", () => {
  it("edits one article per belt, never per stripe", () => {
    renderEditor();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("refuses a short hex, disables Save draft and keeps the preview colour", () => {
    const { container } = renderEditor();
    const [hex] = screen.getAllByLabelText("Belt colour 1 hex");
    fireEvent.change(hex!, { target: { value: "#12" } });

    expect(screen.getByText("Enter a colour like #1A2B3C")).toBeDefined();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const bar = container.querySelector(".belt-bar") as HTMLElement;
    expect(bar.getAttribute("style")).not.toContain("#12;");
    expect(bar.style.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("applies a valid hex to the preview and saves the draft", async () => {
    editorApi.saveLevelCatalogDraft.mockResolvedValue(draft);
    const { container } = renderEditor();
    const [hex] = screen.getAllByLabelText("Belt colour 1 hex");
    fireEvent.change(hex!, { target: { value: "#FAFAFA" } });
    expect((container.querySelector(".belt-bar") as HTMLElement).style.backgroundColor).toBe(
      "rgb(250, 250, 250)",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft saved.");
    const sent = editorApi.saveLevelCatalogDraft.mock.calls[0]![0];
    expect(sent.levels[0].visual.colors).toEqual(["#FAFAFA"]);
    expect(sent.levels).toHaveLength(3);
    expect(sent.requirements).toEqual(draft.requirements);
  });

  it("paints belt colours only on belt-bar, belt-tip and levels-colour elements", () => {
    const { container } = renderEditor();
    const painted = [
      ...container.querySelectorAll<HTMLElement>('[style*="background"], [style*="--"]'),
    ];
    expect(painted.length).toBeGreaterThan(0);
    for (const element of painted) {
      expect(
        ["belt-bar", "belt-tip", "levels-colour"].some((name) => element.classList.contains(name)),
      ).toBe(true);
    }
  });
});
