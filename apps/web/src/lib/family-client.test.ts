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
});
