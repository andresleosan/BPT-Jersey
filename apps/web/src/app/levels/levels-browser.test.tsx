import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";

const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("Catalog parsing failed");

const mockProjection = {
  system: parsed.value.system,
  definitions: parsed.value.definitions,
  skills: parsed.value.skills,
  requirements: parsed.value.requirements,
  sourceHash: "test-hash-123456",
};

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

  it("renders catalog summary and 171 definitions", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="admin" />);

    expect(screen.getByText("Loading IBJJF Level Catalog...")).toBeDefined();

    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
    expect(screen.getByRole("button", { name: /All \(171\)/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Belts \(27\)/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Stripes \(144\)/ })).toBeDefined();
  });

  it("filters definitions by search query", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="coach" />);
    await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" });

    const searchInput = screen.getByPlaceholderText(
      "Search levels (e.g. White Belt, 1st Stripe)...",
    );
    fireEvent.change(searchInput, { target: { value: "black" } });

    const cards = screen.getAllByRole("article");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.textContent?.toLowerCase().includes("black"))).toBe(true);
  });

  it("filters definitions by kind button", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);

    render(<LevelsBrowser roleContext="client" />);
    await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" });

    const beltsFilterBtn = screen.getByRole("button", { name: /Belts \(27\)/i });
    fireEvent.click(beltsFilterBtn);

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(27);
  });

  it("renders error state and retries on failure", async () => {
    levelsApi.getLevelCatalog.mockRejectedValueOnce(
      new Error("Unable to load level catalog. Please try again."),
    );

    render(<LevelsBrowser roleContext="admin" />);

    expect(
      await screen.findByText("Unable to load level catalog. Please try again."),
    ).toBeDefined();

    levelsApi.getLevelCatalog.mockResolvedValue(mockProjection);
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);

    expect(await screen.findByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeDefined();
  });
});
