import { createHash } from "node:crypto";

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  parseAggregateReportExportRequest,
  type AggregateReportExportRequest,
  type AggregateReportExportResponse,
} from "@bpt-jersey/domain/exports";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { createLevelCatalogStore } from "../levels/level-service.js";
import { createFirestoreProgressReportStore } from "../levels/progress-report-service.js";
import { createFirestoreOperationalReportStore } from "../reports/operational-report-service.js";
import {
  AggregateReportExportServiceError,
  createAggregateReportExportService,
} from "./aggregate-report-export-service.js";

const exportRoles = Object.freeze(["owner", "administrator"] as const);
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertSafeActorScope(academyId: string, actorId: string): void {
  if (!safeIdentifierPattern.test(academyId) || !safeIdentifierPattern.test(actorId)) {
    throw new HttpsError("permission-denied", "Aggregate export actor scope is invalid");
  }
}

function rateLimitTimestamp(now: Date): number {
  const timestamp = now.getTime();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new HttpsError("internal", "Report export rate limit is unavailable");
  }
  return timestamp;
}

export function createAggregateReportExportRateLimitKey(
  academyId: string,
  actorId: string,
): string {
  return createHash("sha256")
    .update(academyId.length + ":" + academyId + actorId.length + ":" + actorId, "utf8")
    .digest("hex");
}

export type AggregateReportExportRateLimiter = Readonly<{
  consume: (input: Readonly<{ academyId: string; actorId: string; now: Date }>) => Promise<void>;
}>;

type RateLimitDocument = Readonly<{
  exists: boolean;
  data: () => Readonly<Record<string, unknown>> | undefined;
}>;
type RateLimitReference = Readonly<{ id: string }>;
type RateLimitTransaction = Readonly<{
  get: (reference: RateLimitReference) => Promise<RateLimitDocument>;
  set: (reference: RateLimitReference, value: Readonly<Record<string, unknown>>) => unknown;
}>;
type RateLimitFirestore = Readonly<{
  collection: (path: string) => Readonly<{
    doc: (id: string) => RateLimitReference;
  }>;
  runTransaction: <T>(callback: (transaction: RateLimitTransaction) => Promise<T>) => Promise<T>;
}>;

export function createMemoryAggregateReportExportRateLimiter(
  options: {
    maxRequests?: number;
    windowMs?: number;
  } = {},
): AggregateReportExportRateLimiter {
  const maxRequests = options.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    async consume({ academyId, actorId, now }) {
      assertSafeActorScope(academyId, actorId);
      const key = createAggregateReportExportRateLimitKey(academyId, actorId);
      const timestamp = rateLimitTimestamp(now);
      const current = windows.get(key);
      if (current && timestamp >= current.startedAt && timestamp - current.startedAt < windowMs) {
        if (current.count >= maxRequests) {
          throw new HttpsError("resource-exhausted", "Report export is temporarily unavailable");
        }
        current.count += 1;
        return;
      }
      windows.set(key, { startedAt: timestamp, count: 1 });
    },
  };
}

export function createFirestoreAggregateReportExportRateLimiter(
  firestore: RateLimitFirestore,
  options: { maxRequests?: number; windowMs?: number } = {},
): AggregateReportExportRateLimiter {
  const maxRequests = options.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  return {
    async consume({ academyId, actorId, now }) {
      assertSafeActorScope(academyId, actorId);
      const actorKey = createAggregateReportExportRateLimitKey(academyId, actorId);
      const reference = firestore
        .collection("academies/" + academyId + "/exportRateLimits")
        .doc(actorKey);
      const nowMs = rateLimitTimestamp(now);
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const value = snapshot.exists ? snapshot.data() : undefined;
        if (
          snapshot.exists &&
          (value?.academyId !== academyId ||
            value.actorKey !== actorKey ||
            value.schemaVersion !== 1 ||
            typeof value?.startedAt !== "number" ||
            !Number.isSafeInteger(value.startedAt) ||
            value.startedAt < 0 ||
            value.startedAt > nowMs ||
            typeof value.count !== "number" ||
            !Number.isSafeInteger(value.count) ||
            value.count < 1 ||
            typeof value.updatedAt !== "number" ||
            !Number.isSafeInteger(value.updatedAt) ||
            value.updatedAt < value.startedAt ||
            value.updatedAt > nowMs)
        ) {
          throw new HttpsError("internal", "Report export rate limit is unavailable");
        }
        const startedAt = typeof value?.startedAt === "number" ? value.startedAt : nowMs;
        const count = typeof value?.count === "number" ? value.count : 0;
        if (nowMs - startedAt < windowMs && count >= maxRequests) {
          throw new HttpsError("resource-exhausted", "Report export is temporarily unavailable");
        }
        transaction.set(
          reference,
          nowMs - startedAt < windowMs
            ? {
                academyId,
                actorKey,
                startedAt,
                count: count + 1,
                updatedAt: nowMs,
                schemaVersion: 1,
              }
            : {
                academyId,
                actorKey,
                startedAt: nowMs,
                count: 1,
                updatedAt: nowMs,
                schemaVersion: 1,
              },
        );
      });
    },
  };
}

type AggregateReportExporter = Readonly<{
  prepare: (input: {
    academyId: string;
    actorId: string;
    request: AggregateReportExportRequest;
  }) => Promise<AggregateReportExportResponse>;
}>;

export function createPrepareAggregateReportExportHandler(options: {
  exporter: AggregateReportExporter;
  rateLimiter: AggregateReportExportRateLimiter;
  pilotEnabled: boolean;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ export: AggregateReportExportResponse }> => {
    const actor = requireUserActor(request);
    if (!exportRoles.includes(actor.role as (typeof exportRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Owner or administrator access required to prepare aggregate exports",
      );
    }
    assertSafeActorScope(actor.academyId, actor.userId);
    if (!options.pilotEnabled) {
      throw new HttpsError(
        "failed-precondition",
        "Aggregate exports are available only in the controlled synthetic pilot",
      );
    }

    const parsed = parseAggregateReportExportRequest(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", "Invalid aggregate export request");
    }

    const current = now();
    await options.rateLimiter.consume({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: current,
    });

    try {
      return {
        export: await options.exporter.prepare({
          academyId: actor.academyId,
          actorId: actor.userId,
          request: parsed.value,
        }),
      };
    } catch (error) {
      if (error instanceof AggregateReportExportServiceError) {
        if (error.code === "tenant") {
          throw new HttpsError("permission-denied", "Aggregate export tenant scope is invalid");
        }
        if (error.code === "limit") {
          throw new HttpsError("resource-exhausted", "Aggregate export exceeds the allowed size");
        }
      }
      throw new HttpsError("internal", "Unable to prepare aggregate report export");
    }
  };
}

let defaultExporter: AggregateReportExporter | undefined;
let defaultRateLimiter: AggregateReportExportRateLimiter | undefined;

function getDefaultServices(): {
  exporter: AggregateReportExporter;
  rateLimiter: AggregateReportExportRateLimiter;
} {
  if (!defaultExporter || !defaultRateLimiter) {
    const firestore = getFirestore();
    const levelStore = createLevelCatalogStore({
      firestore: firestore as unknown as Parameters<typeof createLevelCatalogStore>[0]["firestore"],
    });
    const operationalStore = createFirestoreOperationalReportStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreOperationalReportStore
      >[0]["firestore"],
    });
    const progressStore = createFirestoreProgressReportStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreProgressReportStore
      >[0]["firestore"],
      levelStore,
    });
    defaultExporter = createAggregateReportExportService({
      firestore: firestore as unknown as Parameters<
        typeof createAggregateReportExportService
      >[0]["firestore"],
      operationalStore,
      progressStore,
      auditWriter: appendAuditEventInTransaction,
      serverTimestamp: () => FieldValue.serverTimestamp(),
    });
    defaultRateLimiter = createFirestoreAggregateReportExportRateLimiter(
      firestore as unknown as RateLimitFirestore,
    );
  }
  return { exporter: defaultExporter, rateLimiter: defaultRateLimiter };
}

export const prepareAggregateReportExport = onCall(
  {
    enforceAppCheck: true,
    consumeAppCheckToken: false,
  },
  async (request) => {
    const services = getDefaultServices();
    return createPrepareAggregateReportExportHandler({
      ...services,
      pilotEnabled: process.env.BPT_SYNTHETIC_PILOT === "true",
    })(request);
  },
);
