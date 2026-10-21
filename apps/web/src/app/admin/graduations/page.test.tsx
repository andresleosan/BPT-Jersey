import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraduationBoard } from "@bpt-jersey/domain/graduations";

const client = vi.hoisted(() => ({
  listGraduationBoard: vi.fn(),
  decideGraduation: vi.fn(),
  graduationErrorMessage: vi.fn(() => "Graduations are unavailable right now."),
}));
vi.mock("../../../lib/graduations-client", () => client);

import GraduationsRoute from "./page";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function board(canDecide: boolean): GraduationBoard {
  return {
    canDecide,
    generatedAt: "2026-10-21T08:00:00.000Z",
    rows: [
      {
        studentId: "student-1",
        fullName: "Synthetic Kid",
        stage: "approval",
        current: { definitionKey: "white-kids", name: "White belt kids" },
        target: { definitionKey: "white-kids-1", name: "White belt kids, 1st stripe" },
        classesDone: 4,
        minClasses: 4,
        daysDone: 42,
        minDays: 30,
        likelyNext: null,
        graduationClass: {
          sessionId: "session-1",
          occurredAt: "2026-10-20T17:00:00.000Z",
          title: "Kids 4-7",
        },
        lastNotYetNote: null,
      },
    ],
  };
}

describe("graduation board (spec D7, amended by the operator 2026-10-21)", () => {
  it("shows the mat who is waiting, read-only: the office decides", async () => {
    client.listGraduationBoard.mockResolvedValue(board(false));
    render(<GraduationsRoute />);

    expect(await screen.findByText("Synthetic Kid")).toBeInTheDocument();
    expect(screen.getByText("The office decides")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Promote" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not yet" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/who is waiting for the office's decision/u, { exact: false }),
    ).toBeInTheDocument();
  });

  it("keeps Promote and Not yet for the office", async () => {
    client.listGraduationBoard.mockResolvedValue(board(true));
    render(<GraduationsRoute />);

    expect(await screen.findByRole("button", { name: "Promote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeInTheDocument();
    expect(screen.queryByText("The office decides")).not.toBeInTheDocument();
  });

  it("does not tell anyone the decision is theirs before the board says so", () => {
    client.listGraduationBoard.mockReturnValue(new Promise(() => undefined));
    render(<GraduationsRoute />);

    expect(screen.queryByText(/your decision/u)).not.toBeInTheDocument();
  });
});
