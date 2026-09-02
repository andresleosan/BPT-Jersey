import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/schedule-client", () => ({
  listSessions: vi.fn().mockResolvedValue([]),
  getSessionOperationalView: vi.fn(),
}));
import { AttendancePage } from "./page";

describe("attendance page", () => {
  it("does not render synthetic attendance when the connected source is empty", () => {
    render(<AttendancePage />);
    expect(screen.getByRole("heading", { name: "Attendance" })).toBeVisible();
    expect(screen.getByLabelText("Attendance state")).toBeVisible();
    expect(screen.queryByText("Present")).not.toBeInTheDocument();
    expect(screen.queryByText("No-show")).not.toBeInTheDocument();
  });
});
