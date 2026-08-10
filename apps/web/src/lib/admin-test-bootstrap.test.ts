import { describe, expect, it } from "vitest";

import {
  isAdminE2EEnabled,
  readInjectedRegyfitRecordsForRole,
} from "./admin-test-bootstrap";

const commonRecord = {
  academyId: "synthetic-academy",
  sourceSystem: "regyfit" as const,
  sourceId: "synthetic-regyfit-1",
  memberDisplayName: "Synthetic Member",
  memberNumber: "42",
  loginCount: 42,
  lastLoginAt: "2026-08-08T12:00:00.000Z",
  importRunId: "synthetic-import-run-1",
  capturedAt: "2026-08-08T12:00:00.000Z",
  schemaVersion: "1" as const,
};

const ownerRecord = { ...commonRecord, ip: "203.0.113.10" };
const administratorRecord = { ...commonRecord };

describe("controlled admin E2E bootstrap", () => {
  it.each(["127.0.0.1", "localhost", "::1", "[::1]"])(
    "requires a loopback hostname for %s",
    (hostname) => {
      expect(isAdminE2EEnabled(hostname, true)).toBe(true);
    },
  );

  it.each(["academy.example.test", "192.0.2.10", ""])(
    "rejects non-loopback hostname %s even when the flag is baked",
    (hostname) => {
      expect(isAdminE2EEnabled(hostname, true)).toBe(false);
    },
  );

  it("rejects a runtime flag when it was not baked into the build", () => {
    expect(isAdminE2EEnabled("127.0.0.1", false)).toBe(false);
  });

  it("accepts only the requested owner payload and preserves its IP", () => {
    const records = readInjectedRegyfitRecordsForRole("owner", {
      role: "owner",
      records: [ownerRecord],
    });

    expect(records).toEqual([ownerRecord]);
  });

  it("accepts an administrator projection only when it has no IP", () => {
    const records = readInjectedRegyfitRecordsForRole("administrator", {
      role: "administrator",
      records: [administratorRecord],
    });

    expect(records).toEqual([administratorRecord]);
    expect(records[0]).not.toHaveProperty("ip");
  });

  it.each([
    undefined,
    null,
    { role: "administrator", records: [ownerRecord] },
    { role: "owner", records: [{ ...administratorRecord, ip: "" }] },
    { role: "administrator", records: [ownerRecord] },
    { role: "owner", records: [{ ...ownerRecord, sourceId: "real-run-1" }] },
  ])("returns no records for malformed injected data: %j", (payload) => {
    expect(readInjectedRegyfitRecordsForRole("owner", payload)).toEqual([]);
    expect(readInjectedRegyfitRecordsForRole("administrator", payload)).toEqual([]);
  });
});
