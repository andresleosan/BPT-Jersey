import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivitiesPage } from "./page";

const { listSessionsMock } = vi.hoisted(() => ({
  listSessionsMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../lib/schedule-client", () => ({
  listSessions: listSessionsMock,
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
  afterEach(() => {
    cleanup();
    listSessionsMock.mockClear();
  });
  it("renders activities with schedule, location, capacity, and status", () => {
    render(<ActivitiesPage />);
    expect(screen.getByRole("heading", { name: "Activities" })).toBeVisible();
    expect(screen.getByLabelText("Activity status")).toBeVisible();
    expect(screen.getByRole("table", { name: "Academy activities" })).toBeVisible();
  });

  it("requests a range supported by the sessions callable", async () => {
    render(<ActivitiesPage />);

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());
    const request = listSessionsMock.mock.calls[0]?.[0] as { from: string; to: string };
    expect(new Date(request.to).getTime() - new Date(request.from).getTime()).toBeLessThanOrEqual(
      90 * 24 * 60 * 60 * 1000,
    );
  });

  it("does not replace an empty connected response with preview rows", async () => {
    render(<ActivitiesPage />);
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
