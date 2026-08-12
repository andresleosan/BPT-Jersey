import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportsPage } from "./page";

describe("reports page", () => {
  it("renders report categories and safe preview actions", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Attendance overview report" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Prepare attendance overview report" }),
    ).toBeVisible();
  });
});
