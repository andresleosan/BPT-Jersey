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

import { loadRegyfitAccessRecords } from "./regyfit-access-client";

describe("Regyfit access web client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.getFirebaseFunctions.mockClear();
    mocks.httpsCallable.mockReset();
  });

  it("calls the authenticated callable with an empty payload and returns its projection", async () => {
    const projection = [
      {
        academyId: "synthetic-academy",
        sourceSystem: "regyfit" as const,
        sourceId: "synthetic-source-1",
        memberDisplayName: "Synthetic Member",
        memberNumber: null,
        loginCount: 1,
        lastLoginAt: null,
        importRunId: "synthetic-run-1",
        capturedAt: "2026-08-08T12:00:00.000Z",
        schemaVersion: "1" as const,
      },
    ];
    mocks.callable.mockResolvedValue({ data: projection });
    mocks.httpsCallable.mockReturnValue(mocks.callable);

    await expect(loadRegyfitAccessRecords()).resolves.toEqual(projection);
    expect(mocks.httpsCallable).toHaveBeenCalledWith(
      {},
      "listRegyfitAccessRecords",
    );
    expect(mocks.callable).toHaveBeenCalledWith({});
  });

  it("maps callable failures to a safe user-facing error", async () => {
    mocks.callable.mockRejectedValue(new Error("restricted backend detail"));
    mocks.httpsCallable.mockReturnValue(mocks.callable);

    await expect(loadRegyfitAccessRecords()).rejects.toThrow(
      "Unable to load Regyfit access records.",
    );
    await expect(loadRegyfitAccessRecords()).rejects.not.toThrow("restricted backend detail");
  });
});
