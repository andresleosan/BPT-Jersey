import { describe, expect, it } from "vitest";

import {
  assertUniqueSourceIds,
  mapRegyfitAccessRow,
  normalizeRegyfitAccessEnvelope,
  toRestrictedRegyfitAccessProjection,
  toSafeRegyfitAccessProjection,
} from "./regyfit-access";
import type { RegyfitAccessRecord } from "./regyfit-access";
import type { UtcDateTime } from "../time";

const timestamp = "2026-08-08T12:00:00.000Z" as UtcDateTime;
const sourceRow = {
  sourceId: "source-demo-1",
  member: "Synthetic Member",
  memberNumber: "42",
  loginCount: 42,
  lastLogin: "2026-08-08T12:00:00Z",
  ip: "203.0.113.10",
} as const;
const context = {
  academyId: "source-demo-1",
  importRunId: "source-demo-1",
  capturedAt: timestamp,
} as const;

function mappedRecord(): RegyfitAccessRecord {
  const result = mapRegyfitAccessRow(sourceRow, context);
  if (!result.ok) {
    throw new Error("Expected the synthetic access row to be valid");
  }
  return result.value;
}

describe("Regyfit access domain contract", () => {
  it("normalizes a captured envelope and preserves an omitted member number as null", () => {
    const result = normalizeRegyfitAccessEnvelope(
      {
        runId: "synthetic-run-1",
        sourceSystem: "regyfit",
        sourceId: "synthetic-source-1",
        moduleKey: "alunos-acessos",
        capturedAtUtc: "2026-08-08T05:26:12.153Z",
        record: {
          member: "Synthetic Member",
          logins: "42",
          lastLogin: "Friday, 7 Aug 2026 - 17:23",
          ip: "203.0.113.10",
        },
      },
      { runId: "synthetic-run-1", moduleKey: "alunos-acessos" },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        sourceId: "synthetic-source-1",
        member: "Synthetic Member",
        memberNumber: null,
        loginCount: 42,
        lastLogin: "2026-08-07T16:23:00.000Z",
        ip: "203.0.113.10",
      },
    });
  });

  it("rejects envelope metadata, login text, and local dates that cannot be validated", () => {
    const base = {
      runId: "synthetic-run-1",
      sourceSystem: "regyfit",
      sourceId: "synthetic-source-1",
      moduleKey: "alunos-acessos",
      capturedAtUtc: "2026-08-08T05:26:12.153Z",
      record: {
        member: "Synthetic Member",
        logins: "42",
        lastLogin: "Friday, 7 Aug 2026 - 17:23",
        ip: "203.0.113.10",
      },
    };

    expect(
      normalizeRegyfitAccessEnvelope(
        { ...base, runId: "unexpected-run" },
        { runId: "synthetic-run-1", moduleKey: "alunos-acessos" },
      ).ok,
    ).toBe(false);
    expect(
      normalizeRegyfitAccessEnvelope(
        { ...base, record: { ...base.record, logins: "not-a-number" } },
        { runId: "synthetic-run-1", moduleKey: "alunos-acessos" },
      ).ok,
    ).toBe(false);
    expect(
      normalizeRegyfitAccessEnvelope(
        { ...base, record: { ...base.record, lastLogin: "not-a-date" } },
        { runId: "synthetic-run-1", moduleKey: "alunos-acessos" },
      ).ok,
    ).toBe(false);
  });

  it("maps the source row without deriving an Auth or canonical identity", () => {
    const result = mapRegyfitAccessRow(sourceRow, context);

    expect(result).toEqual({
      ok: true,
      value: {
        academyId: "source-demo-1",
        sourceSystem: "regyfit",
        sourceId: "source-demo-1",
        memberDisplayName: "Synthetic Member",
        memberNumber: "42",
        loginCount: 42,
        lastLoginAt: "2026-08-08T12:00:00.000Z",
        ip: "203.0.113.10",
        importRunId: "source-demo-1",
        capturedAt: timestamp,
        schemaVersion: "1",
      },
    });
    if (result.ok) {
      expect(result.value).not.toHaveProperty("userId");
      expect(result.value).not.toHaveProperty("studentId");
      expect(result.value).not.toHaveProperty("authUid");
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it("rejects invalid types, empty IDs, malformed IP and unexpected fields", () => {
    const invalidRows: readonly unknown[] = [
      { ...sourceRow, sourceId: 42 },
      { ...sourceRow, member: 42 },
      { ...sourceRow, loginCount: "42" },
      { ...sourceRow, lastLogin: 42 },
      { ...sourceRow, ip: "203.0.113.999" },
      { ...sourceRow, sourceId: " " },
      { ...sourceRow, password: "42" },
    ];

    for (const row of invalidRows) {
      expect(mapRegyfitAccessRow(row, context).ok).toBe(false);
    }
  });

  it("preserves opaque source IDs exactly and does not collapse distinct IDs", () => {
    const paddedId = " source-demo-1 ";
    const result = mapRegyfitAccessRow({ ...sourceRow, sourceId: paddedId }, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe(paddedId);
      expect(() =>
        assertUniqueSourceIds([result.value, { ...result.value, sourceId: "source-demo-1" }]),
      ).not.toThrow();
    }
  });

  it("rejects rows with a non-plain object prototype", () => {
    const rowWithPrototype = Object.assign(Object.create({ inherited: "42" }), sourceRow);

    expect(mapRegyfitAccessRow(rowWithPrototype, context).ok).toBe(false);
  });

  it("rejects duplicate source IDs", () => {
    const record = mappedRecord();

    expect(() => assertUniqueSourceIds([record, { ...record }])).toThrow(
      "Duplicate Regyfit source ID",
    );
  });

  it("omits IP from the safe projection and preserves it for the restricted projection", () => {
    const record = mappedRecord();
    const safe = toSafeRegyfitAccessProjection(record);
    const restricted = toRestrictedRegyfitAccessProjection(record);

    expect(safe).toEqual({
      academyId: "source-demo-1",
      sourceSystem: "regyfit",
      sourceId: "source-demo-1",
      memberDisplayName: "Synthetic Member",
      memberNumber: "42",
      loginCount: 42,
      lastLoginAt: "2026-08-08T12:00:00.000Z",
      importRunId: "source-demo-1",
      capturedAt: timestamp,
      schemaVersion: "1",
    });
    expect(safe).not.toHaveProperty("ip");
    expect(restricted).toEqual(record);
  });
});
