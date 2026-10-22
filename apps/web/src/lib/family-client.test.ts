import { describe, expect, it, vi } from "vitest";

const callableState = vi.hoisted(() => ({
  call: vi.fn(),
  name: "",
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn((_functions: unknown, name: string) => {
    callableState.name = name;
    return callableState.call;
  }),
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: vi.fn(() => ({ kind: "functions" })),
}));

import {
  changeChildGuardian,
  createFamily,
  getFamily,
  updateFamily,
  type CreateFamilyClientInput,
} from "./family-client";

const familyProjection = {
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
      fullName: "Synthetic Minor",
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
  ],
  relationships: [
    {
      relationshipId: "family-1--student-1",
      academyId: "academy-1",
      familyId: "family-1",
      studentId: "student-1",
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
    },
  ],
};

const guardianProjection = {
  family: { familyId: "family-1", active: true, status: "active" },
  tutor: {
    userId: "user-1",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+441234567890",
  },
  students: [
    {
      studentId: "student-1",
      fullName: "Synthetic Minor",
      dateOfBirth: "2015-08-19",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      active: true,
      status: "active",
    },
  ],
};

const createInput: CreateFamilyClientInput = {
  requestId: "request-create-1",
  tutorUserId: "user-1",
  students: [
    {
      fullName: "Synthetic Minor",
      dateOfBirth: "2015-08-19",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
    },
  ],
};

describe("family callable client", () => {
  it("sends only editable family fields and validates the staff projection", async () => {
    callableState.call.mockResolvedValueOnce({ data: familyProjection });
    await expect(createFamily({ ...createInput, authority: "owner" } as never)).resolves.toEqual(
      familyProjection,
    );
    expect(callableState.name).toBe("createFamily");
    expect(callableState.call).toHaveBeenCalledWith(createInput);

    callableState.call.mockResolvedValueOnce({ data: familyProjection });
    await expect(
      updateFamily({
        familyId: "family-1",
        operation: { kind: "deactivateFamily" },
        token: "not-editable",
      } as never),
    ).resolves.toEqual(familyProjection);
    expect(callableState.name).toBe("updateFamily");
    expect(callableState.call).toHaveBeenCalledWith({
      familyId: "family-1",
      operation: { kind: "deactivateFamily" },
    });
  });

  it("uses null for guardian reads and validates the redacted projection", async () => {
    callableState.call.mockResolvedValueOnce({ data: guardianProjection });
    await expect(getFamily()).resolves.toEqual(guardianProjection);
    expect(callableState.name).toBe("getFamily");
    expect(callableState.call).toHaveBeenCalledWith(null);
    expect(guardianProjection).not.toHaveProperty("relationships");

    callableState.call.mockResolvedValueOnce({ data: { ...guardianProjection, claims: "nope" } });
    await expect(getFamily()).rejects.toThrow("Unable to load your family");
  });

  it("uses an exact staff family payload and maps callable failures safely", async () => {
    callableState.call.mockResolvedValueOnce({ data: familyProjection });
    await expect(getFamily("family-1")).resolves.toEqual(familyProjection);
    expect(callableState.call).toHaveBeenCalledWith({ familyId: "family-1" });

    callableState.call.mockRejectedValueOnce(new Error("claims, PII, infrastructure"));
    await expect(updateFamily({ familyId: "family-1", operation: { kind: "deactivateFamily" } })).rejects.toThrow(
      "Unable to update your family",
    );
  });

  it("forwards a strict requestId for addStudent and rejects a missing one", async () => {
    callableState.call.mockResolvedValueOnce({ data: familyProjection });
    const input = {
      familyId: "family-1",
      operation: {
        kind: "addStudent",
        requestId: "request-add-1",
        student: createInput.students[0]!,
      },
    } as const;
    await expect(updateFamily(input)).resolves.toEqual(familyProjection);
    expect(callableState.call).toHaveBeenCalledWith(input);

    callableState.call.mockClear();
    await expect(
      updateFamily({
        familyId: "family-1",
        operation: { kind: "addStudent", student: createInput.students[0]! },
      } as never),
    ).rejects.toThrow("Unable to update your family");
    expect(callableState.call).not.toHaveBeenCalled();
  });

  it("sends one per-child guardian change and shows only the server's known refusals", async () => {
    const input = {
      familyId: "family-1",
      requestId: "6f1c2a8e-1b2c-4d3e-8f90-0a1b2c3d4e5f",
      studentId: "student-1",
      expectedRelationshipId: "family-1--student-1",
      proposedGuardianUserId: "user-2",
      evidence: "Court order seen at the desk",
      reason: "Custody moved to the other parent",
    };
    callableState.call.mockResolvedValueOnce({ data: familyProjection });
    await expect(changeChildGuardian(input)).resolves.toEqual(familyProjection);
    expect(callableState.name).toBe("changeChildGuardian");
    expect(callableState.call).toHaveBeenCalledWith(input);

    callableState.call.mockRejectedValueOnce(
      Object.assign(new Error("A guardian is required before age 16"), {
        code: "functions/failed-precondition",
      }),
    );
    await expect(changeChildGuardian(input)).rejects.toThrow("A guardian is required before age 16");
    callableState.call.mockRejectedValueOnce(
      Object.assign(new Error("Stored relationship is invalid: student-1"), {
        code: "functions/failed-precondition",
      }),
    );
    await expect(changeChildGuardian(input)).rejects.toThrow(
      "Unable to change the tutor. Please try again.",
    );

    callableState.call.mockClear();
    await expect(changeChildGuardian({ ...input, evidence: " " })).rejects.toThrow(
      "Unable to change the tutor. Please try again.",
    );
    expect(callableState.call).not.toHaveBeenCalled();
  });
});
