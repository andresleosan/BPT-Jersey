import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./aggregate-report-export-card", () => ({
  AggregateReportExportCard: () => <article aria-label="Authorized aggregate export" />,
}));

vi.mock("./operational-report-card", () => ({
  OperationalReportCard: () => <article aria-label="Operational reports" />,
}));

vi.mock("./progress-report-card", () => ({
  ProgressReportCard: () => <article aria-label="Progress coverage report" />,
}));

import { ReportsPage } from "./page";

describe("reports page", () => {
  it("renders connected operational, progress, and authorized export surfaces", () => {
    render(<ReportsPage />);

    expect(screen.getByRole("heading", { name: "Reports" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Operational reports" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Progress coverage report" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Authorized aggregate export" })).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Attendance overview report" }),
    ).not.toBeInTheDocument();
  });
});
