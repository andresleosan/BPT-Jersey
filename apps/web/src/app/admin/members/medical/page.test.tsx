import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const health = vi.hoisted(() => ({
  getHealthAdminProfile: vi.fn(),
  listHealthReferences: vi.fn(),
  saveHealthReferenceLabel: vi.fn(),
}));
vi.mock("../../../../lib/health-client", () => health);

const gate = vi.hoisted(() => ({
  role: "owner" as "owner" | "administrator" | "headCoach" | "coach",
}));
vi.mock("../../admin-gate", () => ({
  useAdminOrStaffSession: () => ({
    uid: "u-1",
    email: "u@example.test",
    displayName: "Synthetic",
    academyId: "academy-1",
    role: gate.role,
  }),
}));

import MedicalConditionsRoute from "./page";

const rows = [
  { studentId: "student-2", displayName: "Ben Kid", staffReferenceLabel: "KNEE-BRACE" },
  { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" },
];

beforeEach(() => {
  gate.role = "owner";
  health.saveHealthReferenceLabel.mockResolvedValue({
    studentId: "student-1",
    staffReferenceLabel: "ASTHMA-INHALER",
  });
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
  it("keeps the office lookup without editable medical fields", () => {
    render(<MedicalConditionsRoute />);
    expect(screen.getByRole("heading", { name: "Medical conditions" })).toBeVisible();
    expect(screen.getByLabelText("Student ID")).toBeVisible();
    expect(screen.queryByLabelText(/Staff reference label/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Condition summary/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows historical medical text to office without editable condition controls", async () => {
    render(<MedicalConditionsRoute />);
    await userEvent.type(screen.getByLabelText("Student ID"), "student-1");
    await userEvent.click(screen.getByRole("button", { name: "Look up Medical Record" }));

    expect(await screen.findByText("Inhaler in bag.")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /Condition summary/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Save Staff Reference Label/i }),
    ).not.toBeInTheDocument();
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

  it("gives a coach the label form alone and never reads the medical record", async () => {
    gate.role = "coach";
    render(<MedicalConditionsRoute />);
    expect(screen.queryByLabelText(/Condition summary/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Look up Medical Record" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all references" }));
    const table = await screen.findByRole("table", { name: "Staff reference labels" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    await userEvent.click(
      within(bodyRows[0] as HTMLElement).getByRole("button", { name: "Use student-1" }),
    );
    expect(health.getHealthAdminProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Student ID")).toHaveValue("student-1");
    expect(screen.getByRole("textbox", { name: /Staff reference label/ })).toHaveValue(
      "ASTHMA-INHALER",
    );

    await userEvent.click(screen.getByRole("button", { name: "Save reference label" }));
    expect(health.saveHealthReferenceLabel).toHaveBeenCalledWith("student-1", "ASTHMA-INHALER");
    expect(await screen.findByText("Reference label saved for student student-1.")).toBeVisible();
  });
});
