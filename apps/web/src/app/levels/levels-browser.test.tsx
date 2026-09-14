import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";

import { groupBelts } from "./levels-grouping";

const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("Catalog parsing failed");

const mockProjection = {
  system: parsed.value.system,
  definitions: parsed.value.definitions,
  skills: parsed.value.skills,
  requirements: parsed.value.requirements,
  sourceHash: "test-hash-123456",
};

const groups = groupBelts(mockProjection);

const levelsApi = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
}));

vi.mock("../../lib/levels-client", () => levelsApi);

import { LevelsBrowser } from "./levels-browser";

describe("LevelsBrowser Shared Component", () => {
  afterEach(() => {
    cleanup();
    Object.values(levelsApi).forEach((mock) => mock.mockReset());
  });

  it("shows a skeleton while loading", () => {
    levelsApi.getLevelCatalog.mockReturnValue(new Promise(() => {}));

    render(<LevelsBrowser roleContext="admin" />);

    const status = screen.getByRole("status");
    const skeletons = within(status).getAllByLabelText("belt-card-skeleton");
    expect(skeletons).toHaveLength(3);
    skeletons.forEach((el) => expect(el).toHaveAttribute("aria-busy", "true"));
  });

  it("renders catalog summary and one card per belt, no card for a stripe", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="admin" />);

    expect(
      await screen.findByRole("heading", { name: mockProjection.system.displayName }),
    ).toBeDefined();

    const belts = screen.getByRole("region", { name: "Belts" });
    expect(within(belts).getAllByRole("article")).toHaveLength(27);

    const stripeWithName = mockProjection.definitions.find(
      (d) => d.kind === "stripe" && d.name.includes("Stripe"),
    );
    expect(stripeWithName).toBeDefined();
    expect(screen.queryByRole("article", { name: stripeWithName!.name })).toBeNull();
  });

  it("shows a belt's colour and lists its stripes as list items", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="admin" />);
    await screen.findByRole("heading", { name: mockProjection.system.displayName });

    const groupWithStripes = groups.find((g) => g.stripes.length > 0);
    expect(groupWithStripes).toBeDefined();
    const beltName = groupWithStripes!.belt.name;

    const card = screen.getByRole("article", { name: beltName });
    const img = within(card).getByRole("img", { name: `${beltName} belt` });
    const probe = document.createElement("div");
    probe.style.backgroundColor = groupWithStripes!.belt.visual.colors[0]!;
    expect(img.style.backgroundColor).toBe(probe.style.backgroundColor);

    const list = within(card).getByRole("list", { name: `${beltName} stripes` });
    expect(within(list).getAllByRole("listitem")).toHaveLength(groupWithStripes!.stripes.length);
  });

  it("filters by age group", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="coach" />);
    await screen.findByRole("region", { name: "Belts" });

    fireEvent.click(screen.getByRole("radio", { name: "Kids" }));
    expect(screen.getAllByRole("article")).toHaveLength(
      groups.filter((g) => g.ageGroup === "kids").length,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Adults" }));
    expect(screen.getAllByRole("article")).toHaveLength(
      groups.filter((g) => g.ageGroup === "adults").length,
    );

    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(screen.getAllByRole("article")).toHaveLength(27);
  });

  it("filters by colour, toggling off restores all belts", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="coach" />);
    await screen.findByRole("region", { name: "Belts" });

    const colourButtons = screen.getAllByRole("button", { name: /^Filter by/ });
    const firstColourButton = colourButtons[0]!;
    const firstColourGroup = groups.find(
      (g) => firstColourButton.getAttribute("aria-label") === `Filter by ${g.belt.name} colour`,
    );
    expect(firstColourGroup).toBeDefined();
    const matchingCount = groups.filter(
      (g) => g.primaryColor === firstColourGroup!.primaryColor,
    ).length;

    fireEvent.click(firstColourButton);
    expect(screen.getAllByRole("article")).toHaveLength(matchingCount);

    fireEvent.click(firstColourButton);
    expect(screen.getAllByRole("article")).toHaveLength(27);
  });

  it("filters by search query", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="coach" />);
    await screen.findByRole("region", { name: "Belts" });

    fireEvent.change(screen.getByLabelText("Search belts"), { target: { value: "black" } });

    const cards = screen.getAllByRole("article");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.textContent?.toLowerCase().includes("black"))).toBe(true);
  });

  it("renders error state and retries on failure", async () => {
    levelsApi.getLevelCatalog.mockRejectedValueOnce(
      new Error("Unable to load level catalog. Please try again."),
    );

    render(<LevelsBrowser roleContext="admin" />);

    expect(
      await screen.findByText("Unable to load level catalog. Please try again."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();

    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("heading", { name: mockProjection.system.displayName }),
    ).toBeDefined();
  });
});
