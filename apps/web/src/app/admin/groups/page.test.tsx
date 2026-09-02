import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GroupsPage } from "./page";

vi.mock("../../../lib/schedule-client", () => ({
  listClasses: vi.fn().mockResolvedValue([]),
  saveClass: vi.fn().mockResolvedValue({
    classId: "class-new",
    name: "New Group",
    programId: "adult-fundamentals",
    locationId: "town",
    recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
    instructorIds: ["coach-1"],
    capacity: 25,
    minParticipants: 4,
    active: true,
  }),
}));

describe("groups page", () => {
  it("renders groups with program, coach, capacity, and filters", () => {
    render(<GroupsPage />);
    expect(screen.getByRole("heading", { name: "Groups / Teams" })).toBeVisible();
    expect(screen.getByLabelText("Program")).toBeVisible();
    expect(screen.getByLabelText("Coach")).toBeVisible();
    expect(screen.getByRole("table", { name: "Groups and teams" })).toBeVisible();
  });

  it("does not replace an empty connected response with preview rows", async () => {
    expect(await screen.findByText("No groups match these filters.")).toBeVisible();
    expect(screen.queryByText("Little Warriors")).not.toBeInTheDocument();
  });

  it("opens create group modal on button click", () => {
    render(<GroupsPage />);
    const buttons = screen.getAllByRole("button", { name: "Create group" });
    fireEvent.click(buttons[0]!);
    expect(screen.getByRole("heading", { name: "Create New Training Group" })).toBeVisible();
    expect(screen.getByLabelText("Group Name")).toBeVisible();
    expect(screen.getByLabelText("Capacity")).toBeVisible();
  });
});
