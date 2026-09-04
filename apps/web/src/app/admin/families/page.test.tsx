import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const familyApi = vi.hoisted(() => ({
  createFamily: vi.fn(),
  getFamily: vi.fn(),
  updateFamily: vi.fn(),
}));
const achievementApi = vi.hoisted(() => ({
  getFamilyAchievementSummary: vi.fn(),
}));

vi.mock("../../../lib/family-client", () => familyApi);
vi.mock("../../../lib/family-achievement-client", () => achievementApi);

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

const linkedStaffProjection = {
  ...staffProjection,
  relationships: staffProjection.students.map((student) => ({
    relationshipId: `family-1--${student.studentId}`,
    academyId: "academy-1",
    familyId: "family-1",
    studentId: student.studentId,
    adultUserId: "user-1",
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: "2026-08-19T10:00:00.000Z",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-08-19T10:00:00.000Z",
    updatedBy: "admin-1",
  })),
};

const tutorReplacedProjection = {
  ...linkedStaffProjection,
  family: {
    ...linkedStaffProjection.family,
    primaryContactUserId: "user-2",
    billingContactUserId: "user-2",
  },
  relationships: linkedStaffProjection.relationships.map((relationship) => ({
    ...relationship,
    adultUserId: "user-2",
  })),
};

const studentAddedProjection = {
  ...tutorReplacedProjection,
  students: [
    ...tutorReplacedProjection.students,
    {
      ...tutorReplacedProjection.students[0],
      studentId: "student-3",
      fullName: "Synthetic Minor Three",
      dateOfBirth: "2018-05-20",
    },
  ],
  relationships: [
    ...tutorReplacedProjection.relationships,
    {
      ...tutorReplacedProjection.relationships[0],
      relationshipId: "family-1--student-3",
      studentId: "student-3",
    },
  ],
};

const relationshipDeactivatedProjection = {
  ...studentAddedProjection,
  relationships: studentAddedProjection.relationships.map((relationship) =>
    relationship.studentId === "student-1"
      ? {
          ...relationship,
          active: false,
          status: "inactive",
          validTo: "2026-09-03T10:00:00.000Z",
        }
      : relationship,
  ),
};

const familyDeactivatedProjection = {
  ...relationshipDeactivatedProjection,
  family: { ...relationshipDeactivatedProjection.family, active: false, status: "inactive" },
  relationships: relationshipDeactivatedProjection.relationships.map((relationship) => ({
    ...relationship,
    active: false,
    status: "inactive",
    validTo: "2026-09-03T10:00:00.000Z",
  })),
};

describe("admin family page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    familyApi.createFamily.mockReset();
    familyApi.getFamily.mockReset();
    familyApi.updateFamily.mockReset();
    achievementApi.getFamilyAchievementSummary.mockReset();
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
      requestId: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
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

  it("keeps one requestId across a failed retry and renews it only after success", async () => {
    const user = userEvent.setup();
    const firstRequestId = "00000000-0000-4000-8000-000000000001";
    const secondRequestId = "00000000-0000-4000-8000-000000000002";
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(firstRequestId)
      .mockReturnValueOnce(secondRequestId)
      .mockReturnValue("00000000-0000-4000-8000-000000000003");
    familyApi.createFamily
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(staffProjection);
    render(<FamilyAdminPage />);
    await user.type(screen.getByLabelText("Tutor user ID"), "user-1");
    await user.type(screen.getByLabelText("Minor full name"), "Synthetic Minor");
    await user.type(screen.getByLabelText("Date of birth"), "2015-08-19");
    await user.click(screen.getByRole("checkbox", { name: "Afternoon" }));

    await user.click(screen.getByRole("button", { name: "Create family" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to create the family");
    expect(familyApi.createFamily.mock.calls[0]?.[0]).toMatchObject({
      requestId: firstRequestId,
    });

    await user.click(screen.getByRole("button", { name: "Create family" }));
    await waitFor(() => expect(familyApi.createFamily).toHaveBeenCalledTimes(2));
    expect(familyApi.createFamily.mock.calls[1]?.[0]).toMatchObject({
      requestId: firstRequestId,
    });

    await user.click(screen.getByRole("button", { name: "Create family" }));
    await waitFor(() => expect(familyApi.createFamily).toHaveBeenCalledTimes(3));
    expect(familyApi.createFamily.mock.calls[2]?.[0]).toMatchObject({
      requestId: secondRequestId,
    });
  });

  it("loads an existing family achievement snapshot through the staff review form", async () => {
    const user = userEvent.setup();
    achievementApi.getFamilyAchievementSummary.mockResolvedValue({
      familyId: "family-review",
      generatedAt: "2026-08-31T10:00:00.000Z",
      members: [
        {
          studentId: "student-review",
          displayName: "Synthetic Member",
          participantType: "minor",
          goals: [
            {
              goalId: "goal-classes",
              label: "Attend classes",
              metric: "classes_attended",
              target: 4,
              progress: 4,
              status: "complete",
            },
          ],
          achievementCandidates: [],
        },
      ],
      adultComparison: [],
    });

    render(<FamilyAdminPage />);

    await user.type(screen.getByLabelText("Family reference"), "family-review");
    await user.click(screen.getByRole("button", { name: "Load achievement summary" }));
    await user.click(screen.getByRole("button", { name: "Open achievement summary" }));

    expect(await screen.findByText("Synthetic Member")).toBeVisible();
    expect(screen.getByText("4 / 4 classes attended")).toBeVisible();
    expect(achievementApi.getFamilyAchievementSummary).toHaveBeenCalledWith("family-review");
  });

  it("completes the supported family maintenance workflow with one stable add-minor request", async () => {
    const user = userEvent.setup();
    const addRequestId = "00000000-0000-4000-8000-000000000010";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(addRequestId);
    familyApi.getFamily.mockResolvedValue(linkedStaffProjection);
    familyApi.updateFamily
      .mockResolvedValueOnce(tutorReplacedProjection)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(studentAddedProjection)
      .mockResolvedValueOnce(relationshipDeactivatedProjection)
      .mockResolvedValueOnce(familyDeactivatedProjection);
    render(<FamilyAdminPage />);

    await user.type(screen.getByLabelText("Family ID"), "family-1");
    await user.click(screen.getByRole("button", { name: "Load family" }));
    expect(await screen.findByRole("heading", { name: "Family workspace" })).toBeVisible();
    expect(screen.getAllByText("Synthetic Minor One")).toHaveLength(2);
    expect(screen.queryByText("2015-08-19")).not.toBeInTheDocument();
    expect(screen.queryByText("family-1--student-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace tutor" }));
    await user.type(screen.getByLabelText("New tutor user ID"), "user-2");
    await user.click(screen.getByRole("button", { name: "Save tutor" }));
    await waitFor(() =>
      expect(familyApi.updateFamily).toHaveBeenNthCalledWith(1, {
        familyId: "family-1",
        operation: { kind: "replaceTutor", tutorUserId: "user-2" },
      }),
    );
    expect(await screen.findByText("Tutor replaced.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Add minor" }));
    await user.type(screen.getByLabelText("New minor full name"), "Synthetic Minor Three");
    await user.type(screen.getByLabelText("New minor date of birth"), "2018-05-20");
    await user.click(screen.getByRole("checkbox", { name: "New minor afternoon" }));
    await user.click(screen.getByRole("button", { name: "Save minor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to add the minor");
    await user.click(screen.getByRole("button", { name: "Save minor" }));
    await waitFor(() => expect(familyApi.updateFamily).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Minor added.")).toBeVisible();
    expect(familyApi.updateFamily.mock.calls[1]?.[0]).toMatchObject({
      familyId: "family-1",
      operation: { kind: "addStudent", requestId: addRequestId },
    });
    expect(familyApi.updateFamily.mock.calls[2]?.[0]).toMatchObject({
      familyId: "family-1",
      operation: { kind: "addStudent", requestId: addRequestId },
    });

    await user.click(
      screen.getByRole("button", { name: "Deactivate relationship for Synthetic Minor One" }),
    );
    await waitFor(() =>
      expect(familyApi.updateFamily).toHaveBeenNthCalledWith(4, {
        familyId: "family-1",
        operation: { kind: "deactivateRelationship", studentId: "student-1" },
      }),
    );
    expect(await screen.findByText("Relationship deactivated.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Deactivate family" }));
    await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));
    await waitFor(() =>
      expect(familyApi.updateFamily).toHaveBeenNthCalledWith(5, {
        familyId: "family-1",
        operation: { kind: "deactivateFamily" },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Family deactivated.");
    expect(screen.queryByRole("button", { name: "Open support review" })).not.toBeInTheDocument();
  });
});
