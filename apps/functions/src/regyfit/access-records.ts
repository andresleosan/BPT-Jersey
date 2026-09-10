import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import { browserAdminCallableOptions } from "../auth/callable-options.js";

import {
  assertAcademyScope,
  getRegyfitProjectionScope,
  requireAdminActor,
} from "../auth/admin-authorization.js";
import {
  assertUniqueSourceIds,
  toRestrictedRegyfitAccessProjection,
  toSafeRegyfitAccessProjection,
  type RegyfitAccessRecord,
} from "@bpt-jersey/domain/migration/regyfit-access";
import type { UtcDateTime } from "@bpt-jersey/domain";

type FirestoreDocumentSnapshot = Readonly<{
  data: () => unknown;
}>;

export type RegyfitAccessRecordsServices = Readonly<{
  firestore: Readonly<{
    collection: (path: string) => Readonly<{
      get: () => Promise<Readonly<{ docs: readonly FirestoreDocumentSnapshot[] }>>;
    }>;
  }>;
}>;

export type RegyfitAccessProjection = RegyfitAccessRecord | Omit<RegyfitAccessRecord, "ip">;

const emptyRequestDataSchema = z.strictObject({});
const unsafeValuePattern =
  /(?:password|passwd|token|secret|api[_-]?key|credential|private[_-]?key)\s*[:=]/i;
const storedTextSchema = z
  .string()
  .trim()
  .refine((value) => value.length > 0 && !unsafeValuePattern.test(value));
const storedSourceIdSchema = z
  .string()
  .refine((value) => value.trim().length > 0 && !unsafeValuePattern.test(value));
const utcDateTimeSchema = z.string().refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) {
    return false;
  }
  const date = new Date(value);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6]) &&
    date.getUTCMilliseconds() === Number(match[7]) &&
    date.toISOString() === value
  );
});
const ipv4Schema = z.string().refine((value) => {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
});
const accessRecordSchema = z.strictObject({
  academyId: storedTextSchema,
  sourceSystem: z.literal("regyfit"),
  sourceId: storedSourceIdSchema,
  memberDisplayName: storedTextSchema,
  memberNumber: storedTextSchema.nullable(),
  loginCount: z.number().int().nonnegative(),
  lastLoginAt: utcDateTimeSchema.nullable(),
  ip: ipv4Schema,
  importRunId: storedTextSchema,
  capturedAt: utcDateTimeSchema,
  schemaVersion: z.literal("1"),
});

function parseRequestData(request: CallableRequest): void {
  const result = emptyRequestDataSchema.safeParse(request.data === undefined ? {} : request.data);
  if (!result.success) {
    throw new HttpsError("invalid-argument", "This read operation does not accept request fields");
  }
}

function parseStoredRecord(value: unknown): RegyfitAccessRecord {
  const result = accessRecordSchema.safeParse(
    typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
      ? value
      : undefined,
  );
  if (!result.success) {
    throw new HttpsError("internal", "A stored Regyfit access record is invalid");
  }
  return Object.freeze({
    ...result.data,
    lastLoginAt: result.data.lastLoginAt as UtcDateTime | null,
    capturedAt: result.data.capturedAt as UtcDateTime,
  });
}

export async function listRegyfitAccessWithServices(
  request: CallableRequest,
  services: RegyfitAccessRecordsServices,
): Promise<readonly RegyfitAccessProjection[]> {
  parseRequestData(request);
  const actor = requireAdminActor(request);
  const collectionPath = `academies/${actor.academyId}/regyfitAccessRecords`;
  const snapshot = await services.firestore.collection(collectionPath).get();
  const records = snapshot.docs.map((document) => {
    const record = parseStoredRecord(document.data());
    assertAcademyScope(actor, record.academyId);
    return record;
  });
  try {
    assertUniqueSourceIds(records);
  } catch {
    throw new HttpsError("internal", "Stored Regyfit access records are invalid");
  }

  const projectionScope = getRegyfitProjectionScope(actor.role);
  return projectionScope === "restricted"
    ? records.map(toRestrictedRegyfitAccessProjection)
    : records.map(toSafeRegyfitAccessProjection);
}

export async function listRegyfitAccessRecordsHandler(
  request: CallableRequest,
  services: RegyfitAccessRecordsServices,
): Promise<readonly RegyfitAccessProjection[]> {
  return listRegyfitAccessWithServices(request, services);
}

export const listRegyfitAccessRecords = onCall(browserAdminCallableOptions, async (request) =>
  listRegyfitAccessRecordsHandler(request, { firestore: getFirestore() }),
);
