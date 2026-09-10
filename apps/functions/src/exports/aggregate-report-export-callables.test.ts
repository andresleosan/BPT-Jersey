import { describe, expect, it, vi } from "vitest";
import {
  aggregateReportExportClassification,
  aggregateReportExportContentType,
  aggregateReportExportScope,
  type AggregateReportExportResponse,
} from "@bpt-jersey/domain/exports";

import {
  createAggregateReportExportRateLimitKey,
  createFirestoreAggregateReportExportRateLimiter,
  createMemoryAggregateReportExportRateLimiter,
  createPrepareAggregateReportExportHandler,
} from "./aggregate-report-export-callables.js";

const requestData = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
  purpose: "pilot_operations_review",
} as const;
const content = "section,metric,segment,value,unit\r\n";
const preparedExport: AggregateReportExportResponse = {
  exportId: "report-export-1",
  fileName: "bpt-aggregate-report-2026-08-01-to-2026-08-31.csv",
  contentType: aggregateReportExportContentType,
  content,
  byteLength: new TextEncoder().encode(content).byteLength,
  contentSha256: "a".repeat(64),
  expiresAt: "2026-08-31T23:10:00.000Z",
  purpose: "pilot_operations_review",
  scope: aggregateReportExportScope,
  classification: aggregateReportExportClassification,
  query: {
    from: requestData.from,
    to: requestData.to,
  },
};

function request(
  data: unknown,
  role = "owner",
  uid: string | null = "owner-1",
  academyId = "academy-1",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    data,
  } as never;
}

function harness(pilotEnabled = true) {
  const exporter = {
    prepare: vi.fn(async () => preparedExport),
  };
  const rateLimiter = {
    consume: vi.fn(async () => undefined),
  };
  const handler = createPrepareAggregateReportExportHandler({
    exporter,
    rateLimiter,
    pilotEnabled,
    now: () => new Date("2026-08-31T23:00:00.000Z"),
  });
  return { handler, exporter, rateLimiter };
}

describe("aggregate report export callable", () => {
  it("allows owner and administrator and derives tenant plus recipient actor", async () => {
    for (const role of ["owner", "administrator"]) {
      const current = harness();

      await expect(current.handler(request(requestData, role))).resolves.toEqual({
        export: preparedExport,
      });
      expect(current.rateLimiter.consume).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "owner-1",
        now: new Date("2026-08-31T23:00:00.000Z"),
      });
      expect(current.exporter.prepare).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "owner-1",
        request: requestData,
      });
    }
  });

  it("fails closed outside the synthetic pilot before consuming capacity", async () => {
    const current = harness(false);

    await expect(current.handler(request(requestData))).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect(current.rateLimiter.consume).not.toHaveBeenCalled();
    expect(current.exporter.prepare).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, unauthorized, expanded, or invalid-purpose requests", async () => {
    const current = harness();

    await expect(current.handler(request(requestData, "coach"))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(current.handler(request(requestData, "owner", null))).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      current.handler(request(requestData, "owner", "owner-1", "academy-1/exports")),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      current.handler(request({ ...requestData, recipient: "external@example.test" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      current.handler(request({ ...requestData, purpose: "all_member_records" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.exporter.prepare).not.toHaveBeenCalled();
  });

  it("does not leak backend details", async () => {
    const current = harness();
    current.exporter.prepare.mockRejectedValue(
      new Error("private-student-id failed at secret collection"),
    );

    await expect(current.handler(request(requestData))).rejects.toMatchObject({
      code: "internal",
      message: "Unable to prepare aggregate report export",
    });
  });
});

describe("aggregate report export rate limit", () => {
  it("uses collision-safe actor and academy keys", () => {
    expect(createAggregateReportExportRateLimitKey("academy:a", "owner")).not.toBe(
      createAggregateReportExportRateLimitKey("academy", "a:owner"),
    );
  });

  it("limits repeated in-memory requests within the window and resets afterwards", async () => {
    const limiter = createMemoryAggregateReportExportRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
    });

    await limiter.consume({
      academyId: "academy-1",
      actorId: "owner-1",
      now: new Date("2026-08-31T23:00:00.000Z"),
    });
    await expect(
      limiter.consume({
        academyId: "academy-1",
        actorId: "owner-1",
        now: new Date("2026-08-31T23:00:30.000Z"),
      }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    await expect(
      limiter.consume({
        academyId: "academy-1",
        actorId: "owner-1",
        now: new Date("2026-08-31T23:01:00.000Z"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      limiter.consume({
        academyId: "academy-1",
        actorId: "owner-1",
        now: new Date("invalid"),
      }),
    ).rejects.toMatchObject({ code: "internal" });
  });

  it("persists a valid counter and fails closed on malformed durable state", async () => {
    let stored: Record<string, unknown> | undefined;
    let collectionPath: string | undefined;
    const firestore = {
      collection: (path: string) => {
        collectionPath = path;
        return {
          doc: (id: string) => ({ id }),
        };
      },
      runTransaction: async (
        callback: (transaction: {
          get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
          set: (_ref: { id: string }, value: Record<string, unknown>) => void;
        }) => Promise<void>,
      ) =>
        callback({
          get: async () => ({ exists: stored !== undefined, data: () => stored }),
          set: (_ref, value) => {
            stored = value;
          },
        }),
    };
    const limiter = createFirestoreAggregateReportExportRateLimiter(firestore as never, {
      maxRequests: 2,
      windowMs: 60_000,
    });
    const input = {
      academyId: "academy-1",
      actorId: "owner-1",
      now: new Date("2026-08-31T23:00:00.000Z"),
    };

    await limiter.consume(input);
    const actorKey = createAggregateReportExportRateLimitKey(input.academyId, input.actorId);
    expect(collectionPath).toBe("academies/academy-1/exportRateLimits");
    expect(stored).toEqual({
      academyId: "academy-1",
      actorKey,
      startedAt: input.now.getTime(),
      count: 1,
      updatedAt: input.now.getTime(),
      schemaVersion: 1,
    });
    await limiter.consume({ ...input, now: new Date("2026-08-31T23:00:30.000Z") });
    await expect(
      limiter.consume({ ...input, now: new Date("2026-08-31T23:00:45.000Z") }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });

    stored = { startedAt: "invalid", count: 1 };
    await expect(limiter.consume(input)).rejects.toMatchObject({ code: "internal" });
  });
});
