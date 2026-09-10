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
  createProfileRequestId,
  getClientProfile,
  saveClientProfile,
  type ProfileFormInput,
  type SaveClientProfileRequest,
} from "./profile-client";

const projection = {
  user: {
    userId: "user-1",
    academyId: "academy-1",
    accountType: "client",
    displayName: "Synthetic Adult",
    email: "adult@example.test",
    phoneNumber: "+15550000001",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T12:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T12:00:00.000Z",
    updatedBy: "user-1",
  },
  student: {
    studentId: "student-1",
    academyId: "academy-1",
    userId: "user-1",
    fullName: "Synthetic Adult",
    dateOfBirth: "1990-08-19",
    phoneNumber: "+15550000001",
    email: "adult@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T12:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T12:00:00.000Z",
    updatedBy: "user-1",
  },
};

const form: ProfileFormInput = {
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-08-19",
  phoneNumber: "+15550000001",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
};

const saveRequest: SaveClientProfileRequest = {
  requestId: "profile-request-1",
  ...form,
};

describe("profile callable client", () => {
  it("sends only the retry identity and editable fields, and validates the response projection", async () => {
    callableState.call.mockResolvedValueOnce({ data: projection });
    await expect(saveClientProfile(saveRequest)).resolves.toEqual(projection);
    expect(callableState.name).toBe("saveClientProfile");
    expect(callableState.call).toHaveBeenCalledWith(saveRequest);

    callableState.call.mockResolvedValueOnce({ data: { ...projection, user: { ...projection.user, token: "nope" } } });
    await expect(getClientProfile()).rejects.toThrow("Unable to load your profile");
  });

  it("uses a null read payload and maps every callable failure to safe English", async () => {
    callableState.call.mockResolvedValueOnce({ data: null });
    await expect(getClientProfile()).resolves.toBeUndefined();
    expect(callableState.name).toBe("getClientProfile");
    expect(callableState.call).toHaveBeenCalledWith(null);

    callableState.call.mockRejectedValueOnce(new Error("claims, token, infrastructure"));
    await expect(saveClientProfile(saveRequest)).rejects.toThrow("Unable to save your profile");
  });

  it("creates an opaque request identity accepted by the server contract", () => {
    expect(createProfileRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });
});
