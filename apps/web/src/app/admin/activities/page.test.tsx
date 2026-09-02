import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivitiesPage } from "./page";

vi.mock("../../../lib/schedule-client", () => ({
  listSessions: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn().mockResolvedValue({
    sessionId: "sess-new",
    title: "New Activity",
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    startAt: "2026-09-01T18:00:00Z",
    endAt: "2026-09-01T19:00:00Z",
    capacity: 25,
    status: "scheduled",
  }),
}));

describe("activities page", () => {
  it("renders activities with schedule, location, capacity, and status", () => {
    render(<ActivitiesPage />);
    expect(screen.getByRole("heading", { name: "Activities" })).toBeVisible();
    expect(screen.getByLabelText("Activity status")).toBeVisible();
    expect(screen.getByRole("table", { name: "Academy activities" })).toBeVisible();
  });

  it("does not replace an empty connected response with preview rows", async () => {
    expect(await screen.findByText("No activities match these filters.")).toBeVisible();
    expect(screen.queryByText("Kids Gi Fundamentals")).not.toBeInTheDocument();
  });

  it("opens create activity modal on button click", () => {
    render(<ActivitiesPage />);
    const buttons = screen.getAllByRole("button", { name: "Create activity" });
    fireEvent.click(buttons[0]!);
    expect(screen.getByRole("heading", { name: "Schedule New Activity / Session" })).toBeVisible();
    expect(screen.getByLabelText("Activity Title")).toBeVisible();
    expect(screen.getByLabelText("Capacity")).toBeVisible();
  });
});
