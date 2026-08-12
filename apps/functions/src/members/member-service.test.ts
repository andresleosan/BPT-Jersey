import { describe, expect, it } from "vitest";
import type { MemberImportPreview } from "@bpt-jersey/domain";

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
});
