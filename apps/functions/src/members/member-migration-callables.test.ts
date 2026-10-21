import { describe, expect, it, vi } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import {
  legacyReadsEliminatedReason,
  legacyRegistrationClosedMessage,
  memberMigrationClosedMessage,
} from "@bpt-jersey/domain/members/migration";
import { CanonicalMemberDirectoryError } from "./canonical-member-directory-service.js";
import {
  reviewMemberHandler,
  decideMemberMigrationHandler,
  listMemberMigrationQueueHandler,
} from "./member-migration-callables.js";
import { MemberMigrationInputError } from "./member-migration-service.js";

const base = { actorId: "u1", academyId: "a1", active: true, appCheckVerified: true };
const service = {
  listQueue: async () => ({ rows: [], archiveOnly: 0, decided: 0 }),
  decide: async (_actor: unknown, data: unknown) => {
    if (data === "bad") throw new MemberMigrationInputError("x");
    return { results: [] };
  },
};

describe("member migration callables", () => {
  it("lets owner and administrator in and keeps coaches out", async () => {
    await expect(
      listMemberMigrationQueueHandler({ ...base, role: "owner" }, service),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      listMemberMigrationQueueHandler({ ...base, role: "administrator" }, service),
    ).resolves.toBeDefined();
    await expect(
      listMemberMigrationQueueHandler({ ...base, role: "headCoach" }, service),
    ).rejects.toBeInstanceOf(HttpsError);
  });
  it("maps invalid input to invalid-argument", async () => {
    await expect(
      decideMemberMigrationHandler({ ...base, role: "owner" }, "bad", service),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("member migration once legacy reads are eliminated (2026-10-20 capacity prep, part 2)", () => {
  const owner = { ...base, role: "owner" as const };
  const failing = (error: Error) => ({
    listQueue: async () => {
      throw error;
    },
    decide: async () => {
      throw error;
    },
  });
  const closedError = new CanonicalMemberDirectoryError(
    "unavailable",
    legacyRegistrationClosedMessage,
    "legacy_reads_eliminated",
  );

  it("says the queue is closed, with a reason a screen recognises, when listing and deciding", async () => {
    const closed = {
      code: "failed-precondition",
      message: memberMigrationClosedMessage,
      details: { reason: legacyReadsEliminatedReason },
    };
    await expect(
      listMemberMigrationQueueHandler(owner, failing(closedError)),
    ).rejects.toMatchObject(closed);
    await expect(
      decideMemberMigrationHandler(owner, { decisions: [] }, failing(closedError)),
    ).rejects.toMatchObject(closed);
  });

  it("keeps an unreadable state a precondition and hides an unexpected failure's detail", async () => {
    const unreadable = new CanonicalMemberDirectoryError(
      "unavailable",
      "Member directory state is unavailable",
    );
    await expect(listMemberMigrationQueueHandler(owner, failing(unreadable))).rejects.toMatchObject(
      {
        code: "failed-precondition",
        message: "Member directory is unavailable",
      },
    );
    await expect(
      listMemberMigrationQueueHandler(owner, failing(new Error("Legacy member m7 does not parse"))),
    ).rejects.toMatchObject({
      code: "internal",
      message: "The migration queue is unavailable. Try again.",
    });
  });

  it("hands back a batch's confirmed results with the closed mark, not as an error", async () => {
    const partial = {
      results: [{ legacyMemberId: "m1", status: "applied" as const, studentId: "s1" }],
      closed: true as const,
    };

    const partialService = { listQueue: vi.fn(), decide: async () => partial };

    await expect(
      decideMemberMigrationHandler(owner, { decisions: [] }, partialService),
    ).resolves.toEqual(partial);
  });

  it("refuses a coach before anything is read", async () => {
    const reader = { listQueue: vi.fn(), decide: vi.fn() };

    await expect(
      listMemberMigrationQueueHandler({ ...base, role: "coach" }, reader),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      decideMemberMigrationHandler({ ...base, role: "coach" }, { decisions: [] }, reader),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(reader.listQueue).not.toHaveBeenCalled();
    expect(reader.decide).not.toHaveBeenCalled();
  });
});

it("validates review payloads, restricts roles and returns safe errors", async () => {
  const writer = { reviewMember: vi.fn().mockResolvedValue({ studentId: "s1" }) };
  const data = {
    studentId: "s1",
    requestId: "71cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
    guardianContact: { fullName: "Synthetic Guardian", phoneNumber: "+441534000099" },
  };
  const now = "2026-09-19T10:00:00.000Z";
  await expect(
    reviewMemberHandler({ ...base, role: "owner" }, data, "assign-guardian", writer, now),
  ).resolves.toEqual({ studentId: "s1" });
  expect(writer.reviewMember).toHaveBeenCalledWith({
    actor: { ...base, role: "owner" },
    value: { ...data, kind: "assign-guardian" },
    now,
  });
  writer.reviewMember.mockClear();
  await expect(
    reviewMemberHandler({ ...base, role: "coach" }, data, "assign-guardian", writer, now),
  ).rejects.toMatchObject({ code: "permission-denied" });
  await expect(
    reviewMemberHandler(
      { ...base, role: "owner" },
      { ...data, academyId: "foreign" },
      "assign-guardian",
      writer,
      now,
    ),
  ).rejects.toMatchObject({ code: "invalid-argument" });
  expect(writer.reviewMember).not.toHaveBeenCalled();
  writer.reviewMember.mockRejectedValue(new Error("Private contact in SDK error"));
  await expect(
    reviewMemberHandler({ ...base, role: "owner" }, data, "assign-guardian", writer, now),
  ).rejects.toMatchObject({
    code: "internal",
    message: "Could not save this review. Please try again.",
  });
});
