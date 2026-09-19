import { beforeEach, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({ callable: vi.fn(), httpsCallable: vi.fn() }));
vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import {
  decideMemberMigration,
  listMemberMigrationQueue,
  memberMigrationErrorMessage,
} from "./member-migration-client";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.httpsCallable.mockReturnValue(mocks.callable);
});

it("rejects empty and oversized decisions before calling Firebase", () => {
  expect(() => decideMemberMigration([])).toThrow(ZodError);
  expect(() =>
    decideMemberMigration(
      Array.from({ length: 51 }, () => ({
        kind: "skip",
        legacyMemberId: "m1",
        reason: "Duplicate",
      })),
    ),
  ).toThrow(ZodError);
  expect(mocks.httpsCallable).not.toHaveBeenCalled();
});

it("lists with null and validates the response", async () => {
  const queue = { rows: [], archiveOnly: 2, decided: 1 };
  mocks.callable
    .mockResolvedValueOnce({ data: queue })
    .mockResolvedValueOnce({ data: { rows: "wrong" } });
  await expect(listMemberMigrationQueue()).resolves.toEqual(queue);
  expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "listMemberMigrationQueue");
  expect(mocks.callable).toHaveBeenCalledWith(null);
  await expect(listMemberMigrationQueue()).rejects.toThrow(ZodError);
});

it("wraps decisions and validates decision results", async () => {
  const decisions = [{ kind: "skip" as const, legacyMemberId: "m1", reason: "Duplicate" }];
  const result = { results: [{ legacyMemberId: "m1", status: "applied" }] };
  mocks.callable
    .mockResolvedValueOnce({ data: result })
    .mockResolvedValueOnce({ data: { results: [{ status: "unsafe" }] } });
  await expect(decideMemberMigration(decisions)).resolves.toEqual(result);
  expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "decideMemberMigration");
  expect(mocks.callable).toHaveBeenCalledWith({ decisions });
  await expect(decideMemberMigration(decisions)).rejects.toThrow(ZodError);
  expect(memberMigrationErrorMessage("record-already-linked")).toBe(
    "That record already belongs to another member.",
  );
});
