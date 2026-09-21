import { expect, test, type Page } from "@playwright/test";

const courseId = "11111111-1111-4111-8111-111111111111";
const course = {
  courseId,
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

async function installCourseApi(page: Page): Promise<void> {
  await page.route("**/coursePublic?*", async (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get("view");
    const body =
      view === "detail"
        ? course
        : view === "sessions"
          ? {
              items: [
                {
                  sessionId: "course-session-1",
                  courseId,
                  ordinal: 1,
                  startAt: "2026-10-03T10:00:00.000Z",
                  endAt: "2026-10-03T11:30:00.000Z",
                  status: "scheduled",
                },
              ],
              cursor: null,
            }
          : { items: [course], cursor: null };
    await route.fulfill({ status: 200, contentType: "application/json", json: body });
  });
}

async function expectResponsive(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

test.describe("@release courses and seminars", () => {
  test.beforeEach(async ({ page }) => installCourseApi(page));

  test("landing promotion is pausable and links to the programme", async ({ page }) => {
    await page.goto("/");
    const promotion = page.getByRole("complementary", { name: "Upcoming courses and seminars" });
    await expect(
      promotion.getByRole("link", { name: /Guard retention workshop/u }),
    ).toHaveAttribute("href", `/courses/view?course=${courseId}`);
    await promotion.getByRole("button", { name: "Pause" }).click();
    await expect(promotion.getByRole("button", { name: "Play" })).toBeVisible();
    await expectResponsive(page);
  });

  test("catalogue and details preserve the BPT visual hierarchy", async ({ page }) => {
    await page.goto("/courses");
    await expect(page.getByRole("heading", { name: "Courses & seminars", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: course.title })).toBeVisible();
    await expect(page.getByText("Places available")).toBeVisible();
    await page.getByRole("link", { name: "View programme" }).click();
    await expect(page).toHaveURL(new RegExp(`/courses/view[?]course=${courseId}$`, "u"));
    await expect(page.getByRole("heading", { name: "What you will learn" })).toBeVisible();
    await expect(page.getByText("Frame recovery")).toBeVisible();
    await expect(page.getByRole("link", { name: "Enrol in this course" })).toHaveAttribute(
      "href",
      `/account/courses?course=${courseId}`,
    );
    await expectResponsive(page);
  });
});
