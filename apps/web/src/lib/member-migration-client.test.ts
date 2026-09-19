import { beforeEach, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({ callable: vi.fn(), httpsCallable: vi.fn() }));
vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import {
  assignMemberGuardian,
  setMemberDateOfBirth,
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

it("explains how to resolve invalid member identifiers", async () => {
  const result = { results: [{ legacyMemberId: "m1", status: "rejected", code: "invalid-member-data" }] };
  mocks.callable.mockResolvedValueOnce({ data: result });
  await expect(decideMemberMigration([{ kind: "skip", legacyMemberId: "m1", reason: "Duplicate" }])).resolves.toEqual(result);
  expect(memberMigrationErrorMessage("invalid-member-data")).toBe("This member's ID or member number is not in a format the directory accepts. Correct the legacy record or skip.");
});


it("validates review responses and sanitizes SDK and validation failures", async () => {
  const input = { studentId: "s1", requestId: "71cbb1aa-7020-4bb5-88a4-dbc73c5f0123", guardianContact: { fullName: "Synthetic Guardian", email: "guardian@example.test" } };
  mocks.callable.mockResolvedValueOnce({ data: { studentId: "s1" } }).mockRejectedValueOnce(new Error("Private SDK contact"));
  await expect(assignMemberGuardian(input)).resolves.toEqual({ studentId: "s1" });
  expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "assignMemberGuardian");
  await expect(assignMemberGuardian(input)).rejects.toThrow("Could not assign the guardian. Please try again.");
  mocks.callable.mockResolvedValue({ data: { unexpected: true } });
  await expect(setMemberDateOfBirth({ studentId: "s1", requestId: input.requestId, dateOfBirth: "2014-01-01" })).rejects.toThrow("Could not set the date of birth. Please try again.");
});
