import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "./page";

describe("attendance page", () => {
  it("shows attendance states and session filters", () => {
    render(<AttendancePage />);
    expect(screen.getByRole("heading", { name: "Attendance" })).toBeVisible();
    expect(screen.getByLabelText("Attendance state")).toBeVisible();
    expect(screen.getAllByText("Present").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("No-show").length).toBeGreaterThanOrEqual(2);
  });
});
