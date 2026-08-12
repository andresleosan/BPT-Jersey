import { describe, expect, it } from "vitest";

import {
  createMemoryMemberImportPreviewStore,
  type MemberImportPreviewRecord,
} from "./member-import-storage.js";

const preview: MemberImportPreviewRecord = {
  previewId: "123e4567-e89b-42d3-a456-426614174000",
  sessionId: "session-1",
  academyId: "academy-1",
  actorId: "admin-1",
  expiresAt: "2026-08-11T12:10:00.000Z",
  sourceHash: "a".repeat(64),
  reportKeys: ["total"],
  preview: {
    previewId: "123e4567-e89b-42d3-a456-426614174000",
    expiresAt: "2026-08-11T12:10:00.000Z",
    sourceReports: [{ source: "members.pdf", report: "total", rowCount: 1 }],
    additions: [],
    updates: [],
    duplicates: [],
    conflicts: [],
  },
  status: "pending",
};

describe("member import preview storage", () => {
  it("persists and removes preview records idempotently", async () => {
    const store = createMemoryMemberImportPreviewStore();

    await store.save(preview);
    await expect(store.get(preview.previewId)).resolves.toEqual(preview);
    await store.remove(preview.previewId);
    await store.remove(preview.previewId);

    await expect(store.get(preview.previewId)).resolves.toBeUndefined();
  });

  it("rejects raw extracted text and invalid tenant metadata", async () => {
    const store = createMemoryMemberImportPreviewStore();

    await expect(store.save({ ...preview, rawText: "secret row" } as never)).rejects.toThrow(
      /preview record/i,
    );
    await expect(store.save({ ...preview, academyId: "" })).rejects.toThrow(/preview record/i);
    await expect(store.save({ ...preview, reportKeys: ["unsupported"] } as never)).rejects.toThrow(
      /preview record/i,
    );
  });

  it("requires matching expiry and bounded preview collections and strings", async () => {
    const store = createMemoryMemberImportPreviewStore();

    await expect(
      store.save({
        ...preview,
        expiresAt: "2026-08-11T12:11:00.000Z",
      }),
    ).rejects.toThrow(/preview record/i);
    await expect(
      store.save({
        ...preview,
        reportKeys: ["total", "active", "withNumber", "noNumber", "inactive", "suspended"],
      }),
    ).rejects.toThrow(/preview record/i);
    await expect(
      store.save({
        ...preview,
        preview: {
          ...preview.preview,
          sourceReports: Array.from({ length: 6 }, (_, index) => ({
            source: `pdf-${index + 1}`,
            report: "total" as const,
            rowCount: 1,
          })),
        },
      }),
    ).rejects.toThrow(/preview record/i);
    await expect(
      store.save({
        ...preview,
        previewId: "x".repeat(129),
        preview: { ...preview.preview, previewId: "x".repeat(129) },
      }),
    ).rejects.toThrow(/preview record/i);
  });

  it("invalidates previews durably and lists only bounded expired records", async () => {
    const store = createMemoryMemberImportPreviewStore();

    await store.save(preview);
    await store.invalidate(preview.previewId);
    await expect(store.get(preview.previewId)).resolves.toMatchObject({ status: "expired" });
    await expect(store.listExpired("2026-08-11T12:11:00.000Z", 5)).resolves.toEqual([]);

    await store.save({
      ...preview,
      previewId: "123e4567-e89b-42d3-a456-426614174001",
      preview: {
        ...preview.preview,
        previewId: "123e4567-e89b-42d3-a456-426614174001",
        expiresAt: "2026-08-11T11:00:00.000Z",
      },
      expiresAt: "2026-08-11T11:00:00.000Z",
      status: "pending",
    });
    await expect(store.listExpired("2026-08-11T12:00:00.000Z", 5)).resolves.toHaveLength(1);
  });

  it("fails closed when the bounded expired preview result exceeds its limit", async () => {
    const store = createMemoryMemberImportPreviewStore();
    for (const suffix of ["1", "2"]) {
      await store.save({
        ...preview,
        previewId: `123e4567-e89b-42d3-a456-42661417400${suffix}`,
        preview: {
          ...preview.preview,
          previewId: `123e4567-e89b-42d3-a456-42661417400${suffix}`,
          expiresAt: "2026-08-11T11:00:00.000Z",
        },
        expiresAt: "2026-08-11T11:00:00.000Z",
      });
    }

    await expect(store.listExpired("2026-08-11T12:00:00.000Z", 1)).rejects.toThrow(
      /too large|limit/i,
    );
  });

  it("confirms a pending preview conditionally and returns one durable result to concurrent callers", async () => {
    const store = createMemoryMemberImportPreviewStore();
    const result = { imported: 0, updated: 0, conflicts: 0 };
    await store.save(preview);

    const confirmations = await Promise.all([
      store.confirmIfPending({
        previewId: preview.previewId,
        operationId: preview.previewId,
        sessionId: preview.sessionId,
        academyId: preview.academyId,
        actorId: preview.actorId,
        sourceHash: preview.sourceHash,
        result,
      }),
      store.confirmIfPending({
        previewId: preview.previewId,
        operationId: preview.previewId,
        sessionId: preview.sessionId,
        academyId: preview.academyId,
        actorId: preview.actorId,
        sourceHash: preview.sourceHash,
        result,
      }),
    ]);

    expect(confirmations).toEqual([result, result]);
    await expect(store.get(preview.previewId)).resolves.toMatchObject({
      status: "confirmed",
      result,
    });
  });

  it("rejects a different result when a preview is already confirmed", async () => {
    const store = createMemoryMemberImportPreviewStore();
    await store.save(preview);
    const input = {
      previewId: preview.previewId,
      operationId: preview.previewId,
      sessionId: preview.sessionId,
      academyId: preview.academyId,
      actorId: preview.actorId,
      sourceHash: preview.sourceHash,
      result: { imported: 0, updated: 0, conflicts: 0 },
    } as const;
    await store.confirmIfPending(input);

    await expect(
      store.confirmIfPending({ ...input, result: { imported: 1, updated: 0, conflicts: 0 } }),
    ).rejects.toThrow(/result|inconsistent/i);
  });

  it("does not expose a confirmed result until the conditional transition completes", async () => {
    const store = createMemoryMemberImportPreviewStore();
    await store.save(preview);
    const result = { imported: 1, updated: 0, conflicts: 0 };
    await expect(store.get(preview.previewId)).resolves.toMatchObject({ status: "pending" });
    await expect(
      store.confirmIfPending({
        previewId: preview.previewId,
        operationId: preview.previewId,
        sessionId: preview.sessionId,
        academyId: preview.academyId,
        actorId: preview.actorId,
        sourceHash: preview.sourceHash,
        result,
      }),
    ).resolves.toEqual(result);
    await expect(store.get(preview.previewId)).resolves.toMatchObject({
      status: "confirmed",
      result,
    });
  });
});
