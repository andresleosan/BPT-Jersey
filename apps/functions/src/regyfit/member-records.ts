import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import {
  parseRegyfitMemberRecord,
  toRegyfitMemberDirectoryRow,
  type RegyfitMemberDirectoryPage,
  type RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";

import { requireAdminActor } from "../auth/admin-authorization.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";

type FirestoreDocumentSnapshot = Readonly<{
  exists?: boolean;
  data: () => unknown;
}>;

export type RegyfitMemberRecordsServices = Readonly<{
  firestore: Readonly<{
    collection: (path: string) => Readonly<{
      get: () => Promise<Readonly<{ docs: readonly FirestoreDocumentSnapshot[] }>>;
    }>;
    doc: (path: string) => Readonly<{
      get: () => Promise<FirestoreDocumentSnapshot>;
    }>;
  }>;
}>;

const emptyRequestDataSchema = z.strictObject({});
const recordRequestSchema = z.strictObject({ recordId: z.string().regex(/^[0-9]{1,12}$/u) });

function collectionPath(academyId: string): string {
  return `academies/${academyId}/regyfitMemberRecords`;
}

function parseEmptyRequestData(request: CallableRequest): void {
  const result = emptyRequestDataSchema.safeParse(request.data === undefined ? {} : request.data);
  if (!result.success) {
    throw new HttpsError("invalid-argument", "This read operation does not accept request fields");
  }
}

function parseRecordRequestData(request: CallableRequest): string {
  const result = recordRequestSchema.safeParse(request.data);
  if (!result.success) {
    throw new HttpsError("invalid-argument", "A Regyfit member record id is required");
  }
  return result.data.recordId;
}

function parseStoredRecord(value: unknown): RegyfitMemberRecord {
  const stored =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
      ? (value as Record<string, unknown>)
      : undefined;
  if (stored === undefined) {
    throw new HttpsError("internal", "A stored Regyfit member record is invalid");
  }
  const record = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== "academyId"));
  const parsed = parseRegyfitMemberRecord(record);
  if (!parsed.ok) {
    throw new HttpsError("internal", "A stored Regyfit member record is invalid");
  }
  return parsed.value;
}

function latestCapture(records: readonly RegyfitMemberRecord[]): string | undefined {
  let latest: string | undefined;
  for (const record of records) {
    if (latest === undefined || record.capturedAt > latest) latest = record.capturedAt;
  }
  return latest;
}

export async function listRegyfitMemberRecordsHandler(
  request: CallableRequest,
  services: RegyfitMemberRecordsServices,
): Promise<RegyfitMemberDirectoryPage> {
  parseEmptyRequestData(request);
  const actor = requireAdminActor(request);
  const snapshot = await services.firestore.collection(collectionPath(actor.academyId)).get();
  const records = snapshot.docs.map((document) => parseStoredRecord(document.data()));
  const rows = records.map(toRegyfitMemberDirectoryRow).sort((left, right) => {
    const leftNumber = Number.parseInt(left.memberNumber ?? "", 10);
    const rightNumber = Number.parseInt(right.memberNumber ?? "", 10);
    const leftHas = Number.isFinite(leftNumber);
    const rightHas = Number.isFinite(rightNumber);
    if (leftHas && rightHas && leftNumber !== rightNumber) return leftNumber - rightNumber;
    if (leftHas !== rightHas) return leftHas ? -1 : 1;
    return left.fullName.localeCompare(right.fullName);
  });
  const capturedAt = latestCapture(records);
  return Object.freeze({
    rows: Object.freeze(rows),
    total: rows.length,
    ...(capturedAt === undefined ? {} : { capturedAt }),
  });
}

export async function getRegyfitMemberRecordHandler(
  request: CallableRequest,
  services: RegyfitMemberRecordsServices,
): Promise<RegyfitMemberRecord> {
  const recordId = parseRecordRequestData(request);
  const actor = requireAdminActor(request);
  const document = await services.firestore
    .doc(`${collectionPath(actor.academyId)}/${recordId}`)
    .get();
  if (document.exists === false) {
    throw new HttpsError("not-found", "The Regyfit member record was not found");
  }
  const record = parseStoredRecord(document.data());
  if (record.recordId !== recordId) {
    throw new HttpsError("internal", "A stored Regyfit member record is invalid");
  }
  return record;
}

export const listRegyfitMemberRecords = onCall(browserAdminCallableOptions, async (request) =>
  listRegyfitMemberRecordsHandler(request, { firestore: getFirestore() }),
);

export const getRegyfitMemberRecord = onCall(browserAdminCallableOptions, async (request) =>
  getRegyfitMemberRecordHandler(request, { firestore: getFirestore() }),
);
