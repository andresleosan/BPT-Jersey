import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const familyApi = vi.hoisted(() => ({
  createFamily: vi.fn(),
  getFamily: vi.fn(),
  updateFamily: vi.fn(),
}));

vi.mock("../../../lib/family-client", () => familyApi);

import FamilyAdminPage from "./page";

const staffProjection = {
  family: {
    familyId: "family-1",
    academyId: "academy-1",
    primaryContactUserId: "user-1",
    billingContactUserId: "user-1",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-08-19T10:00:00.000Z",
    updatedBy: "admin-1",
  },
  students: [
    {
      studentId: "student-1",
      academyId: "academy-1",
      familyId: "family-1",
      fullName: "Synthetic Minor One",
      dateOfBirth: "2015-08-19",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      participantType: "minor",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "admin-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      updatedBy: "admin-1",
    },
    {
      studentId: "student-2",
      academyId: "academy-1",
      familyId: "family-1",
      fullName: "Synthetic Minor Two",
      dateOfBirth: "2017-04-12",
      trainingCenter: "West",
      trainingTimePreferences: ["evening"],
      participantType: "minor",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "admin-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      updatedBy: "admin-1",
    },
  ],
  relationships: [],
};

describe("admin family page", () => {
  afterEach(() => {
    cleanup();
    familyApi.createFamily.mockReset();
    familyApi.getFamily.mockReset();
    familyApi.updateFamily.mockReset();
  });

  it("renders a labeled tutor and one minor row, with add/remove controls", async () => {
    render(<FamilyAdminPage />);

    expect(screen.getByRole("heading", { name: "Family management" })).toBeVisible();
    expect(screen.getByLabelText("Tutor user ID")).toBeVisible();
    expect(screen.getAllByLabelText("Minor full name")).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Add another minor" }));
    expect(screen.getAllByLabelText("Minor full name")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Remove minor" })).toHaveLength(2);
  });

  it("validates required child fields and announces the error", async () => {
    const user = userEvent.setup();
    render(<FamilyAdminPage />);

    await user.click(screen.getByRole("button", { name: "Create family" }));

    expect(screen.getByText("Tutor user ID is required.")).toBeVisible();
    expect(screen.getByText("Minor full name is required.")).toBeVisible();
  });

  it("submits a family with two minors and never renders internal fields", async () => {
    const user = userEvent.setup();
    familyApi.createFamily.mockResolvedValue(staffProjection);
    render(<FamilyAdminPage />);

    await user.type(screen.getByLabelText("Tutor user ID"), "user-1");
    const names = screen.getAllByLabelText("Minor full name");
    await user.type(names[0]!, "Synthetic Minor One");
    await user.type(screen.getAllByLabelText("Date of birth")[0]!, "2015-08-19");
    await user.click(screen.getByRole("checkbox", { name: "Afternoon" }));
    await user.click(screen.getByRole("button", { name: "Add another minor" }));
    await user.type(screen.getAllByLabelText("Minor full name")[1]!, "Synthetic Minor Two");
    await user.type(screen.getAllByLabelText("Date of birth")[1]!, "2017-04-12");
    await user.click(screen.getAllByRole("checkbox", { name: "Evening" })[1]!);
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: "Training center" })[1]!,
      "West",
    );
    await user.click(screen.getByRole("button", { name: "Create family" }));

    await waitFor(() => expect(familyApi.createFamily).toHaveBeenCalledOnce());
    expect(familyApi.createFamily).toHaveBeenCalledWith({
      tutorUserId: "user-1",
      students: [
        expect.objectContaining({ fullName: "Synthetic Minor One", dateOfBirth: "2015-08-19" }),
        expect.objectContaining({
          fullName: "Synthetic Minor Two",
          dateOfBirth: "2017-04-12",
          trainingCenter: "West",
        }),
      ],
    });
    expect(screen.getByRole("status")).toHaveTextContent("Family created.");
    expect(screen.getAllByText("Synthetic Minor One")).toHaveLength(2);
    expect(screen.getAllByText("Synthetic Minor Two")).toHaveLength(2);
    expect(screen.queryByText(/academy-1|family-1|student-1|createdBy/i)).not.toBeInTheDocument();
  });

  it("shows only a generic error when the callable fails", async () => {
    const user = userEvent.setup();
    familyApi.createFamily.mockRejectedValue(new Error("private callable details"));
    render(<FamilyAdminPage />);
    await user.type(screen.getByLabelText("Tutor user ID"), "user-1");
    await user.type(screen.getByLabelText("Minor full name"), "Synthetic Minor");
    await user.type(screen.getByLabelText("Date of birth"), "2015-08-19");
    await user.click(screen.getByRole("checkbox", { name: "Afternoon" }));
    await user.click(screen.getByRole("button", { name: "Create family" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to create the family");
    expect(screen.queryByText("private callable details")).not.toBeInTheDocument();
  });
});
