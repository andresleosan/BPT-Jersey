import { describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { RegyfitAccessRecord } from "@bpt-jersey/domain";

import {
  listRegyfitAccessRecordsHandler,
  listRegyfitAccessWithServices,
  type RegyfitAccessRecordsServices,
} from "./access-records.js";
import { listRegyfitAccessRecords } from "../index.js";

const accessRecord: RegyfitAccessRecord = {
  academyId: "source-demo-1",
  sourceSystem: "regyfit",
  sourceId: "source-demo-1",
  memberDisplayName: "Synthetic Member",
  memberNumber: "42",
  loginCount: 42,
  lastLoginAt: "2026-08-08T12:00:00.000Z" as RegyfitAccessRecord["lastLoginAt"] & {},
  ip: "203.0.113.10",
  importRunId: "source-demo-1",
  capturedAt: "2026-08-08T12:00:00.000Z" as RegyfitAccessRecord["capturedAt"],
  schemaVersion: "1",
};

function request(
  role: "owner" | "administrator" | "coach",
  academyId = "source-demo-1",
  data: unknown = undefined,
) {
  return {
    auth: {
      uid: "source-demo-1",
      token: { academyId, role, firebase: { sign_in_second_factor: "totp" } },
    },
    data,
  } as unknown as CallableRequest;
}

function servicesForRecords(records: readonly unknown[]) {
  const collectionPaths: string[] = [];
  const services: RegyfitAccessRecordsServices = {
    firestore: {
      collection: (path) => {
        collectionPaths.push(path);
        return {
          get: async () => ({
            docs: records
              .filter(() => path === "academies/source-demo-1/regyfitAccessRecords")
              .map((record) => ({ data: () => record })),
          }),
        };
      },
    },
  };
  return { services, collectionPaths };
}

describe("Regyfit access backend projections", () => {
  it("exposes the callable handler and delegates to the scoped projection service", async () => {
    const { services } = servicesForRecords([accessRecord]);

    const result = await listRegyfitAccessRecordsHandler(request("owner"), services);

    expect(result).toEqual([accessRecord]);
    expect(listRegyfitAccessRecords).toBeDefined();
  });

  it("returns the complete record to an owner from the scoped collection", async () => {
    const { services, collectionPaths } = servicesForRecords([accessRecord]);

    const result = await listRegyfitAccessWithServices(request("owner"), services);

    expect(result).toEqual([accessRecord]);
    expect(collectionPaths).toEqual(["academies/source-demo-1/regyfitAccessRecords"]);
  });

  it("returns an administrator projection without IP or derived identity", async () => {
    const { services } = servicesForRecords([accessRecord]);

    const result = await listRegyfitAccessWithServices(request("administrator"), services);

    expect(result).toEqual([
      {
        academyId: "source-demo-1",
        sourceSystem: "regyfit",
        sourceId: "source-demo-1",
        memberDisplayName: "Synthetic Member",
        memberNumber: "42",
        loginCount: 42,
        lastLoginAt: "2026-08-08T12:00:00.000Z",
        importRunId: "source-demo-1",
        capturedAt: "2026-08-08T12:00:00.000Z",
        schemaVersion: "1",
      },
    ]);
    expect(result[0]).not.toHaveProperty("ip");
    expect(result[0]).not.toHaveProperty("userId");
    expect(result[0]).not.toHaveProperty("studentId");
  });

  it("normalizes stored text fields while preserving the opaque source ID", async () => {
    const { services } = servicesForRecords([
      {
        ...accessRecord,
        academyId: " source-demo-1 ",
        sourceId: " source-demo-1 ",
        memberDisplayName: " Synthetic Member ",
        memberNumber: " 42 ",
        importRunId: " source-demo-1 ",
      },
    ]);

    const result = await listRegyfitAccessWithServices(request("owner"), services);

    expect(result).toEqual([
      {
        ...accessRecord,
        sourceId: " source-demo-1 ",
      },
    ]);
  });

  it("denies non-administrative roles before reading Firestore", async () => {
    const { services, collectionPaths } = servicesForRecords([accessRecord]);

    await expect(listRegyfitAccessWithServices(request("coach"), services)).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(collectionPaths).toEqual([]);
  });

  it("isolates academy reads to the actor academy", async () => {
    const { services, collectionPaths } = servicesForRecords([accessRecord]);

    const result = await listRegyfitAccessWithServices(request("owner", "42"), services);

    expect(result).toEqual([]);
    expect(collectionPaths).toEqual(["academies/42/regyfitAccessRecords"]);
  });

  it("rejects null and unknown request data", async () => {
    const { services } = servicesForRecords([accessRecord]);

    await expect(
      listRegyfitAccessWithServices(request("owner", "source-demo-1", null), services),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      listRegyfitAccessWithServices(
        request("owner", "source-demo-1", { academyId: "42" }),
        services,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects stored credential-shaped fields without exposing their values", async () => {
    const { services } = servicesForRecords([
      { ...accessRecord, memberDisplayName: "password: 42" },
    ]);

    await expect(listRegyfitAccessWithServices(request("owner"), services)).rejects.toMatchObject({
      code: "internal",
      message: "A stored Regyfit access record is invalid",
    });
  });

  it("rejects stored text fields that become empty after trimming", async () => {
    const { services } = servicesForRecords([{ ...accessRecord, memberNumber: "   " }]);

    await expect(listRegyfitAccessWithServices(request("owner"), services)).rejects.toMatchObject({
      code: "internal",
      message: "A stored Regyfit access record is invalid",
    });
  });

  it("accepts a missing source member number as null", async () => {
    const { services } = servicesForRecords([{ ...accessRecord, memberNumber: null }]);

    const result = await listRegyfitAccessWithServices(request("owner"), services);

    expect(result[0]?.memberNumber).toBeNull();
  });

  it("rejects non-canonical stored timestamps and invalid precision", async () => {
    for (const lastLoginAt of ["2026-08-08T12:00:00Z", "2026-08-08T12:00:00.00Z"]) {
      const { services } = servicesForRecords([{ ...accessRecord, lastLoginAt }]);

      await expect(listRegyfitAccessWithServices(request("owner"), services)).rejects.toMatchObject(
        {
          code: "internal",
        },
      );
    }
  });

  it("converts duplicate stored source IDs into a controlled HttpsError", async () => {
    const { services } = servicesForRecords([accessRecord, { ...accessRecord }]);

    await expect(listRegyfitAccessWithServices(request("owner"), services)).rejects.toMatchObject({
      code: "internal",
      message: "Stored Regyfit access records are invalid",
    });
  });

  it("rejects stored documents with a non-plain object prototype", async () => {
    const storedDocument = Object.assign(Object.create({ inherited: "42" }), accessRecord);
    const { services } = servicesForRecords([storedDocument]);

    await expect(listRegyfitAccessWithServices(request("owner"), services)).rejects.toMatchObject({
      code: "internal",
    });
  });
});
