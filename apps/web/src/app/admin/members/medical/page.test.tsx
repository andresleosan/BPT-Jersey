import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const health = vi.hoisted(() => ({
  getHealthAdminProfile: vi.fn(),
  saveHealthProfile: vi.fn(),
  listHealthReferences: vi.fn(),
}));
vi.mock("../../../../lib/health-client", () => health);

import MedicalConditionsRoute from "./page";

const rows = [
  { studentId: "student-2", displayName: "Ben Kid", staffReferenceLabel: "KNEE-BRACE" },
  { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" },
];

beforeEach(() => {
  health.listHealthReferences.mockResolvedValue(rows);
  health.getHealthAdminProfile.mockResolvedValue({
    staffReferenceLabel: "ASTHMA-INHALER",
    conditionSummary: "Inhaler in bag.",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("medical conditions route", () => {
  it("keeps the lookup and label form", () => {
    render(<MedicalConditionsRoute />);
    expect(screen.getByRole("heading", { name: "Medical conditions" })).toBeVisible();
    expect(screen.getByLabelText("Student ID")).toBeVisible();
    expect(screen.getByLabelText(/Staff reference label/)).toBeVisible();
    expect(screen.getByLabelText(/Condition summary/)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows every reference label on demand, sorted by name, and fills the lookup from a row", async () => {
    render(<MedicalConditionsRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Show all references" }));

    const table = await screen.findByRole("table", { name: "Staff reference labels" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent("Ana Coelho");
    expect(bodyRows[0]).toHaveTextContent("ASTHMA-INHALER");
    expect(bodyRows[1]).toHaveTextContent("Ben Kid");
    expect(table).not.toHaveTextContent("Inhaler in bag.");
    expect(screen.getByRole("button", { name: "Hide references" })).toBeVisible();

    await userEvent.click(
      within(bodyRows[0] as HTMLElement).getByRole("button", { name: "Use student-1" }),
    );
    expect(screen.getByLabelText("Student ID")).toHaveValue("student-1");
    expect(health.getHealthAdminProfile).toHaveBeenCalledWith("student-1");
  });

  it("names the failure and the empty case", async () => {
    health.listHealthReferences.mockRejectedValueOnce(
      new Error("Unable to load the reference labels. Please try again."),
    );
    render(<MedicalConditionsRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Show all references" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load the reference labels. Please try again.",
    );

    health.listHealthReferences.mockResolvedValueOnce([]);
    await userEvent.click(screen.getByRole("button", { name: "Show all references" }));
    expect(await screen.findByText("No reference labels recorded yet.")).toBeVisible();
  });
});
