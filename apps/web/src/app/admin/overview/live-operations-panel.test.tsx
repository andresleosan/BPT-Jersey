import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDailyOperationsDashboard } from "../../../lib/schedule-client";
import { LiveOperationsPanel } from "./live-operations-panel";

vi.mock("../../../lib/schedule-client", () => ({
  getDailyOperationsDashboard: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("live operations panel", () => {
  it("renders connected operational metrics without exposing roster identifiers", async () => {
    vi.mocked(getDailyOperationsDashboard).mockResolvedValueOnce({
      query: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T23:59:59.999Z" },
      sessions: [
        {
          session: {
            sessionId: "session-private-id",
            academyId: "academy-1",
            classId: "class-1",
            programId: "kids-bjj",
            locationId: "town",
            instructorId: "coach-1",
            title: "Kids BJJ",
            startAt: "2026-09-01T16:00:00Z",
            endAt: "2026-09-01T17:00:00Z",
            capacity: 20,
            minParticipants: 4,
            status: "scheduled",
            cancellationReason: null,
            isSeminar: false,
            schemaVersion: "1",
            createdAt: "2026-08-01T00:00:00Z",
            createdBy: "admin-1",
            updatedAt: "2026-08-01T00:00:00Z",
            updatedBy: "admin-1",
          },
          summary: {
            capacity: 20,
            minParticipants: 4,
            quorumMet: true,
            totalBookings: 5,
            totalCheckedIn: 3,
            totalCheckedOut: 1,
            totalNoShows: 0,
            totalPendingArrival: 2,
          },
          refreshedAt: "2026-09-01T16:30:00Z",
        },
      ],
      refreshedAt: "2026-09-01T16:30:00Z",
    });

    render(<LiveOperationsPanel />);

    expect(
      await screen.findByRole("table", { name: "Connected sessions for today" }),
    ).toBeVisible();
    expect(screen.getByRole("row", { name: /Kids BJJ/ })).toHaveTextContent("5 / 20");
    expect(screen.getByRole("row", { name: /Kids BJJ/ })).toHaveTextContent("3");
    expect(screen.queryByText("session-private-id")).not.toBeInTheDocument();
  });

  it("shows a safe unavailable state when the connected source fails", async () => {
    vi.mocked(getDailyOperationsDashboard).mockRejectedValueOnce(new Error("unavailable"));

    render(<LiveOperationsPanel />);

    expect(
      await screen.findByText(
        "Connected operational data is unavailable. Preview data remains visible above.",
      ),
    ).toBeVisible();
  });
});
