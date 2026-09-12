import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

test.describe("admin overview birthdays", () => {
  test("lists the next three birthdays and announces one that is today", async ({ page }) => {
    await installAdminFixture(page, {
      callables: {
        listUpcomingBirthdays: {
          birthdays: [
            {
              studentId: "s-1",
              displayName: "Ana Coelho",
              daysAway: 0,
              turningAge: 30,
              participantType: "adult",
              trainingCenter: "Town",
            },
            {
              studentId: "s-2",
              displayName: "Ben Kid",
              daysAway: 3,
              turningAge: 9,
              participantType: "minor",
              trainingCenter: "West",
            },
            {
              studentId: "s-3",
              displayName: "Cara Lima",
              daysAway: 40,
              turningAge: 41,
              participantType: "adult",
              trainingCenter: "Town",
            },
            {
              studentId: "s-4",
              displayName: "Dan Extra",
              daysAway: 90,
              turningAge: 22,
              participantType: "adult",
              trainingCenter: "Town",
            },
          ],
        },
      },
    });
    await page.goto("/admin?adminTestRole=owner");

    const band = page.getByRole("status", { name: "Birthday today" });
    await expect(band).toContainText("Ana Coelho turns 30 today");
    const card = page.getByRole("region", { name: "Next birthdays" });
    await expect(card.getByRole("listitem")).toHaveCount(3);
    await expect(card).not.toContainText("Dan Extra");
    await expect(card.getByRole("listitem").nth(0)).toContainText("Today");
    await expect(card.getByRole("listitem").nth(1)).toContainText(/\w{3} \d{1,2} \w{3}/);
    await expect(page.getByRole("article", { name: /Members$/ })).toHaveCount(0);

    // No year of birth may reach the screen; the band and the card are the only places that
    // could print one.
    const birthdayText = `${await band.innerText()}\n${await card.innerText()}`;
    expect(birthdayText).not.toMatch(/\b(19|20)\d\d\b/);
  });
});
