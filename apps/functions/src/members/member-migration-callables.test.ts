import { describe, expect, it, vi } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
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
