import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  memberReportKeys,
  parseMemberImportPreview,
  type MemberImportPreview,
  type MemberReportKey,
} from "@bpt-jersey/domain";

export type MemberImportPreviewStore = Readonly<{
  save: (preview: MemberImportPreviewRecord) => Promise<void>;
  get: (previewId: string) => Promise<MemberImportPreviewRecord | undefined>;
  remove: (previewId: string) => Promise<void>;
  invalidate: (previewId: string) => Promise<void>;
  listExpired: (now: string, limit: number) => Promise<readonly MemberImportPreviewRecord[]>;
  confirmIfPending: (
    input: Readonly<{
      previewId: string;
      operationId: string;
      sessionId: string;
      academyId: string;
      actorId: string;
      sourceHash: string;
      result: Readonly<{ imported: number; updated: number; conflicts: number }>;
    }>,
  ) => Promise<Readonly<{ imported: number; updated: number; conflicts: number }> | undefined>;
}>;

export type MemberImportPreviewRecord = Readonly<{
  previewId: string;
  sessionId: string;
  academyId: string;
  actorId: string;
  expiresAt: string;
  sourceHash: string;
  reportKeys: readonly MemberReportKey[];
  preview: MemberImportPreview;
  status: "pending" | "confirmed" | "expired";
  result?: Readonly<{ imported: number; updated: number; conflicts: number }>;
  operationId?: string;
}>;

const statuses = ["pending", "confirmed", "expired"] as const;
const MAX_PREVIEW_ID_LENGTH = 128;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_TENANT_ID_LENGTH = 128;
const MAX_ACTOR_ID_LENGTH = 128;
const MAX_REPORT_KEYS = 5;
const MAX_SOURCE_REPORTS = 5;
const MAX_CHANGE_ROWS = 2_000;
const MAX_SOURCE_LENGTH = 64;
const MAX_CHANGE_KEY_LENGTH = 256;
const MAX_FIELD_NAME_LENGTH = 64;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isValidRecord(value: unknown): value is MemberImportPreviewRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const expectedKeys = [
    "previewId",
    "sessionId",
    "academyId",
    "actorId",
    "expiresAt",
    "sourceHash",
    "reportKeys",
    "preview",
    "status",
    "result",
    "operationId",
  ];
  if (Object.keys(data).some((key) => !expectedKeys.includes(key))) return false;
  if (
    expectedKeys
      .filter((key) => key !== "result")
      .filter((key) => key !== "operationId")
      .some((key) => !Object.prototype.hasOwnProperty.call(data, key)) ||
    !validBoundedText(data.previewId, MAX_PREVIEW_ID_LENGTH) ||
    !validBoundedText(data.sessionId, MAX_SESSION_ID_LENGTH) ||
    !validBoundedText(data.academyId, MAX_TENANT_ID_LENGTH) ||
    !validBoundedText(data.actorId, MAX_ACTOR_ID_LENGTH) ||
    !isIsoDate(data.expiresAt) ||
    typeof data.previewId !== "string" ||
    !UUID_PATTERN.test(data.previewId) ||
    typeof data.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.sourceHash) ||
    !Array.isArray(data.reportKeys) ||
    data.reportKeys.length === 0 ||
    data.reportKeys.length > MAX_REPORT_KEYS ||
    !data.reportKeys.every((key) => memberReportKeys.includes(key as MemberReportKey)) ||
    typeof data.status !== "string" ||
    !statuses.includes(data.status as (typeof statuses)[number])
  ) {
    return false;
  }
  if (
    data.result !== undefined &&
    (typeof data.result !== "object" ||
      data.result === null ||
      Array.isArray(data.result) ||
      !Number.isSafeInteger((data.result as Record<string, unknown>).imported) ||
      !Number.isSafeInteger((data.result as Record<string, unknown>).updated) ||
      !Number.isSafeInteger((data.result as Record<string, unknown>).conflicts) ||
      (data.result as { imported: number }).imported < 0 ||
      (data.result as { updated: number }).updated < 0 ||
      (data.result as { conflicts: number }).conflicts < 0)
  ) {
    return false;
  }
  if (
    data.operationId !== undefined &&
    !validBoundedText(data.operationId, MAX_PREVIEW_ID_LENGTH)
  ) {
    return false;
  }
  const parsedPreview = parseMemberImportPreview(data.preview);
  if (!parsedPreview.ok || parsedPreview.value.previewId !== data.previewId) return false;
  if (
    parsedPreview.value.expiresAt !== data.expiresAt ||
    parsedPreview.value.sourceReports.length > MAX_SOURCE_REPORTS ||
    parsedPreview.value.sourceReports.some(
      (report) => report.source.length > MAX_SOURCE_LENGTH || report.rowCount > MAX_CHANGE_ROWS,
    )
  ) {
    return false;
  }
  const changes = [
    ...parsedPreview.value.additions,
    ...parsedPreview.value.updates,
    ...parsedPreview.value.duplicates,
    ...parsedPreview.value.conflicts,
  ];
  return (
    changes.length <= MAX_CHANGE_ROWS &&
    changes.every(
      (change) =>
        change.stableKey.length <= MAX_CHANGE_KEY_LENGTH &&
        change.rowNumbers.length <= MAX_CHANGE_ROWS &&
        change.fieldNames.length <= 16 &&
        change.fieldNames.every((field) => field.length <= MAX_FIELD_NAME_LENGTH),
    )
  );
}

function validBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateRecord(value: MemberImportPreviewRecord): MemberImportPreviewRecord {
  if (!isValidRecord(value)) throw new Error("Member import preview record is invalid");
  return Object.freeze({
    ...value,
    reportKeys: Object.freeze([...value.reportKeys]),
    preview: value.preview,
    ...(value.result === undefined ? {} : { result: Object.freeze({ ...value.result }) }),
    ...(value.operationId === undefined ? {} : { operationId: value.operationId }),
  });
}

export function createMemoryMemberImportPreviewStore(): MemberImportPreviewStore {
  const previews = new Map<string, MemberImportPreviewRecord>();
  const confirmations = new Map<
    string,
    Promise<Readonly<{ imported: number; updated: number; conflicts: number }> | undefined>
  >();
  const confirmIfPending = async (
    input: Parameters<MemberImportPreviewStore["confirmIfPending"]>[0],
  ) => {
    const inFlight = confirmations.get(input.previewId);
    if (inFlight) return inFlight;
    const confirmation = (async () => {
      const current = previews.get(input.previewId);
      if (!current) return undefined;
      if (
        current.sessionId !== input.sessionId ||
        current.academyId !== input.academyId ||
        current.actorId !== input.actorId ||
        current.sourceHash !== input.sourceHash ||
        current.status === "expired"
      )
        throw new Error("Member import preview confirmation is inconsistent");
      if (current.status === "confirmed") {
        if (
          current.operationId !== input.operationId ||
          !current.result ||
          JSON.stringify(current.result) !== JSON.stringify(input.result)
        ) {
          throw new Error("Member import preview result is inconsistent");
        }
        return current.result;
      }
      const confirmed = validateRecord({
        ...current,
        status: "confirmed",
        result: input.result,
        operationId: input.operationId,
      });
      previews.set(input.previewId, confirmed);
      return confirmed.result;
    })();
    confirmations.set(input.previewId, confirmation);
    try {
      return await confirmation;
    } finally {
      confirmations.delete(input.previewId);
    }
  };
  return {
    save: async (preview) => {
      const valid = validateRecord(preview);
      previews.set(valid.previewId, valid);
    },
    get: async (previewId) => previews.get(previewId),
    remove: async (previewId) => {
      previews.delete(previewId);
    },
    invalidate: async (previewId) => {
      const current = previews.get(previewId);
      if (current) previews.set(previewId, { ...current, status: "expired" });
    },
    listExpired: async (now, limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("Preview list limit is invalid");
      const expired = [...previews.values()].filter(
        (preview) => preview.status === "pending" && preview.expiresAt <= now,
      );
      if (expired.length > limit) throw new Error("Expired preview list is too large");
      return expired;
    },
    confirmIfPending,
  };
}

export function createFirestoreMemberImportPreviewStore(
  firestore: Firestore = getFirestore(),
): MemberImportPreviewStore {
  const collection = firestore.collection("memberImportPreviews");
  return {
    save: async (preview) => {
      await collection.doc(preview.previewId).set(validateRecord(preview));
    },
    get: async (previewId) => {
      const snapshot = await collection.doc(previewId).get();
      if (!snapshot.exists) return undefined;
      const value = snapshot.data();
      if (!isValidRecord(value) || value.previewId !== previewId) {
        throw new Error("Member import preview record is invalid");
      }
      return validateRecord(value);
    },
    remove: async (previewId) => {
      await collection.doc(previewId).delete();
    },
    invalidate: async (previewId) => {
      const reference = collection.doc(previewId);
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return;
        const value = snapshot.data();
        if (!isValidRecord(value) || value.previewId !== previewId) {
          throw new Error("Member import preview record is invalid");
        }
        transaction.set(reference, { ...value, status: "expired" });
      });
    },
    listExpired: async (now, limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("Preview list limit is invalid");
      const snapshot = await collection
        .where("status", "==", "pending")
        .where("expiresAt", "<=", now)
        .limit(limit + 1)
        .get();
      if (snapshot.size > limit) throw new Error("Expired preview list is too large");
      const values = snapshot.docs.map((document) => {
        const value = document.data();
        if (!isValidRecord(value) || value.previewId !== document.id) {
          throw new Error("Member import preview record is invalid");
        }
        return validateRecord(value);
      });
      return values;
    },
    confirmIfPending: async (input) => {
      const reference = collection.doc(input.previewId);
      let confirmed: Readonly<{ imported: number; updated: number; conflicts: number }> | undefined;
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return;
        const value = snapshot.data();
        if (!isValidRecord(value) || value.previewId !== input.previewId) {
          throw new Error("Member import preview record is invalid");
        }
        if (
          value.sessionId !== input.sessionId ||
          value.academyId !== input.academyId ||
          value.actorId !== input.actorId ||
          value.sourceHash !== input.sourceHash ||
          value.status === "expired"
        )
          throw new Error("Member import preview confirmation is inconsistent");
        if (value.status === "confirmed") {
          if (
            value.operationId !== input.operationId ||
            !value.result ||
            JSON.stringify(value.result) !== JSON.stringify(input.result)
          ) {
            throw new Error("Member import preview result is inconsistent");
          }
          confirmed = value.result;
          return;
        }
        transaction.set(
          reference,
          validateRecord({
            ...value,
            status: "confirmed",
            result: input.result,
            operationId: input.operationId,
          }),
        );
        confirmed = input.result;
      });
      return confirmed;
    },
  };
}
