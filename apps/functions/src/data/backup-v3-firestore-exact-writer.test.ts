import { describe, expect, it } from "vitest";

import {
  BackupV3FirestoreExactWriterError,
  writeBackupV3FirestorePayloadExact,
  type BackupV3ExactPayloadDocument,
  type BackupV3FirestoreCommitClient,
  type BackupV3FirestoreCommitRequest,
} from "./backup-v3-firestore-exact-writer.js";
import type { BackupV3CanonicalFirestoreDocument } from "./backup-v3-firestore-value-codec.js";

const academyId = "academy-exact-writer-1";
const sourceProjectId = "demo-bpt-jersey";
const targetProjectId = "demo-bpt-jersey-restore";
const sourceDatabase = `projects/${sourceProjectId}/databases/(default)/documents`;
const targetDatabase = `projects/${targetProjectId}/databases/(default)`;
const path = `academies/${academyId}/students/student-1`;

const exactNativeDocument: BackupV3CanonicalFirestoreDocument = Object.freeze({
  codecVersion: "firestore-value-v1",
  fields: Object.freeze({
    nil: Object.freeze({ type: "null" }),
    enabled: Object.freeze({ type: "boolean", value: true }),
    integer: Object.freeze({ type: "integer", value: "9223372036854775807" }),
    integerLookingDouble: Object.freeze({ type: "double", value: "finite:3ff0000000000000" }),
    negativeZero: Object.freeze({ type: "double", value: "negative-zero" }),
    notANumber: Object.freeze({ type: "double", value: "nan" }),
    positiveInfinity: Object.freeze({ type: "double", value: "positive-infinity" }),
    negativeInfinity: Object.freeze({ type: "double", value: "negative-infinity" }),
    timestamp: Object.freeze({
      type: "timestamp",
      seconds: "1772714096",
      nanos: 123_456_789,
    }),
    text: Object.freeze({ type: "string", value: "BPT" }),
    bytes: Object.freeze({ type: "bytes", value: "AAH-_w" }),
    reference: Object.freeze({
      type: "reference",
      value: `${sourceDatabase}/academies/${academyId}/users/user-1`,
    }),
    point: Object.freeze({
      type: "geo-point",
      latitude: "negative-zero",
      longitude: "finite:4029000000000000",
    }),
    array: Object.freeze({
      type: "array",
      values: Object.freeze([Object.freeze({ type: "integer", value: "7" })]),
    }),
    map: Object.freeze({
      type: "map",
      fields: Object.freeze({ nested: Object.freeze({ type: "string", value: "value" }) }),
    }),
  }),
});

function resultFor(writeCount: number) {
  return {
    writeResults: Array.from({ length: writeCount }, () => ({
      updateTime: { seconds: "1772714100", nanos: 123_000_000 },
    })),
    commitTime: { seconds: "1772714101", nanos: 456_000_000 },
  };
}

function fakeClient(response?: (writeCount: number) => unknown) {
  const calls: Array<{ request: BackupV3FirestoreCommitRequest; timeoutMs: number }> = [];
  const client: BackupV3FirestoreCommitClient = {
    commit: async (request, options) => {
      calls.push({ request, timeoutMs: options.timeoutMs });
      return (response ?? resultFor)(request.writes.length);
    },
  };
  return { client, calls };
}

function command(
  client: BackupV3FirestoreCommitClient,
  documents: readonly BackupV3ExactPayloadDocument[] = [{ path, data: exactNativeDocument }],
  plannedPaths: readonly string[] = documents.map((document) => document.path),
) {
  return {
    client,
    sourceProjectId,
    targetProjectId,
    academyId,
    plannedPaths,
    documents,
  } as const;
}

function expectCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(BackupV3FirestoreExactWriterError);
  expect(error).toMatchObject({ code });
  return true;
}

describe("backup v3 exact Firestore REST writer", () => {
  it("commits every native Value exactly with a create-only target precondition", async () => {
    const fake = fakeClient();

    const result = await writeBackupV3FirestorePayloadExact(command(fake.client));

    expect(result).toEqual({ documentCount: 1, chunkCount: 1 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.timeoutMs).toBe(15_000);
    expect(fake.calls[0]!.request).toMatchObject({
      database: targetDatabase,
      writes: [
        {
          update: {
            name: `${targetDatabase}/documents/${path}`,
            fields: {
              nil: { nullValue: "NULL_VALUE" },
              enabled: { booleanValue: true },
              integer: { integerValue: "9223372036854775807" },
              integerLookingDouble: { doubleValue: 1 },
              timestamp: {
                timestampValue: { seconds: "1772714096", nanos: 123_456_789 },
              },
              text: { stringValue: "BPT" },
              reference: {
                referenceValue: `${sourceDatabase}/academies/${academyId}/users/user-1`,
              },
              point: { geoPointValue: { latitude: -0, longitude: 12.5 } },
              array: { arrayValue: { values: [{ integerValue: "7" }] } },
              map: { mapValue: { fields: { nested: { stringValue: "value" } } } },
            },
          },
          currentDocument: { exists: false },
        },
      ],
    });
    const fields = (
      (fake.calls[0]!.request.writes as readonly Record<string, unknown>[])[0]!.update as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;
    expect(Object.is(fields.negativeZero!.doubleValue, -0)).toBe(true);
    expect(Number.isNaN(fields.notANumber!.doubleValue)).toBe(true);
    expect(fields.positiveInfinity!.doubleValue).toBe(Number.POSITIVE_INFINITY);
    expect(fields.negativeInfinity!.doubleValue).toBe(Number.NEGATIVE_INFINITY);
    expect(Array.from(fields.bytes!.bytesValue as Uint8Array)).toEqual([0, 1, 254, 255]);
  });

  it("preflights the complete exact plan before any commit and chunks within hard limits", async () => {
    const chunked = fakeClient();
    const documents = Array.from({ length: 41 }, (_, index) => ({
      path: `academies/${academyId}/students/student-${String(index).padStart(2, "0")}`,
      data: exactNativeDocument,
    }));
    const result = await writeBackupV3FirestorePayloadExact(command(chunked.client, documents));
    expect(result).toEqual({ documentCount: 41, chunkCount: 2 });
    expect(chunked.calls.map(({ request }) => request.writes.length)).toEqual([40, 1]);
    expect(chunked.calls.every(({ timeoutMs }) => timeoutMs === 15_000)).toBe(true);

    const invalidCases = [
      {
        documents: [{ path, data: exactNativeDocument }],
        planned: [path, path],
      },
      {
        documents: [
          { path, data: exactNativeDocument },
          { path, data: exactNativeDocument },
        ],
        planned: [path],
      },
      {
        documents: [{ path: `academies/${academyId}/unknown/doc-1`, data: exactNativeDocument }],
        planned: [`academies/${academyId}/unknown/doc-1`],
      },
      {
        documents: [
          {
            path: `academies/${academyId}/memberDirectoryStates/current`,
            data: exactNativeDocument,
          },
        ],
        planned: [`academies/${academyId}/memberDirectoryStates/current`],
      },
      {
        documents: [
          {
            path: `academies/${academyId}/memberDirectoryCursorStates/cursor-1`,
            data: exactNativeDocument,
          },
        ],
        planned: [`academies/${academyId}/memberDirectoryCursorStates/cursor-1`],
      },
      {
        documents: [{ path, data: exactNativeDocument }],
        planned: [`academies/${academyId}/students/different`],
      },
      {
        documents: [
          {
            path: "academies/other-academy/students/student-1",
            data: exactNativeDocument,
          },
        ],
        planned: ["academies/other-academy/students/student-1"],
      },
    ] as const;
    for (const invalid of invalidCases) {
      const fake = fakeClient();
      await expect(
        writeBackupV3FirestorePayloadExact(
          command(fake.client, invalid.documents, invalid.planned),
        ),
      ).rejects.toSatisfy((error: unknown) => expectCode(error, "invalid-plan"));
      expect(fake.calls).toHaveLength(0);
    }
  });

  it("fails closed when Commit does not prove every write result and commitTime", async () => {
    for (const response of [
      { writeResults: [], commitTime: { seconds: "1772714101", nanos: 0 } },
      { writeResults: [{}], commitTime: { seconds: "1772714101", nanos: 0 } },
      {
        writeResults: [{ updateTime: { seconds: "1772714100", nanos: 0 } }],
      },
    ]) {
      const fake = fakeClient(() => response);
      await expect(writeBackupV3FirestorePayloadExact(command(fake.client))).rejects.toSatisfy(
        (error: unknown) => expectCode(error, "invalid-commit-response"),
      );
      expect(fake.calls).toHaveLength(1);
    }
  });
});
