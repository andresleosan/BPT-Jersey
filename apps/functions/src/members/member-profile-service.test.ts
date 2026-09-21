import { describe, expect, it } from "vitest";

import type { FamilyRecord, FamilyRelationship } from "@bpt-jersey/domain/families";
import type { StudentAdminProfile } from "@bpt-jersey/domain/members/directory";
import type { MembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import { userDisplayNameOf } from "./member-profile-firestore.js";
import { createMemberProfileService, type MemberProfileStore } from "./member-profile-service.js";

const now = "2026-09-17T09:00:00.000Z";
const audit = {
  schemaVersion: "1",
  createdAt: "2026-01-15T10:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-01-15T10:00:00.000Z",
  updatedBy: "owner-1",
} as const;

function adult(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    studentId: "student-a",
    academyId: "academy-1",
    familyId: "family-a",
    userId: "user-a",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-20",
    email: "member-a@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    ...audit,
    ...overrides,
  } as StudentProfile;
}

// Built explicitly: `exactOptionalPropertyTypes` forbids overriding userId/email with undefined.
function minor(): StudentProfile {
  return {
    studentId: "student-b",
    academyId: "academy-1",
    familyId: "family-b",
    fullName: "Test Member B",
    dateOfBirth: "2016-03-01",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "minor",
    active: true,
    status: "active",
    ...audit,
  } as StudentProfile;
}

const profileA: StudentAdminProfile = {
  studentId: "student-a",
  academyId: "academy-1",
  membershipNumber: "00000000",
  gender: "unknown",
  details: { registeredOn: "2025-12-01", profession: "Tester", heightCm: 175 },
  source: "admin",
  ...audit,
};

function relationship(overrides: Partial<FamilyRelationship> = {}): FamilyRelationship {
  return {
    relationshipId: "family-b--student-b",
    academyId: "academy-1",
    familyId: "family-b",
    studentId: "student-b",
    adultUserId: "guardian-1",
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: "2026-01-01T00:00:00.000Z",
    active: true,
    status: "active",
    ...audit,
    ...overrides,
  } as FamilyRelationship;
}

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "membership-1",
    academyId: "academy-1",
    familyId: "family-a",
    studentId: "student-a",
    planId: "town-adult",
    status: "active",
    startsAt: "2026-02-01T00:00:00.000Z",
    endsAt: "2026-12-31T23:59:59.000Z",
    nextBillingAt: null,
    ...audit,
    ...overrides,
  } as MembershipRecord;
}

function store(overrides: Partial<MemberProfileStore> = {}): MemberProfileStore {
  const family: FamilyRecord = {
    familyId: "family-a",
    academyId: "academy-1",
    primaryContactUserId: "user-a",
    billingContactUserId: "user-a",
    active: true,
    status: "active",
    ...audit,
  };
  return {
    getFamily: async () => family,
    listStudentRelationships: async () => [],
    getUserDisplayName: async (_academyId, userId) =>
      ({ "guardian-1": "Test Guardian", "guardian-2": "Old Guardian", "user-a": "Test Member A" })[
        userId
      ],
    listStudentMemberships: async () => [],
    getPlanDisplayName: async () => "Test Plan",
    listMembershipNumbers: async () => ["00000000", "7", "12"],
    listStudentNames: async () => [],
    ...overrides,
  };
}

describe("member profile service (T051V2)", () => {
  it("builds the full view for office with exactly the agreed keys", async () => {
    const service = createMemberProfileService({
      store: store({
        listStudentMemberships: async () => [
          membership({
            membershipId: "old",
            status: "cancelled",
            startsAt: "2026-03-01T00:00:00.000Z",
          }),
          membership({
            membershipId: "older",
            status: "paused",
            startsAt: "2026-01-01T00:00:00.000Z",
          }),
          membership(),
        ],
      }),
    });

    const profile = await service.fullProfile({
      academyId: "academy-1",
      record: { student: adult(), adminProfile: profileA },
      now,
    });

    expect(Object.keys(profile).sort()).toEqual(["cards", "details", "header", "view"]);
    expect(profile.header).toEqual({
      studentId: "student-a",
      fullName: "Test Member A",
      age: 25,
      participantType: "adult",
      status: "active",
      maskedMemberReference: "****0000",
      birthdayBadge: { kind: "inDays", days: 3 },
    });
    expect(profile.cards).toEqual({
      memberSince: "2025-12-01",
      monthsAsMember: 9,
      profession: "Tester",
      accountManagers: [],
      currentMembership: {
        membershipId: "membership-1",
        planName: "Test Plan",
        status: "active",
        validUntil: "2026-12-31",
      },
    });
    expect(profile.details).toEqual(
      expect.objectContaining({ membershipNumber: "00000000", details: profileA.details }),
    );
  });

  it("keeps historical location server-side and omits it from the ordinary profile response", async () => {
    const historicalProfile: StudentAdminProfile = {
      ...profileA,
      postalAddress: { line: "Historical address", postCode: "JE1 1AA" },
      details: { ...profileA.details, city: "St Helier", country: "JE" },
    };

    const profile = await createMemberProfileService({ store: store() }).fullProfile({
      academyId: "academy-1",
      record: { student: adult(), adminProfile: historicalProfile },
      now,
    });

    expect(profile.details).not.toHaveProperty("postalAddress");
    expect(profile.details.details).not.toHaveProperty("city");
    expect(profile.details.details).not.toHaveProperty("country");
    expect(historicalProfile.postalAddress).toEqual({
      line: "Historical address",
      postCode: "JE1 1AA",
    });
  });

  it("names a minor's current guardians and proposes a member number when there is none", async () => {
    const service = createMemberProfileService({
      store: store({
        listStudentRelationships: async () => [
          relationship(),
          relationship({
            relationshipId: "family-b--student-b-old",
            adultUserId: "guardian-2",
            validTo: "2026-06-01T00:00:00.000Z",
          }),
        ],
      }),
    });

    const profile = await service.fullProfile({
      academyId: "academy-1",
      record: { student: minor() },
      now,
    });

    expect(profile.cards.accountManagers).toEqual([
      { displayName: "Test Guardian", familyId: "family-b" },
    ]);
    expect(profile.cards.currentMembership).toBeNull();
    expect(profile.cards.memberSince).toBe("2026-01-15");
    expect(profile.nextFreeMemberNumber).toBe("13");
    expect(profile.details.gender).toBe("unknown");
    expect(profile.header).not.toHaveProperty("maskedMemberReference");
  });

  it("keeps a guardian whose user document would fail the full profile parse", async () => {
    // Synthetic: no phoneNumber at all, and an email the profile parser rejects.
    const guardianDocument = {
      userId: "guardian-1",
      academyId: "academy-1",
      accountType: "client",
      displayName: " Test Guardian ",
      email: "not-an-email",
      active: true,
      status: "active",
      ...audit,
    };
    const service = createMemberProfileService({
      store: store({
        listStudentRelationships: async () => [relationship()],
        getUserDisplayName: async () => userDisplayNameOf(guardianDocument),
      }),
    });

    const profile = await service.fullProfile({
      academyId: "academy-1",
      record: { student: minor() },
      now,
    });

    expect(profile.cards.accountManagers).toEqual([
      { displayName: "Test Guardian", familyId: "family-b" },
    ]);
  });

  it("names no account manager for a minor with no guardian link", async () => {
    const profile = await createMemberProfileService({ store: store() }).fullProfile({
      academyId: "academy-1",
      record: { student: minor() },
      now,
    });
    expect(profile.cards.accountManagers).toEqual([]);
  });

  it("does not list an adult as their own account manager", async () => {
    const profile = await createMemberProfileService({ store: store() }).fullProfile({
      academyId: "academy-1",
      record: { student: adult(), adminProfile: profileA },
      now,
    });
    expect(profile.cards.accountManagers).toEqual([]);
  });

  it("gives coaches the header only, with no identifier", () => {
    const profile = createMemberProfileService({ store: store() }).coachProfile({
      student: adult(),
      now,
    });
    expect(profile).toEqual({
      view: "coach",
      header: {
        studentId: "student-a",
        fullName: "Test Member A",
        age: 25,
        participantType: "adult",
        status: "active",
        birthdayBadge: { kind: "inDays", days: 3 },
      },
    });
    expect(Object.keys(profile.header).sort()).toEqual([
      "age",
      "birthdayBadge",
      "fullName",
      "participantType",
      "status",
      "studentId",
    ]);
  });

  it("searches names without case or accents and returns only id and name", async () => {
    const names = [
      { studentId: "s3", fullName: "Test Zélia" },
      { studentId: "s1", fullName: "Test Zelia Two" },
      { studentId: "s2", fullName: "Other Person" },
    ];
    const service = createMemberProfileService({
      store: store({ listStudentNames: async () => names }),
    });
    await expect(
      service.searchNames({ academyId: "academy-1", value: { query: "ZELIA" } }),
    ).resolves.toEqual({
      members: [
        { studentId: "s3", fullName: "Test Zélia" },
        { studentId: "s1", fullName: "Test Zelia Two" },
      ],
    });
    await expect(
      service.searchNames({ academyId: "academy-1", value: { query: "x" } }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("caps results at 20 and refuses a partial scan above 2000 students", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      studentId: `s${String(index).padStart(2, "0")}`,
      fullName: `Test Member ${String(index).padStart(2, "0")}`,
    }));
    const service = createMemberProfileService({
      store: store({ listStudentNames: async () => many }),
    });
    const result = await service.searchNames({ academyId: "academy-1", value: { query: "test" } });
    expect(result.members).toHaveLength(20);

    const tooMany = createMemberProfileService({
      store: store({
        listStudentNames: async () =>
          Array.from({ length: 2001 }, (_, index) => ({
            studentId: `s${index}`,
            fullName: "Test",
          })),
      }),
    });
    await expect(
      tooMany.searchNames({ academyId: "academy-1", value: { query: "test" } }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("shows no badge and no age for a member whose date of birth is unusable", () => {
    const profile = createMemberProfileService({ store: store() }).coachProfile({
      student: adult({ dateOfBirth: "" }),
      now,
    });
    expect(profile.header.age).toBeNull();
    expect(profile.header.birthdayBadge).toBeNull();
  });
});

it("projects age review to the office while keeping coach headers restricted", async () => {
  const base = { ...adult() };
  delete base.dateOfBirth;
  delete base.familyId;
  delete base.userId;
  const student: StudentProfile = {
    ...base,
    participantType: "minor",
    reviewReason: "date-of-birth-missing",
  };
  const service = createMemberProfileService({ store: store() });
  const profile = await service.fullProfile({ academyId: "academy-1", record: { student }, now });
  expect(profile.header).toMatchObject({
    age: null,
    birthdayBadge: null,
    reviewReason: "date-of-birth-missing",
  });
  expect(profile.details).not.toHaveProperty("dateOfBirth");
  expect(profile.details.reviewReason).toBe("date-of-birth-missing");
  const coach = service.coachProfile({ student, now });
  expect(coach.header).not.toHaveProperty("reviewReason");
});
