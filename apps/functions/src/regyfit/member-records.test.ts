import { describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";

import {
  getRegyfitMemberRecordHandler,
  listRegyfitMemberRecordsHandler,
  type RegyfitMemberRecordsServices,
} from "./member-records.js";
import { getRegyfitMemberRecord, listRegyfitMemberRecords } from "../index.js";

const academyId = "source-demo-1";

function record(overrides: Partial<RegyfitMemberRecord>): RegyfitMemberRecord {
  return {
    recordId: "152",
    memberNumber: "1",
    fullName: "Synthetic Child",
    gender: "unknown",
    birthDate: "2019-06-12",
    membershipState: "inactive",
    appAccess: { login: "a1", password: "104569", logins: 0 },
    graduation: { belt: "Grey - 5th Stripe" },
    plan: { paymentMode: "Inactive" },
    attendance: { records: [] },
    payments: [],
    capturedAt: "2026-09-04T18:04:32.000Z",
    source: "regyfit-admin-capture",
    schemaVersion: "1",
    ...overrides,
  };
}

function request(
  role: "owner" | "administrator" | "coach",
  data: unknown = undefined,
  scope = academyId,
) {
  return {
    auth: {
      uid: "source-demo-1",
      token: { academyId: scope, role, firebase: { sign_in_second_factor: "totp" } },
    },
    data,
  } as unknown as CallableRequest;
}

function servicesFor(records: readonly unknown[]) {
  const paths: string[] = [];
  const stored: Record<string, unknown>[] = records.map((entry) => ({
    ...(entry as Record<string, unknown>),
    academyId,
  }));
  const services: RegyfitMemberRecordsServices = {
    firestore: {
      collection: (path) => {
        paths.push(path);
        return {
          get: async () => ({
            docs:
              path === `academies/${academyId}/regyfitMemberRecords`
                ? stored.map((entry) => ({ data: () => entry }))
                : [],
          }),
        };
      },
      doc: (path) => {
        paths.push(path);
        return {
          get: async () => {
            const id = path.split("/").at(-1);
            const match = stored.find(
              (entry) =>
                path.startsWith(`academies/${academyId}/regyfitMemberRecords/`) &&
                entry.recordId === id,
            );
            return { exists: match !== undefined, data: () => match };
          },
        };
      },
    },
  };
  return { services, paths };
}

describe("Regyfit member record callables", () => {
  it("exports both callables", () => {
    expect(listRegyfitMemberRecords).toBeDefined();
    expect(getRegyfitMemberRecord).toBeDefined();
  });

  it("lists directory rows ordered by member number then name, without restricted fields", async () => {
    const { services, paths } = servicesFor([
      record({ recordId: "300", memberNumber: undefined, fullName: "Zed Unnumbered" }),
      record({ recordId: "152", memberNumber: "10" }),
      record({ recordId: "279", memberNumber: "2", fullName: "Second Member" }),
      record({ recordId: "301", memberNumber: undefined, fullName: "Alpha Unnumbered" }),
    ]);

    const page = await listRegyfitMemberRecordsHandler(request("administrator"), services);

    expect(paths).toEqual([`academies/${academyId}/regyfitMemberRecords`]);
    expect(page.total).toBe(4);
    expect(page.capturedAt).toBe("2026-09-04T18:04:32.000Z");
    expect(page.rows.map((row) => row.recordId)).toEqual(["279", "152", "301", "300"]);
    expect(page.rows[0]).toEqual({
      recordId: "279",
      memberNumber: "2",
      fullName: "Second Member",
      birthDate: "2019-06-12",
      membershipState: "inactive",
      paymentMode: "Inactive",
      belt: "Grey - 5th Stripe",
    });
    expect(JSON.stringify(page)).not.toContain("104569");
  });

  it("rejects list requests carrying fields and non-admin actors", async () => {
    const { services } = servicesFor([record({})]);

    await expect(
      listRegyfitMemberRecordsHandler(request("owner", { recordId: "152" }), services),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(listRegyfitMemberRecordsHandler(request("coach"), services)).rejects.toMatchObject(
      { code: "permission-denied" },
    );
  });

  it("returns the full record for the actor's academy only", async () => {
    const { services, paths } = servicesFor([record({})]);

    const result = await getRegyfitMemberRecordHandler(
      request("owner", { recordId: "152" }),
      services,
    );

    expect(result).toEqual(record({}));
    expect(result).not.toHaveProperty("academyId");
    expect(paths).toEqual([`academies/${academyId}/regyfitMemberRecords/152`]);
    await expect(
      getRegyfitMemberRecordHandler(request("owner", { recordId: "152" }, "other"), services),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects malformed record requests and invalid stored documents", async () => {
    const { services } = servicesFor([record({})]);
    const { services: broken } = servicesFor([{ recordId: "152", fullName: "" }]);

    await expect(
      getRegyfitMemberRecordHandler(request("owner", { recordId: "../152" }), services),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      getRegyfitMemberRecordHandler(request("owner", { recordId: "999" }), services),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      getRegyfitMemberRecordHandler(request("owner", { recordId: "152" }), broken),
    ).rejects.toMatchObject({ code: "internal" });
    await expect(listRegyfitMemberRecordsHandler(request("owner"), broken)).rejects.toMatchObject({
      code: "internal",
    });
  });
});
