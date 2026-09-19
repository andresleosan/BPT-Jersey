import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import {
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
