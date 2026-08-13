import { describe, expect, it } from "vitest";
import { parseMemberRecord, type MemberImportPreview } from "@bpt-jersey/domain/members";

import {
  attachMemberImportPreviewSource,
  createMemoryMemberStore,
  createMemberService,
  resolveMemberImportMatch,
  type MemberStore,
} from "./member-service.js";
import type { ParsedMemberRow } from "./member-pdf-import.js";

const member = {
  memberId: "member-1",
  academyId: "academy-1",
  fullName: "Synthetic Member",
  email: "email@example.test",
  paymentStatus: "unknown" as const,
  gender: "unknown" as const,
  membershipStatus: "active" as const,
  createdAt: "2026-08-11T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-11T10:00:00.000Z",
  updatedBy: "admin-1",
  source: "admin",
  schemaVersion: "1" as const,
};

const row: ParsedMemberRow = {
  sourceReport: "total",
  sourceRowNumber: 1,
  fullName: "Synthetic Member",
  email: "email@example.test",
  idCardNumber: "ID-UPDATED",
};

const preview: MemberImportPreview = {
  previewId: "123e4567-e89b-42d3-a456-426614174000",
  expiresAt: "2026-08-11T12:10:00.000Z",
  sourceReports: [{ source: "pdf-1", report: "total", rowCount: 1 }],
  additions: [],
  updates: [],
  duplicates: [],
  conflicts: [],
};

function serviceWith(
  records: readonly unknown[],
  applyImport: MemberStore["applyImport"],
): ReturnType<typeof createMemberService> {
  const store: MemberStore = {
    create: async () => undefined,
    list: async () => records,
    countByReport: async () => 0,
    applyImport,
  };
  return createMemberService(store, { pageTokenSecret: "test-page-token-secret-32-bytes!!" });
}

describe("member import service", () => {
  it("resolves email fallback and rejects ambiguous matches", () => {
    expect(resolveMemberImportMatch(row, [member], "academy-1")).toEqual({
      member,
      ambiguous: false,
    });
    expect(
      resolveMemberImportMatch(row, [member, { ...member, memberId: "member-2" }], "academy-1"),
    ).toEqual({ member: undefined, ambiguous: true });
  });

  it("rejects preview conflicts before calling the atomic store", async () => {
    let calls = 0;
    const service = serviceWith([member], async () => {
      calls += 1;
      return { imported: 0, updated: 0, conflicts: 0 };
    });
    const conflicted = attachMemberImportPreviewSource(
      {
        ...preview,
        conflicts: [{ stableKey: "email:email", rowNumbers: [1], fieldNames: ["email"] }],
      },
      { rows: [row], sourceHash: "a".repeat(64) },
    );

    await expect(
      service.applyImportPreview({
        academyId: "academy-1",
        actorId: "admin-1",
        preview: conflicted,
        now: "2026-08-11T12:00:00.000Z",
        createId: () => "member-2",
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(calls).toBe(0);
  });

  it("passes email-matched updates and derived states only when signaled", async () => {
    let received: Parameters<NonNullable<MemberStore["applyImport"]>>[0] | undefined;
    const service = serviceWith([member], async (input) => {
      received = input;
      return input.result;
    });
    const serverPreview = attachMemberImportPreviewSource(preview, {
      rows: [row],
      sourceHash: "a".repeat(64),
    });
    await expect(
      service.applyImportPreview({
        academyId: "academy-1",
        actorId: "admin-1",
        preview: serverPreview,
        now: "2026-08-11T12:00:00.000Z",
        createId: () => "member-2",
      }),
    ).resolves.toEqual({ imported: 0, updated: 1, conflicts: 0 });
    expect(received?.mutations[0]).toMatchObject({ kind: "update", memberId: "member-1" });
    expect(received?.mutations[0]?.updates).toEqual({ idCardNumber: "ID-UPDATED" });
  });

  it("rolls back every mutation after a mid-import failure and retries idempotently", async () => {
    const store = createMemoryMemberStore([member]);
    store.setFailureAfterWrites(1);
    const service = createMemberService(store, {
      pageTokenSecret: "test-page-token-secret-32-bytes!!",
    });
    const addition: ParsedMemberRow = {
      sourceReport: "total",
      sourceRowNumber: 2,
      fullName: "Synthetic Addition",
    };
    const serverPreview = attachMemberImportPreviewSource(preview, {
      rows: [row, addition],
      sourceHash: "a".repeat(64),
    });
    await expect(
      service.applyImportPreview({
        academyId: "academy-1",
        actorId: "admin-1",
        preview: serverPreview,
        now: "2026-08-11T12:00:00.000Z",
        createId: (() => {
          let count = 0;
          return () => `member-new-${++count}`;
        })(),
      }),
    ).rejects.toThrow(/synthetic member import failure/i);
    await expect(store.list("academy-1", 10)).resolves.toHaveLength(1);
    store.setFailureAfterWrites(undefined);
    await expect(
      service.applyImportPreview({
        academyId: "academy-1",
        actorId: "admin-1",
        preview: serverPreview,
        now: "2026-08-11T12:00:00.000Z",
        createId: () => "member-new-2",
      }),
    ).resolves.toEqual({ imported: 1, updated: 1, conflicts: 0 });
    await expect(store.list("academy-1", 10)).resolves.toHaveLength(2);
    await expect(
      service.applyImportPreview({
        academyId: "academy-1",
        actorId: "admin-1",
        preview: serverPreview,
        now: "2026-08-11T12:00:00.000Z",
        createId: () => "member-new-3",
      }),
    ).resolves.toEqual({ imported: 1, updated: 1, conflicts: 0 });
    await expect(store.list("academy-1", 10)).resolves.toHaveLength(2);
  });

  it("does not apply a second operation with the same ID but a different source hash", async () => {
    const store = createMemoryMemberStore();
    const service = createMemberService(store, {
      pageTokenSecret: "test-page-token-secret-32-bytes!!",
    });
    const rows: ParsedMemberRow[] = [
      { sourceReport: "total", sourceRowNumber: 1, fullName: "Synthetic Member" },
    ];
    const serverPreview = attachMemberImportPreviewSource(preview, {
      rows,
      sourceHash: "a".repeat(64),
    });
    await service.applyImportPreview({
      academyId: "academy-1",
      actorId: "admin-1",
      preview: serverPreview,
      now: "2026-08-11T12:00:00.000Z",
      createId: () => "member-1",
    });
    const changedPreview = attachMemberImportPreviewSource(preview, {
      rows,
      sourceHash: "b".repeat(64),
    });
    await expect(
      service.applyImportPreview({
        academyId: "academy-1",
        actorId: "admin-1",
        preview: changedPreview,
        now: "2026-08-11T12:00:00.000Z",
        createId: () => "member-2",
      }),
    ).rejects.toThrow();
  });

  it("persists the stable import run ID on imported records and remains idempotent", async () => {
    const store = createMemoryMemberStore();
    const service = createMemberService(store, {
      pageTokenSecret: "test-page-token-secret-32-bytes!!",
    });
    const serverPreview = attachMemberImportPreviewSource(preview, {
      rows: [{ sourceReport: "total", sourceRowNumber: 1, fullName: "Imported Member" }],
      sourceHash: "c".repeat(64),
    });
    const input = {
      academyId: "academy-1",
      actorId: "admin-1",
      preview: serverPreview,
      now: "2026-08-11T12:00:00.000Z",
      createId: () => "member-imported-1",
      operationId: "member-pdf-import-stable-operation",
    } as unknown as Parameters<typeof service.applyImportPreview>[0];

    await expect(service.applyImportPreview(input)).resolves.toEqual({
      imported: 1,
      updated: 0,
      conflicts: 0,
    });
    await expect(service.applyImportPreview(input)).resolves.toEqual({
      imported: 1,
      updated: 0,
      conflicts: 0,
    });
    const records = await store.list("academy-1", 10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ importRunId: "member-pdf-import-stable-operation" });
  });

  it("passes the stable operation ID into the import mutation", async () => {
    let receivedOperationId: string | undefined;
    const service = serviceWith([], async (input) => {
      receivedOperationId = input.operationId;
      return input.result;
    });
    const serverPreview = attachMemberImportPreviewSource(preview, {
      rows: [{ sourceReport: "total", sourceRowNumber: 1, fullName: "Imported Member" }],
      sourceHash: "d".repeat(64),
    });

    await service.applyImportPreview({
      academyId: "academy-1",
      actorId: "admin-1",
      preview: serverPreview,
      now: "2026-08-11T12:00:00.000Z",
      createId: () => "member-imported-2",
      operationId: "member-pdf-import-stable-operation-2",
    });

    expect(receivedOperationId).toBe("member-pdf-import-stable-operation-2");
  });

  it("persists the import run ID separately from the operation ID", async () => {
    let received: Parameters<NonNullable<MemberStore["applyImport"]>>[0] | undefined;
    const service = serviceWith([], async (input) => {
      received = input;
      return input.result;
    });
    const serverPreview = attachMemberImportPreviewSource(preview, {
      rows: [{ sourceReport: "total", sourceRowNumber: 1, fullName: "Imported Member" }],
      sourceHash: "g".repeat(64),
    });

    await service.applyImportPreview({
      academyId: "academy-1",
      actorId: "admin-1",
      preview: serverPreview,
      now: "2026-08-11T12:00:00.000Z",
      createId: () => "member-imported-run-id",
      operationId: "member-pdf-import-operation-id",
      importRunId: "member-pdf-import-run-id",
    });

    expect(received?.mutations[0]?.record).toMatchObject({
      source: "member-pdf-import",
      importRunId: "member-pdf-import-run-id",
    });
  });

  it.each(["", " ", "r".repeat(129)])(
    "rejects unsafe import operation IDs before reading or writing: %j",
    async (operationId) => {
      const service = serviceWith([], async () => ({ imported: 0, updated: 0, conflicts: 0 }));
      const serverPreview = attachMemberImportPreviewSource(preview, {
        rows: [{ sourceReport: "total", sourceRowNumber: 1, fullName: "Imported Member" }],
        sourceHash: "e".repeat(64),
      });

      await expect(
        service.applyImportPreview({
          academyId: "academy-1",
          actorId: "admin-1",
          preview: serverPreview,
          now: "2026-08-11T12:00:00.000Z",
          createId: () => "member-imported-invalid-operation",
          operationId,
        }),
      ).rejects.toMatchObject({ code: "failed-precondition" });
    },
  );

  it("revalidates imported records before the memory store writes them", async () => {
    const store = createMemoryMemberStore();
    const invalidRecord = { ...member, importRunId: " " };

    await expect(
      store.applyImport({
        academyId: "academy-1",
        actorId: "admin-1",
        now: "2026-08-11T12:00:00.000Z",
        operationId: "safe-operation",
        sourceHash: "f".repeat(64),
        reportKeys: ["total"],
        mutations: [{ kind: "create", memberId: member.memberId, record: invalidRecord }],
        result: { imported: 1, updated: 0, conflicts: 0 },
      }),
    ).rejects.toThrow(/invalid member record/i);
    await expect(store.list("academy-1", 10)).resolves.toHaveLength(0);
  });

  it("rejects an invalid admin-created record before delegating to the store", async () => {
    let createCalls = 0;
    const store: MemberStore = {
      create: async () => {
        createCalls += 1;
      },
      list: async () => [],
      countByReport: async () => 0,
      applyImport: async () => ({ imported: 0, updated: 0, conflicts: 0 }),
    };
    const service = createMemberService(store, {
      pageTokenSecret: "test-page-token-secret-32-bytes!!",
    });

    await expect(
      service.create({
        academyId: "academy-1",
        actorId: "admin-1",
        memberId: "admin-invalid-1",
        now: "2026-08-11T12:00:00.000Z",
        data: { fullName: "Invalid Admin Member", importRunId: " " } as never,
      }),
    ).rejects.toThrow(/invalid member record/i);
    expect(createCalls).toBe(0);
  });

  it.each([{ importRunId: " " }, { schemaVersion: "2" }])(
    "rejects an invalid record in the memory store before writing: %j",
    async (invalidFields) => {
      const store = createMemoryMemberStore();

      await expect(store.create({ ...member, ...invalidFields } as never)).rejects.toThrow(
        /invalid member record/i,
      );
      await expect(store.list("academy-1", 10)).resolves.toHaveLength(0);
    },
  );

  it("does not attach import metadata to ordinary admin members", async () => {
    const store = createMemoryMemberStore();
    const service = createMemberService(store, {
      pageTokenSecret: "test-page-token-secret-32-bytes!!",
    });

    await service.create({
      academyId: "academy-1",
      actorId: "admin-1",
      memberId: "admin-member-1",
      now: "2026-08-11T12:00:00.000Z",
      data: { fullName: "Ordinary Admin Member" },
    });

    const records = await store.list("academy-1", 10);
    expect(records[0]).not.toHaveProperty("importRunId");
  });

  it("does not expose import rollback metadata in search projections", async () => {
    const service = createMemberService(
      createMemoryMemberStore([{ ...member, importRunId: "member-pdf-run-1" }]),
      { pageTokenSecret: "test-page-token-secret-32-bytes!!" },
    );

    const result = await service.search("academy-1", {});

    expect(result.members).toHaveLength(1);
    expect(result.members[0]).not.toHaveProperty("importRunId");
  });

  it("bounds and validates import run metadata in the domain record contract", () => {
    expect(parseMemberRecord({ ...member, importRunId: "run-1" }).ok).toBe(true);
    expect(parseMemberRecord({ ...member, importRunId: " " })).toEqual({
      ok: false,
      error: expect.arrayContaining([{ path: ["importRunId"], code: "empty_value" }]),
    });
    expect(parseMemberRecord({ ...member, importRunId: "r".repeat(129) })).toEqual({
      ok: false,
      error: expect.arrayContaining([{ path: ["importRunId"], code: "max_length" }]),
    });
  });
});
