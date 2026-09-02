import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/reports-client", () => ({
  getOperationalReport: vi.fn().mockRejectedValue(new Error("unavailable")),
}));
vi.mock("../../../lib/schedule-client", () => ({
  getDailyOperationsDashboard: vi.fn().mockRejectedValue(new Error("unavailable")),
}));

import { OverviewPage } from "./page";

describe("admin overview", () => {
  it("does not render synthetic metrics when connected sources are unavailable", async () => {
    render(<OverviewPage />);

    expect(screen.getByRole("heading", { name: "Today's academy view" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load today's connected dashboard",
    );
    expect(screen.queryByText("126")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Today's classes" })).not.toBeInTheDocument();
  });
});
