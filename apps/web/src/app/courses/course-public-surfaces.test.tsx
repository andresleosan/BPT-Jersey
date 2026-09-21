import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicCourse } from "@bpt-jersey/domain/courses";

const api = vi.hoisted(() => ({
  publicCourses: vi.fn(),
  publicCourse: vi.fn(),
  publicCourseSlots: vi.fn(),
}));

vi.mock("../../lib/courses/course-public-client", () => ({
  ...api,
  courseDate: (value: string) => `Date ${value.slice(0, 10)}`,
  courseMoney: (value: number) => `£${(value / 100).toFixed(2)}`,
}));

import { CourseCatalogue } from "./course-catalogue";
import { CoursePromotionBar } from "./course-promotion-bar";
import { CourseDetail } from "./view/course-detail";

const course: PublicCourse = {
  courseId: "11111111-1111-4111-8111-111111111111",
  revision: 1,
  kind: "seminar",
  title: "Guard retention workshop",
  description: "Build reliable frames, recover inside position and connect the next attack.",
  techniques: ["Frame recovery", "Hip escape", "Inside position"],
  instructorName: "BPT coaching team",
  locationName: "Town",
  minAge: 16,
  maxAge: null,
  priceMinor: 4500,
  currency: "GBP",
  sessionCount: 3,
  nextSessionAt: "2026-10-03T10:00:00.000Z",
  cancellationTerms: "Ask the office before the first session if you need to cancel.",
  timezone: "Europe/Jersey",
  status: "published",
  availability: "available",
};

beforeEach(() => {
  api.publicCourses.mockResolvedValue({ items: [course], cursor: null });
  api.publicCourse.mockResolvedValue(course);
  api.publicCourseSlots.mockResolvedValue({
    items: [
      {
        sessionId: "course-session-1",
        courseId: course.courseId,
        ordinal: 1,
        startAt: "2026-10-03T10:00:00.000Z",
        endAt: "2026-10-03T11:30:00.000Z",
        status: "scheduled",
      },
    ],
    cursor: null,
  });
  window.history.replaceState({}, "", `/courses/view?course=${course.courseId}`);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("public course surfaces", () => {
  it("renders the catalogue as an accessible ruled programme list", async () => {
    render(<CourseCatalogue />);

    expect(await screen.findByRole("heading", { name: "Guard retention workshop" })).toBeVisible();
    expect(screen.getByText("Places available")).toBeVisible();
    expect(screen.getByText("Ages 16+")).toBeVisible();
    expect(screen.getByRole("link", { name: "View programme" })).toHaveAttribute(
      "href",
      `/courses/view?course=${course.courseId}`,
    );
    expect(document.body.textContent).not.toMatch(/[—–]/u);
  });

  it("renders programme content, dates and the enrolment action", async () => {
    render(<CourseDetail />);

    expect(await screen.findByRole("heading", { name: "Guard retention workshop" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "What you will learn" })).toBeVisible();
    expect(screen.getByText("Frame recovery")).toBeVisible();
    expect(screen.getByText("Session 1")).toBeVisible();
    expect(screen.getByRole("link", { name: "Enrol in this course" })).toHaveAttribute(
      "href",
      `/account/courses?course=${course.courseId}`,
    );
    expect(api.publicCourse).toHaveBeenCalledWith(course.courseId, expect.any(AbortSignal));
  });

  it("keeps the landing promotion pausable and links to real programme details", async () => {
    const user = userEvent.setup();
    render(<CoursePromotionBar />);

    const pause = await screen.findByRole("button", { name: "Pause" });
    expect(screen.getByRole("link", { name: /Guard retention workshop/u })).toHaveAttribute(
      "href",
      `/courses/view?course=${course.courseId}`,
    );
    await user.click(pause);
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeVisible());
  });
});
