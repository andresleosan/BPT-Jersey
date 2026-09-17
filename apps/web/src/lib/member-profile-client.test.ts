import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getFirebaseFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

vi.mock("./firebase-client", () => ({ getFirebaseFunctions: mocks.getFirebaseFunctions }));
vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));

import {
  MemberDetailsConflictError,
  MemberRecordLoadError,
  getMemberProfile,
  isMemberRecordId,
  saveMemberDetails,
  searchMemberNames,
} from "./member-profile-client";

const coachProfile = {
  view: "coach",
  header: {
    studentId: "student-1",
    fullName: "Test Member A",
    age: 26,
    participantType: "adult",
    status: "active",
    birthdayBadge: { kind: "today" },
  },
} as const;

const detailsInput = {
  studentId: "student-1",
  requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
  fullName: "Test Member A",
  dateOfBirth: "2000-09-17",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  gender: "unknown",
  membershipNumber: " 0000 ",
  details: { healthNumber: " hn0000 ", howHeard: "Website" },
} as const;

describe("member profile web client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  it("validates the record id before any call", async () => {
    expect(isMemberRecordId("student-1")).toBe(true);
    for (const bad of [null, "", "../student", "a/b", "x".repeat(129), "student 1"]) {
      expect(isMemberRecordId(bad)).toBe(false);
    }
    await expect(getMemberProfile("../student")).rejects.toThrow(
      "This member record link is not valid.",
    );
    expect(mocks.httpsCallable).not.toHaveBeenCalled();
  });

  it("parses the role-trimmed response and refuses anything extra", async () => {
    mocks.callable.mockResolvedValue({ data: coachProfile });
    await expect(getMemberProfile("student-1")).resolves.toEqual(coachProfile);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "getMemberProfile");
    expect(mocks.callable).toHaveBeenCalledWith({ studentId: "student-1" });

    mocks.callable.mockResolvedValue({
      data: { ...coachProfile, header: { ...coachProfile.header, dateOfBirth: "2000-09-17" } },
    });
    await expect(getMemberProfile("student-1")).rejects.toThrow(
      "Unable to load this member record. Please try again.",
    );
  });

  it("refuses a well-formed record that belongs to another member", async () => {
    mocks.callable.mockResolvedValue({
      data: { ...coachProfile, header: { ...coachProfile.header, studentId: "student-2" } },
    });
    const error = await getMemberProfile("student-1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MemberRecordLoadError);
    expect((error as Error).message).toBe("Unable to load this member record. Please try again.");
  });

  it("maps callable failures to fixed, safe messages", async () => {
    for (const [code, message] of [
      ["functions/not-found", "This member record was not found."],
      ["functions/permission-denied", "You do not have access to this member record."],
      [
        "functions/resource-exhausted",
        "Too many member records opened in a few minutes. Wait a moment and try again.",
      ],
      ["functions/internal", "Unable to load this member record. Please try again."],
    ] as const) {
      mocks.callable.mockRejectedValueOnce({ code, message: "raw backend detail student-1" });
      const error = await getMemberProfile("student-1").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(message);
    }
  });

  it("saves DETAILS through updateMember with the normalised payload", async () => {
    mocks.callable.mockResolvedValue({ data: { memberId: "student-1", studentId: "student-1" } });
    await expect(saveMemberDetails(detailsInput)).resolves.toBeUndefined();
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "updateMember");
    expect(mocks.callable).toHaveBeenCalledWith({
      ...detailsInput,
      membershipNumber: "0000",
      details: { healthNumber: "HN0000", howHeard: "Website" },
    });
  });

  it("names a member number conflict and hides every other failure", async () => {
    mocks.callable.mockRejectedValueOnce({ code: "functions/already-exists" });
    await expect(saveMemberDetails(detailsInput)).rejects.toBeInstanceOf(
      MemberDetailsConflictError,
    );
    mocks.callable.mockRejectedValueOnce({ code: "functions/internal", message: "raw" });
    await expect(saveMemberDetails(detailsInput)).rejects.toThrow(
      "Unable to save member details. Please try again.",
    );
    mocks.callable.mockReset();
    await expect(
      saveMemberDetails({ ...detailsInput, details: { howHeard: "Pigeon" } } as never),
    ).rejects.toThrow("Unable to save member details. Please try again.");
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("says a rate-limited save only needs waiting", async () => {
    mocks.callable.mockRejectedValueOnce({ code: "functions/resource-exhausted" });
    await expect(saveMemberDetails(detailsInput)).rejects.toThrow(
      "Too many member changes in a few minutes. Wait a moment and try again.",
    );
  });

  it("searches by name only from two characters and parses the rows", async () => {
    await expect(searchMemberNames(" t ")).resolves.toEqual([]);
    expect(mocks.httpsCallable).not.toHaveBeenCalled();

    mocks.callable.mockResolvedValue({
      data: { members: [{ studentId: "student-1", fullName: "Test Member A" }] },
    });
    await expect(searchMemberNames(" test ")).resolves.toEqual([
      { studentId: "student-1", fullName: "Test Member A" },
    ]);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "searchMemberNames");
    expect(mocks.callable).toHaveBeenCalledWith({ query: "test" });

    mocks.callable.mockResolvedValue({
      data: { members: [{ studentId: "student-1", fullName: "Test", email: "a@example.test" }] },
    });
    await expect(searchMemberNames("test")).rejects.toThrow(
      "Unable to search members. Please try again.",
    );
  });
});
