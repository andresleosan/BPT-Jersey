import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicCourse } from "@bpt-jersey/domain/courses";

const api = vi.hoisted(() => ({ publicCourses: vi.fn() }));

vi.mock("../../lib/courses/course-public-client", () => ({
  ...api,
  courseDate: (value: string) => `Date ${value.slice(0, 10)}`,
  courseMoney: (value: number) => `£${(value / 100).toFixed(2)}`,
}));

import { CoursePromotionBar } from "./course-promotion-bar";

const course: PublicCourse = {
  courseId: "11111111-1111-4111-8111-111111111111",
  revision: 1,
  kind: "seminar",
  title: "Guard retention workshop",
  description: "Build reliable frames.",
  techniques: [],
  instructorName: "BPT coaching team",
  locationName: "Town",
  minAge: 16,
  maxAge: null,
  priceMinor: 4500,
  currency: "GBP",
  sessionCount: 3,
  nextSessionAt: "2026-10-03T10:00:00.000Z",
  cancellationTerms: "Ask the office.",
  timezone: "Europe/Jersey",
  status: "published",
  availability: "available",
};

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  api.publicCourses.mockResolvedValue({ items: [course], cursor: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("course promotion band", () => {
  it("keeps a visible Pause control with aria-pressed and an inert duplicate track", async () => {
    stubReducedMotion(false);
    const user = userEvent.setup();
    const { container } = render(<CoursePromotionBar />);

    const pause = await screen.findByRole("button", { name: "Pause" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelectorAll('.course-promo-group[aria-hidden="true"]')).toHaveLength(1);

    await user.click(pause);
    expect(screen.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders a static list without the duplicate track under reduced motion", async () => {
    stubReducedMotion(true);
    const { container } = render(<CoursePromotionBar />);

    expect(await screen.findByRole("link", { name: /Guard retention workshop/u })).toBeVisible();
    expect(container.querySelectorAll(".course-promo-group")).toHaveLength(1);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Play/u })).toBeNull();
  });
});
