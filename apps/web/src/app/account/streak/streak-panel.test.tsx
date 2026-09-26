import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberStreak } from "../../../lib/streak-client";

const streak: MemberStreak = {
  streakCount: 3,
  seasonStart: "2026-09-01",
  attendancesSinceSeasonStart: 9,
  hoursSinceSeasonStart: 12,
  goal: {
    label: "Next goal",
    target: 10,
    progress: 9,
    remaining: 1,
    almost: true,
    complete: false,
  },
  reward: {
    label: "Next reward",
    target: 25,
    progress: 9,
    remaining: 16,
    almost: false,
    complete: false,
  },
};

vi.mock("../../../lib/streak-client", () => ({
  getMemberStreak: vi.fn(async () => streak),
  getPromotionOutlook: vi.fn(async () => null),
}));
vi.mock("./streak-flame", () => ({ StreakFlame: () => null }));

import { StreakPanel } from "./streak-panel";

describe("StreakPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("names the one class left to the goal and the season hours in plain words", async () => {
    render(<StreakPanel studentId="student-1" />);

    expect(await screen.findByText("One more class to reach your next goal.")).toBeVisible();
    expect(screen.queryByText(/Just x1/u)).not.toBeInTheDocument();
    expect(screen.getByText("12 hours trained this season")).toBeVisible();
  });
});
