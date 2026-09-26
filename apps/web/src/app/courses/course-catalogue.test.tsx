import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicCourse } from "@bpt-jersey/domain/courses";

const api = vi.hoisted(() => ({ publicCourses: vi.fn() }));

vi.mock("../../lib/courses/course-public-client", () => ({
  ...api,
  courseDate: (value: string) => `Date ${value.slice(0, 10)}`,
  courseMoney: (value: number) => `£${(value / 100).toFixed(2)}`,
}));

import { CourseCatalogue } from "./course-catalogue";

const coursesCss = readFileSync(
  resolve(process.cwd(), "apps/web/src/app/courses/courses.css"),
  "utf8",
);

const course: PublicCourse = {
  courseId: "11111111-1111-4111-8111-111111111111",
  revision: 1,
  kind: "seminar",
  title: "Guard retention workshop",
  description: "Build reliable frames, recover inside position and connect the next attack.",
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

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("course catalogue cards", () => {
  it("caps the description measure at 65ch", async () => {
    api.publicCourses.mockResolvedValue({ items: [course], cursor: null });
    render(<CourseCatalogue />);

    const description = await screen.findByText(course.description);
    expect(description).toHaveClass("course-description-preview");
    expect(coursesCss).toMatch(/\.course-description-preview\s*\{[^}]*max-width: 65ch;/u);
  });
});
