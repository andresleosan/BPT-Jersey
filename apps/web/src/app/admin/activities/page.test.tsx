import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivitiesPage } from "./page";

describe("activities page", () => {
  it("renders activities with schedule, location, capacity, and status", () => {
    render(<ActivitiesPage />);
    expect(screen.getByRole("heading", { name: "Activities" })).toBeVisible();
    expect(screen.getByLabelText("Activity status")).toBeVisible();
    expect(screen.getByRole("table", { name: "Academy activities" })).toBeVisible();
  });
});
