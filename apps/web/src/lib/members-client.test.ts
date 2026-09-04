import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getFirebaseFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: mocks.getFirebaseFunctions,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable,
}));

import {
  createMember,
  getMemberDetail,
  listMembers,
  lookupMemberIdentity,
  updateMember,
} from "./members-client";

const row = {
  studentId: "student-1",
  fullName: "Synthetic Adult",
  trainingCenter: "Town" as const,
  participantType: "adult" as const,
  active: true,
  status: "active" as const,
  membershipReference: "****0001",
};

const createInput = {
  requestId: "request-1",
  membershipNumber: " bpt 00000001 ",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-01-02",
  phoneNumber: "+44 7000 000000",
  email: "adult@example.test",
  trainingCenter: "Town" as const,
  trainingTimePreferences: ["evening" as const],
  gender: "unknown" as const,
  frequencyNote: "Twice weekly",
};

const updateInput = {
  studentId: "student-1",
  requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
  fullName: "Updated Adult",
  dateOfBirth: "1990-01-02",
  trainingCenter: "West" as const,
  trainingTimePreferences: ["morning" as const],
  membershipNumber: " new 0001 ",
  gender: "female" as const,
};

describe("canonical members web client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.getFirebaseFunctions.mockClear();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  it("sends the strict canonical creation payload and requires matching student aliases", async () => {
    mocks.callable.mockResolvedValue({
      data: { memberId: "student-1", studentId: "student-1" },
    });

    await expect(createMember(createInput)).resolves.toEqual({
      memberId: "student-1",
      studentId: "student-1",
    });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "createMember");
    expect(mocks.callable).toHaveBeenCalledWith({
      ...createInput,
      membershipNumber: "BPT 00000001",
    });

    mocks.callable.mockResolvedValue({
      data: { memberId: "legacy-1", studentId: "student-1" },
    });
    await expect(createMember(createInput)).rejects.toThrow(
      "Unable to create member. Please try again.",
    );
  });

  it("rejects malformed creation data before invoking Firebase", async () => {
    await expect(
      createMember({ ...createInput, unexpected: "blocked" } as never),
    ).rejects.toThrow("Unable to create member. Please try again.");
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("sends a strict full-replacement update and binds both public aliases", async () => {
    mocks.callable.mockResolvedValue({
      data: { memberId: "student-1", studentId: "student-1" },
    });

    await expect(updateMember(updateInput)).resolves.toEqual({
      memberId: "student-1",
      studentId: "student-1",
    });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "updateMember");
    expect(mocks.callable).toHaveBeenCalledWith({
      ...updateInput,
      membershipNumber: "NEW 0001",
    });

    mocks.callable.mockResolvedValue({
      data: { memberId: "student-other", studentId: "student-other" },
    });
    await expect(updateMember(updateInput)).rejects.toThrow(
      "Unable to update member. Please try again.",
    );
  });

  it("lists only minimized rows with an opaque continuation cursor", async () => {
    mocks.callable.mockResolvedValue({
      data: { rows: [row], nextCursor: "signed-cursor" },
    });

    await expect(listMembers(20, "prior-cursor")).resolves.toEqual({
      rows: [row],
      nextCursor: "signed-cursor",
    });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "listMembers");
    expect(mocks.callable).toHaveBeenCalledWith({
      pageSize: 20,
      cursor: "prior-cursor",
    });

    mocks.callable.mockResolvedValue({
      data: { rows: [{ ...row, email: "private@example.test" }] },
    });
    await expect(listMembers()).rejects.toThrow(
      "Unable to load members. Please try again.",
    );
  });

  it("binds restricted detail to its closed purpose and validates the response", async () => {
    const detail = {
      studentId: row.studentId,
      fullName: row.fullName,
      trainingCenter: row.trainingCenter,
      participantType: row.participantType,
      active: row.active,
      status: row.status,
      dateOfBirth: "1990-01-02",
      phoneNumber: "+44 7000 000000",
      email: "adult@example.test",
      trainingTimePreferences: ["evening"],
      membershipNumber: "BPT 00000001",
      idCardNumber: "ID-0001",
      vatNumber: "VAT-0001",
      gender: "unknown",
      frequencyNote: "Twice weekly",
    };
    mocks.callable.mockResolvedValue({ data: detail });

    await expect(getMemberDetail("student-1")).resolves.toEqual(detail);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "getMemberDetail");
    expect(mocks.callable).toHaveBeenCalledWith({
      studentId: "student-1",
      purpose: "member-record-maintenance",
    });

    mocks.callable.mockResolvedValue({ data: { ...detail, source: "admin" } });
    await expect(getMemberDetail("student-1")).rejects.toThrow(
      "Unable to load member details. Please try again.",
    );
  });

  it("performs exact identity lookup without accepting echoed identifiers", async () => {
    mocks.callable.mockResolvedValueOnce({ data: { matched: false } });
    await expect(
      lookupMemberIdentity("membership-number", "BPT 00000001"),
    ).resolves.toEqual({ matched: false });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "lookupMemberIdentity");
    expect(mocks.callable).toHaveBeenCalledWith({
      lookupKind: "membership-number",
      value: "BPT 00000001",
      purpose: "member-identity-lookup",
    });

    mocks.callable.mockResolvedValueOnce({ data: { matched: true, row } });
    await expect(
      lookupMemberIdentity("membership-number", "BPT 00000001"),
    ).resolves.toEqual({ matched: true, row });

    mocks.callable.mockResolvedValueOnce({
      data: { matched: true, row, membershipNumber: "BPT 00000001" },
    });
    await expect(
      lookupMemberIdentity("membership-number", "BPT 00000001"),
    ).rejects.toThrow("Unable to find member. Please try again.");
  });

  it("sanitizes callable failures and invalid bounds", async () => {
    mocks.callable.mockRejectedValue(new Error("private Firebase stack detail"));
    await expect(listMembers()).rejects.toThrow(
      "Unable to load members. Please try again.",
    );
    await expect(listMembers()).rejects.not.toThrow("private Firebase stack detail");
    await expect(listMembers(51)).rejects.toThrow(
      "Unable to load members. Please try again.",
    );
  });
});
