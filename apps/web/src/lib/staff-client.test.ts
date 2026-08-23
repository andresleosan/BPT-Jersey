import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getFirebaseFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: mocks.getFirebaseFunctions,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable,
}));

import {
  createStaffProfile,
  listStaffProfiles,
  replaceStaffAssignments,
  replaceStaffAvailability,
  setStaffActive,
  updateStaffProfile,
} from "./staff-client";

const safeProfile = {
  staffKey: "staff-1",
  role: "coach" as const,
  active: true,
  status: "active" as const,
  schemaVersion: "1" as const,
};

describe("staff callable web client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.getFirebaseFunctions.mockClear();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  it("uses exact callable names and payloads for list and profile mutations", async () => {
    mocks.callable.mockResolvedValue({ data: [safeProfile] });
    await expect(listStaffProfiles()).resolves.toEqual([safeProfile]);
    expect(mocks.httpsCallable).toHaveBeenLastCalledWith({}, "listStaffProfiles");
    expect(mocks.callable).toHaveBeenLastCalledWith({});

    mocks.callable.mockResolvedValue({ data: safeProfile });
    await createStaffProfile({ userId: "user-1", role: "coach", requestId: "request-1" });
    expect(mocks.httpsCallable).toHaveBeenLastCalledWith({}, "createStaffProfile");
    expect(mocks.callable).toHaveBeenLastCalledWith({
      userId: "user-1",
      role: "coach",
      requestId: "request-1",
    });

    await updateStaffProfile({ staffKey: "staff-1", role: "headCoach" });
    expect(mocks.httpsCallable).toHaveBeenLastCalledWith({}, "updateStaffProfile");
    expect(mocks.callable).toHaveBeenLastCalledWith({ staffKey: "staff-1", role: "headCoach" });

    await setStaffActive({ staffKey: "staff-1", active: false });
    expect(mocks.httpsCallable).toHaveBeenLastCalledWith({}, "setStaffActive");
    expect(mocks.callable).toHaveBeenLastCalledWith({ staffKey: "staff-1", active: false });
  });

  it("uses exact staffKey payloads for availability and assignments", async () => {
    mocks.callable.mockResolvedValue({ data: [] });
    await replaceStaffAvailability({
      staffKey: "staff-1",
      windows: [
        { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
      ],
    });
    expect(mocks.callable).toHaveBeenLastCalledWith({
      staffKey: "staff-1",
      windows: [
        { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
      ],
    });

    await replaceStaffAssignments({
      staffKey: "staff-1",
      assignments: [{ targetType: "location", targetId: "location-town" }],
    });
    expect(mocks.callable).toHaveBeenLastCalledWith({
      staffKey: "staff-1",
      assignments: [{ targetType: "location", targetId: "location-town" }],
    });
  });

  it("rejects extra response fields from profile mutations and assignments", async () => {
    const privateProfile = { ...safeProfile, userId: "private-user" };
    mocks.callable.mockResolvedValue({ data: privateProfile });
    await expect(
      createStaffProfile({ userId: "user-1", role: "coach", requestId: "request-1" }),
    ).rejects.toThrow("Unable to create staff profile.");
    await expect(updateStaffProfile({ staffKey: "staff-1", role: "coach" })).rejects.toThrow(
      "Unable to update staff profile.",
    );
    await expect(setStaffActive({ staffKey: "staff-1", active: false })).rejects.toThrow(
      "Unable to update staff status.",
    );

    mocks.callable.mockResolvedValue({
      data: [{ targetType: "location", targetId: "location-town", assignmentId: "private" }],
    });
    await expect(
      replaceStaffAssignments({
        staffKey: "staff-1",
        assignments: [{ targetType: "location", targetId: "location-town" }],
      }),
    ).rejects.toThrow("Unable to replace staff assignments.");
  });

  it("rejects extra response fields and maps callable failures generically", async () => {
    mocks.callable.mockResolvedValue({ data: [{ ...safeProfile, userId: "private" }] });
    await expect(listStaffProfiles()).rejects.toThrow("Unable to load staff profiles.");

    mocks.callable.mockRejectedValue(new Error("Firebase infrastructure details"));
    await expect(updateStaffProfile({ staffKey: "staff-1", role: "coach" })).rejects.toThrow(
      "Unable to update staff profile.",
    );
    await expect(updateStaffProfile({ staffKey: "staff-1", role: "coach" })).rejects.not.toThrow(
      "Firebase infrastructure details",
    );

    mocks.callable.mockResolvedValue({
      data: [
        {
          weekday: 1,
          startLocal: "17:00",
          endLocal: "19:00",
          timezone: "Europe/London",
          staffId: "private",
        },
      ],
    });
    await expect(
      replaceStaffAvailability({
        staffKey: "staff-1",
        windows: [],
      }),
    ).rejects.toThrow("Unable to replace staff availability.");
  });

  it("rejects sparse response and input arrays", async () => {
    const sparseProfiles: unknown[] = [];
    sparseProfiles[1] = safeProfile;
    mocks.callable.mockResolvedValue({ data: sparseProfiles });
    await expect(listStaffProfiles()).rejects.toThrow("Unable to load staff profiles.");

    const sparseWindows: Array<{
      weekday: number;
      startLocal: string;
      endLocal: string;
      timezone: string;
    }> = [];
    sparseWindows[1] = {
      weekday: 1,
      startLocal: "17:00",
      endLocal: "19:00",
      timezone: "Europe/London",
    };
    await expect(
      replaceStaffAvailability({ staffKey: "staff-1", windows: sparseWindows }),
    ).rejects.toThrow("Unable to replace staff availability.");

    const sparseAssignments: Array<{ targetType: "location"; targetId: string }> = [];
    sparseAssignments[1] = { targetType: "location", targetId: "location-town" };
    await expect(
      replaceStaffAssignments({ staffKey: "staff-1", assignments: sparseAssignments }),
    ).rejects.toThrow("Unable to replace staff assignments.");
  });
});
