import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
  BackupV3FirestoreValueCodecError,
  canonicalizeBackupV3FirestoreDocument,
  decodeBackupV3FirestoreDocument,
  encodeBackupV3FirestoreDocument,
} from "./backup-v3-firestore-value-codec.js";

const database = "projects/demo-bpt-jersey/databases/(default)/documents";

function expectCodecError(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(BackupV3FirestoreValueCodecError);
  expect(error).toMatchObject({ code });
  return true;
}

describe("backup v3 canonical Firestore value codec", () => {
  it("round-trips every supported Firestore Value without collapsing native types", () => {
    const reference = `${database}/academies/academy-1/students/student-1`;
    const encoded = encodeBackupV3FirestoreDocument(
      {
        nil: { nullValue: "NULL_VALUE" },
        enabled: { booleanValue: true },
        minInteger: { integerValue: "-9223372036854775808" },
        integerLookingDouble: { doubleValue: 1 },
        negativeZero: { doubleValue: -0 },
        notANumber: { doubleValue: Number.NaN },
        positiveInfinity: { doubleValue: Number.POSITIVE_INFINITY },
        negativeInfinity: { doubleValue: Number.NEGATIVE_INFINITY },
        timestamp: { timestampValue: { seconds: "1772714096", nanos: 123_456_789 } },
        text: { stringValue: "BPT" },
        bytes: { bytesValue: Uint8Array.from([0, 1, 254, 255]) },
        reference: { referenceValue: reference },
        point: { geoPointValue: { latitude: -0, longitude: 12.5 } },
        array: { arrayValue: { values: [{ integerValue: "7" }, { stringValue: "x" }] } },
        map: { mapValue: { fields: { nested: { booleanValue: false } } } },
      },
      { database },
    );

    expect(encoded).toMatchObject({
      codecVersion: BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
      fields: {
        minInteger: { type: "integer", value: "-9223372036854775808" },
        integerLookingDouble: { type: "double", value: "finite:3ff0000000000000" },
        negativeZero: { type: "double", value: "negative-zero" },
        notANumber: { type: "double", value: "nan" },
        positiveInfinity: { type: "double", value: "positive-infinity" },
        negativeInfinity: { type: "double", value: "negative-infinity" },
        timestamp: { type: "timestamp", seconds: "1772714096", nanos: 123_456_789 },
        bytes: { type: "bytes", value: "AAH-_w" },
        reference: { type: "reference", value: reference },
        point: {
          type: "geo-point",
          latitude: "negative-zero",
          longitude: "finite:4029000000000000",
        },
      },
    });
    const decoded = decodeBackupV3FirestoreDocument(encoded, { database });
    expect(decoded.minInteger).toEqual({ integerValue: "-9223372036854775808" });
    expect(decoded.integerLookingDouble).toEqual({ doubleValue: 1 });
    expect(Object.is((decoded.negativeZero as { doubleValue: number }).doubleValue, -0)).toBe(true);
    expect(Number.isNaN((decoded.notANumber as { doubleValue: number }).doubleValue)).toBe(true);
    expect(decoded.positiveInfinity).toEqual({ doubleValue: Number.POSITIVE_INFINITY });
    expect(decoded.negativeInfinity).toEqual({ doubleValue: Number.NEGATIVE_INFINITY });
    expect(decoded.timestamp).toEqual({
      timestampValue: { seconds: "1772714096", nanos: 123_456_789 },
    });
    expect(Array.from((decoded.bytes as { bytesValue: Uint8Array }).bytesValue)).toEqual([
      0, 1, 254, 255,
    ]);
    expect(decoded.reference).toEqual({ referenceValue: reference });
    expect(
      Object.is(
        (decoded.point as { geoPointValue: { latitude: number } }).geoPointValue.latitude,
        -0,
      ),
    ).toBe(true);
    expect(canonicalizeBackupV3FirestoreDocument(encoded, { database })).toBe(
      canonicalizeBackupV3FirestoreDocument(
        encodeBackupV3FirestoreDocument(decoded, { database }),
        { database },
      ),
    );
  });

  it("rejects ambiguous, foreign, reserved, cyclic, too-deep and oversized values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = { mapValue: { fields: cyclic } };
    let tooDeep: unknown = { stringValue: "leaf" };
    for (let index = 0; index < 22; index += 1) {
      tooDeep = { mapValue: { fields: { child: tooDeep } } };
    }
    const cases = [
      {
        fields: { bad: { stringValue: "x", integerValue: "1" } },
        code: "ambiguous-value",
      },
      { fields: { bad: { integerValue: "01" } }, code: "invalid-integer" },
      { fields: { bad: { integerValue: "9223372036854775808" } }, code: "invalid-integer" },
      {
        fields: {
          bad: {
            referenceValue: "projects/other/databases/(default)/documents/academies/academy-1",
          },
        },
        code: "invalid-reference",
      },
      {
        fields: { bad: { geoPointValue: { latitude: 91, longitude: 0 } } },
        code: "invalid-geo-point",
      },
      {
        fields: {
          bad: {
            mapValue: {
              fields: {
                __type__: { stringValue: "__vector__" },
                value: { arrayValue: { values: [] } },
              },
            },
          },
        },
        code: "unsupported-value",
      },
      { fields: { bad: { vectorValue: [1, 2] } }, code: "unsupported-value" },
      { fields: { bad: { serverTimestampValue: true } }, code: "unsupported-value" },
      { fields: cyclic, code: "cyclic-value" },
      { fields: { bad: tooDeep }, code: "depth-limit" },
    ] as const;
    for (const testCase of cases) {
      expect(() => encodeBackupV3FirestoreDocument(testCase.fields, { database })).toThrowError(
        expect.objectContaining({ code: testCase.code }),
      );
    }
    expect(() =>
      encodeBackupV3FirestoreDocument(
        { bad: { stringValue: "four" } },
        { database, limits: { maxStringBytes: 3 } },
      ),
    ).toThrowError(expect.objectContaining({ code: "size-limit" }));
    expect(() =>
      encodeBackupV3FirestoreDocument(
        { bad: { bytesValue: Buffer.alloc(4) } },
        { database, limits: { maxBytesLength: 3 } },
      ),
    ).toThrowError(expect.objectContaining({ code: "size-limit" }));
    expect(() =>
      decodeBackupV3FirestoreDocument(
        {
          codecVersion: BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
          fields: { bad: { type: "string", value: "x", extra: true } },
        },
        { database },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-canonical-value" }));
    expectCodecError(
      (() => {
        try {
          return encodeBackupV3FirestoreDocument(
            { bad: { referenceValue: "not-a-resource" } },
            { database },
          );
        } catch (error) {
          return error;
        }
      })(),
      "invalid-reference",
    );
  });
});
